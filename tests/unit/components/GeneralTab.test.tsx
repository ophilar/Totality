/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react'
import { GeneralTab } from '@/components/settings/tabs/GeneralTab'
import { cleanupTestDb, setupRealIntegratedBridge, setupTestDb } from '@tests/TestUtils'
import type { BetterSQLiteService } from '@main/database/BetterSQLiteService'
import React from 'react'

describe('GeneralTab Component (Integrated Stack)', () => {
  let db: BetterSQLiteService

  beforeEach(async () => {
    db = await setupTestDb()
    const { api } = setupRealIntegratedBridge()
    Object.assign(window, { electronAPI: api })
  })

  afterEach(() => {
    cleanupTestDb()
  })

  const expandCard = async (title: string) => {
    await waitFor(() => expect(screen.getByText(title)).toBeTruthy())
    await act(async () => {
      fireEvent.click(screen.getByText(title).closest('button')!)
    })
  }

  it('loads settings through IPC and renders its cards', async () => {
    await db.config.setSetting('subtitle_preferred_languages', 'eng, heb, spa')
    render(<GeneralTab />)

    await waitFor(() => {
      expect(screen.getByText('Window Behavior')).toBeTruthy()
      expect(screen.getByText('Live Monitoring')).toBeTruthy()
      expect(screen.getByText('Subtitle Stream Preferences')).toBeTruthy()
      expect(screen.getByText('Transcoding Cache & Output Handling')).toBeTruthy()
    })
  })

  it('persists minimize to tray changes and clears start minimized when disabled', async () => {
    render(<GeneralTab />)
    await expandCard('Window Behavior')

    const minimizeToggle = screen.getAllByRole('switch')[0]
    await act(async () => fireEvent.click(minimizeToggle))
    expect(await db.config.getSetting('minimize_to_tray')).toBe('true')
    expect(screen.getByText('Start minimized to tray')).toBeTruthy()

    await act(async () => fireEvent.click(screen.getAllByRole('switch')[1]))
    expect(await db.config.getSetting('start_minimized_to_tray')).toBe('true')

    await act(async () => fireEvent.click(screen.getAllByRole('switch')[0]))
    expect(await db.config.getSetting('minimize_to_tray')).toBe('false')
    expect(await db.config.getSetting('start_minimized_to_tray')).toBe('false')
    expect(screen.queryByText('Start minimized to tray')).toBeNull()
  })

  it('persists live monitoring configuration changes', async () => {
    render(<GeneralTab />)
    await expandCard('Live Monitoring')

    await act(async () => fireEvent.click(screen.getAllByRole('switch')[0]))
    expect(await db.config.getSetting('monitoring_enabled')).toBe('true')

    await act(async () => fireEvent.click(screen.getAllByRole('switch')[1]))
    expect(await db.config.getSetting('monitoring_start_on_launch')).toBe('false')

    await act(async () => fireEvent.click(screen.getAllByRole('switch')[2]))
    expect(await db.config.getSetting('monitoring_pause_during_scan')).toBe('false')
  })

  it('saves subtitle language preferences through IPC', async () => {
    await db.config.setSetting('subtitle_preferred_languages', 'eng, heb, spa')
    render(<GeneralTab />)
    await expandCard('Subtitle Stream Preferences')

    const input = screen.getByPlaceholderText(/e\.g\. eng, heb, spa, jpn/i)
    await act(async () => fireEvent.change(input, { target: { value: 'eng, fra, ger' } }))
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Save' })))

    expect(await db.config.getSetting('subtitle_preferred_languages')).toBe('eng, fra, ger')
    expect(screen.getByText('Saved!')).toBeTruthy()
  })

  it('persists transcoding output mode changes', async () => {
    render(<GeneralTab />)
    await expandCard('Transcoding Cache & Output Handling')

    await act(async () => fireEvent.click(screen.getByText('Direct Replace').closest('button')!))
    expect(await db.config.getSetting('transcoding_default_output_mode')).toBe('replace')

    await act(async () => fireEvent.click(screen.getByText('Create Sibling Copy').closest('button')!))
    expect(await db.config.getSetting('transcoding_default_output_mode')).toBe('copy')
  })
})
