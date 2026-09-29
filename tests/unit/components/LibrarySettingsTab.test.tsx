/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent, act, cleanup, within } from '@testing-library/react'
import React from 'react'
import { LibrarySettingsTab } from '@/components/settings/tabs/LibrarySettingsTab'
import { SETTING_KEYS } from '@shared/settingKeys'
import { cleanupTestDb, setupRealIntegratedBridge, setupTestDb } from '@tests/TestUtils'
import type { BetterSQLiteService } from '@main/database/BetterSQLiteService'

describe('LibrarySettingsTab (Integrated Stack)', () => {
  let db: BetterSQLiteService

  beforeEach(async () => {
    db = await setupTestDb()
    const folderPath = process.cwd()
    await db.sources.upsertSource({
      source_id: 'src-1',
      source_type: 'local',
      display_name: 'Local Media',
      connection_config: JSON.stringify({
        folderPath,
        mediaType: 'mixed',
        customLibraries: [
          { id: 'lib-1', name: 'Movies', path: folderPath, mediaType: 'movie', enabled: true },
          { id: 'lib-2', name: 'TV Shows', path: folderPath, mediaType: 'show', enabled: true },
        ],
      }),
      is_enabled: 1,
    })
    await db.sources.setLibraryProtected('src-1', 'movie:Movies', false, 'Movies', 'movie')
    await db.sources.setLibraryProtected('src-1', 'show:TV Shows', false, 'TV Shows', 'show')
    await db.sources.setLibraryAllowExpandedMatching('src-1', 'show:TV Shows', true, 'TV Shows', 'show')
    await Promise.all([
      db.config.setSetting(SETTING_KEYS.completeness_include_eps, 'true'),
      db.config.setSetting(SETTING_KEYS.completeness_include_singles, 'false'),
      db.config.setSetting(SETTING_KEYS.exclude_empty_seasons, 'true'),
      db.config.setSetting(SETTING_KEYS.collection_theatrical_lag_days, '30'),
    ])
    await db.exclusions.batchAddExclusions([
      { exclusion_type: 'media_upgrade', reference_id: 10, reference_key: 'upg-1', title: 'The Matrix (1999)' },
      { exclusion_type: 'collection_movie', reference_id: 20, reference_key: 'col-1' },
    ])
    Object.assign(window, { electronAPI: setupRealIntegratedBridge().api })
  })

  afterEach(() => {
    cleanup()
    cleanupTestDb()
  })

  const expandCard = async (name: string) => {
    await waitFor(() => expect(screen.getByText(name)).toBeTruthy())
    await act(async () => fireEvent.click(screen.getByText(name)))
  }

  it('loads library analysis settings, source libraries, and exclusions from the database', async () => {
    render(<LibrarySettingsTab />)
    await waitFor(() => expect(screen.getByText('Library Analysis')).toBeTruthy())

    expect(screen.getByText('Include EPs')).toBeTruthy()
    expect(screen.getByText('Include Singles')).toBeTruthy()
    expect(screen.getByText('Exclude seasons I have nothing of')).toBeTruthy()
    expect(screen.getByText('Exclude recently released films')).toBeTruthy()
    expect(screen.getByText('2 exclusions')).toBeTruthy()

    await expandCard('Protected Libraries')
    expect(screen.getByText('No PIN configured')).toBeTruthy()
    expect(screen.getByText('Local Media')).toBeTruthy()
    expect(screen.getByText('Movies')).toBeTruthy()
    expect(screen.getAllByText('TV Shows').length).toBeGreaterThan(0)
  })

  it('persists completeness and season settings through IPC', async () => {
    render(<LibrarySettingsTab />)
    await screen.findByText('Include EPs')
    const switches = screen.getAllByRole('switch')
    expect(switches[0].getAttribute('aria-checked')).toBe('true')
    expect(switches[1].getAttribute('aria-checked')).toBe('false')

    await act(async () => fireEvent.click(switches[0]))
    await act(async () => fireEvent.click(switches[1]))
    await act(async () => fireEvent.click(switches[2]))

    expect(await db.config.getSetting(SETTING_KEYS.completeness_include_eps)).toBe('false')
    expect(await db.config.getSetting(SETTING_KEYS.completeness_include_singles)).toBe('true')
    expect(await db.config.getSetting(SETTING_KEYS.exclude_empty_seasons)).toBe('false')
  })

  it('persists theatrical release lag and dispatches the exclusions change event', async () => {
    const changes: Event[] = []
    const onChange = (event: Event) => changes.push(event)
    window.addEventListener('exclusions-changed', onChange)
    render(<LibrarySettingsTab />)
    await screen.findByText('Exclude recently released films')

    const select = screen.getByRole('combobox') as HTMLSelectElement
    expect(select.value).toBe('30')
    await act(async () => fireEvent.change(select, { target: { value: '90' } }))

    expect(await db.config.getSetting(SETTING_KEYS.collection_theatrical_lag_days)).toBe('90')
    expect(changes.length).toBeGreaterThan(0)
    window.removeEventListener('exclusions-changed', onChange)
  })

  it('removes managed exclusions and reloads the remaining database records', async () => {
    render(<LibrarySettingsTab />)
    await screen.findByText('Dismissed Upgrades')
    await act(async () => fireEvent.click(screen.getByRole('button', { name: /Dismissed Upgrades/i })))
    expect(screen.getByText('The Matrix (1999)')).toBeTruthy()

    await act(async () => fireEvent.click(screen.getByTitle('Remove exclusion')))
    await waitFor(async () => expect(await db.exclusions.getExclusions('media_upgrade')).toHaveLength(0))

    await act(async () => fireEvent.click(screen.getByRole('button', { name: /Dismissed Collection Movies/i })))
    expect(screen.getByText('col-1')).toBeTruthy()
    await act(async () => fireEvent.click(screen.getByText('Clear All')))
    await waitFor(async () => expect(await db.exclusions.getExclusions('collection_movie')).toHaveLength(0))
  })

  it('creates a PIN through the database handler', async () => {
    render(<LibrarySettingsTab />)
    await expandCard('Protected Libraries')
    await act(async () => fireEvent.click(screen.getByText('Set PIN')))

    const pinInput = screen.getByPlaceholderText('Enter 4-8 digits') as HTMLInputElement
    const saveButton = screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement
    await act(async () => fireEvent.change(pinInput, { target: { value: '1234abc' } }))
    expect(pinInput.value).toBe('1234')
    expect(saveButton.disabled).toBe(false)
    await act(async () => fireEvent.click(saveButton))

    expect(await db.config.verifyPin('1234')).toBe(true)
    expect(await screen.findByText('••••••••')).toBeTruthy()
  })

  it('persists protection and expanded matching only after a PIN exists', async () => {
    await db.config.setPin('1234')
    render(<LibrarySettingsTab />)
    await expandCard('Protected Libraries')
    await screen.findByText('Movies')

    const protectMovies = screen.getByRole('switch', { name: 'Protect Movies' })
    expect(protectMovies.getAttribute('aria-checked')).toBe('false')
    await act(async () => fireEvent.click(protectMovies))
    expect((await db.sources.getSourceLibraries('src-1')).find(library => library.libraryId === 'movie:Movies')?.isProtected).toBe(1)

    const libraryButtons = screen.getAllByRole('button').filter(button => button.hasAttribute('aria-expanded'))
    await act(async () => fireEvent.click(libraryButtons[0]))
    const expandedMatching = within(screen.getByText('Extended Search').closest('div')!.parentElement!).getByRole('switch')
    await act(async () => fireEvent.click(expandedMatching))
    expect((await db.sources.getSourceLibraries('src-1')).find(library => library.libraryId === 'movie:Movies')?.allowExpandedMatching).toBe(1)
  })

  it('disables library protection until a PIN is configured', async () => {
    render(<LibrarySettingsTab />)
    await expandCard('Protected Libraries')
    const protectMovies = await screen.findByRole('switch', { name: 'Protect Movies' })
    expect(protectMovies.hasAttribute('disabled')).toBe(true)
    expect(screen.getByText('Set a PIN before enabling library protection.')).toBeTruthy()
  })
})
