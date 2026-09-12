/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, waitFor, fireEvent, act, cleanup, within } from '@testing-library/react'
import React from 'react'
import { LibrarySettingsTab } from '@/components/settings/tabs/LibrarySettingsTab'
import { SETTING_KEYS } from '@shared/settingKeys'

describe('LibrarySettingsTab', () => {
  let mockElectronAPI: any

  beforeEach(() => {
    mockElectronAPI = {
      log: {
        error: vi.fn(),
        info: vi.fn(),
      },
      sourcesList: vi.fn().mockResolvedValue([
        {
          source_id: 'src-1',
          display_name: 'Plex Server',
          type: 'plex',
        },
      ]),
      sourcesGetLibrariesWithStatus: vi.fn().mockImplementation(async (sourceId: string) => {
        if (sourceId === 'src-1') {
          return [
            {
              id: 'lib-1',
              name: 'Movies',
              type: 'movie',
              isEnabled: true,
              isProtected: false,
              allowExpandedMatching: false,
              lastScanAt: null,
              itemsScanned: 100,
            },
            {
              id: 'lib-2',
              name: 'TV Shows',
              type: 'show',
              isEnabled: true,
              isProtected: true,
              allowExpandedMatching: true,
              lastScanAt: null,
              itemsScanned: 50,
            },
          ]
        }
        return []
      }),
      dbHasPin: vi.fn().mockResolvedValue(false),
      getSetting: vi.fn().mockImplementation(async (key: string) => {
        switch (key) {
          case SETTING_KEYS.completeness_include_eps:
            return 'true'
          case SETTING_KEYS.completeness_include_singles:
            return 'false'
          case SETTING_KEYS.exclude_empty_seasons:
            return 'true'
          case SETTING_KEYS.collection_theatrical_lag_days:
            return '30'
          default:
            return null
        }
      }),
      setSetting: vi.fn().mockResolvedValue(undefined),
      getExclusions: vi.fn().mockImplementation(async (type: string) => {
        if (type === 'media_upgrade') {
          return [
            {
              id: 1,
              exclusion_type: 'media_upgrade',
              reference_id: 10,
              reference_key: 'upg-1',
              parent_key: null,
              title: 'The Matrix (1999)',
              created_at: '2025-01-01',
            },
          ]
        }
        if (type === 'collection_movie') {
          return [
            {
              id: 2,
              exclusion_type: 'collection_movie',
              reference_id: 20,
              reference_key: 'col-1',
              parent_key: null,
              title: null,
              created_at: '2025-01-02',
            },
          ]
        }
        return []
      }),
      removeExclusion: vi.fn().mockResolvedValue(undefined),
      dbSetLibraryProtected: vi.fn().mockResolvedValue(undefined),
      dbSetLibraryAllowExpandedMatching: vi.fn().mockResolvedValue(undefined),
      dbSetPin: vi.fn().mockResolvedValue(undefined),
    }

    Object.assign(window, { electronAPI: mockElectronAPI })
    Object.assign(globalThis, { electronAPI: mockElectronAPI })
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('renders settings, libraries, and managed exclusions correctly after loading', async () => {
    render(<LibrarySettingsTab />)

    // Should wait until loading completes and elements appear
    await waitFor(() => {
      expect(screen.getByText('Library Analysis')).toBeTruthy()
    })

    expect(screen.getByText('Include EPs')).toBeTruthy()
    expect(screen.getByText('Include Singles')).toBeTruthy()
    expect(screen.getByText('Exclude seasons I have nothing of')).toBeTruthy()
    expect(screen.getByText('Exclude recently released films')).toBeTruthy()

    // Exclusions count summary text check (total 2 exclusions: 1 upgrade, 1 collection_movie)
    expect(screen.getByText('2 exclusions')).toBeTruthy()

    // Protected Libraries section check
    expect(screen.getByText('Protected Libraries')).toBeTruthy()

    // Expand Protected Libraries card to see inside
    await act(async () => {
      fireEvent.click(screen.getByText('Protected Libraries'))
    })

    expect(screen.getByText('No PIN configured')).toBeTruthy()
    expect(screen.getByText('Plex Server')).toBeTruthy()
    expect(screen.getByText('Movies')).toBeTruthy()
    expect(screen.getAllByText('TV Shows').length).toBeGreaterThan(0)
  })

  it('handles completeness settings toggles correctly', async () => {
    render(<LibrarySettingsTab />)

    await waitFor(() => {
      expect(screen.getByText('Include EPs')).toBeTruthy()
    })

    const switches = screen.getAllByRole('switch')
    // Find switches corresponding to Include EPs and Include Singles
    // In DOM order:
    // Switch 0: Include EPs (checked: true)
    // Switch 1: Include Singles (checked: false)
    expect(switches[0].getAttribute('aria-checked')).toBe('true')
    expect(switches[1].getAttribute('aria-checked')).toBe('false')

    // Toggle Include EPs
    await act(async () => {
      fireEvent.click(switches[0])
    })

    expect(mockElectronAPI.setSetting).toHaveBeenCalledWith('completeness_include_eps', 'false')

    // Toggle Include Singles
    await act(async () => {
      fireEvent.click(switches[1])
    })

    expect(mockElectronAPI.setSetting).toHaveBeenCalledWith(
      SETTING_KEYS.completeness_include_singles,
      'true'
    )
  })

  it('handles TV Show exclude empty seasons toggle and dispatches exclusions-changed event', async () => {
    const listener = vi.fn()
    window.addEventListener('exclusions-changed', listener)

    render(<LibrarySettingsTab />)

    await waitFor(() => {
      expect(screen.getByText('Exclude seasons I have nothing of')).toBeTruthy()
    })

    const switches = screen.getAllByRole('switch')
    // Switch 2: Exclude seasons (checked: true)
    expect(switches[2].getAttribute('aria-checked')).toBe('true')

    await act(async () => {
      fireEvent.click(switches[2])
    })

    expect(mockElectronAPI.setSetting).toHaveBeenCalledWith(
      SETTING_KEYS.exclude_empty_seasons,
      'false'
    )
    expect(listener).toHaveBeenCalled()

    window.removeEventListener('exclusions-changed', listener)
  })

  it('handles theatrical lag days change and dispatches exclusions-changed event', async () => {
    const listener = vi.fn()
    window.addEventListener('exclusions-changed', listener)

    render(<LibrarySettingsTab />)

    await waitFor(() => {
      expect(screen.getByText('Exclude recently released films')).toBeTruthy()
    })

    const select = screen.getByRole('combobox') as HTMLSelectElement
    expect(select.value).toBe('30')

    await act(async () => {
      fireEvent.change(select, { target: { value: '90' } })
    })

    expect(mockElectronAPI.setSetting).toHaveBeenCalledWith(
      SETTING_KEYS.collection_theatrical_lag_days,
      '90'
    )
    expect(listener).toHaveBeenCalled()

    window.removeEventListener('exclusions-changed', listener)
  })

  it('interacts with managed exclusions sections and items', async () => {
    const listener = vi.fn()
    window.addEventListener('exclusions-changed', listener)

    render(<LibrarySettingsTab />)

    await waitFor(() => {
      expect(screen.getByText('Dismissed Upgrades')).toBeTruthy()
    })

    // Expand Dismissed Upgrades section
    const upgradeSectionBtn = screen.getByRole('button', { name: /Dismissed Upgrades/i })
    await act(async () => {
      fireEvent.click(upgradeSectionBtn)
    })

    expect(screen.getByText('The Matrix (1999)')).toBeTruthy()

    // Remove single exclusion
    const removeBtn = screen.getByTitle('Remove exclusion')
    await act(async () => {
      fireEvent.click(removeBtn)
    })

    expect(mockElectronAPI.removeExclusion).toHaveBeenCalledWith(1)
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({ detail: { type: 'media_upgrade' } })
    )

    // Expand Dismissed Collection Movies section
    const collectionSectionBtn = screen.getByRole('button', { name: /Dismissed Collection Movies/i })
    await act(async () => {
      fireEvent.click(collectionSectionBtn)
    })

    // Fallback title should be reference_key 'col-1' since title is null
    expect(screen.getByText('col-1')).toBeTruthy()

    // Test Clear All
    const clearAllBtn = screen.getByText('Clear All')
    await act(async () => {
      fireEvent.click(clearAllBtn)
    })

    expect(mockElectronAPI.removeExclusion).toHaveBeenCalledWith(2)

    window.removeEventListener('exclusions-changed', listener)
  })

  it('reloads exclusions on failure during exclusion removal', async () => {
    mockElectronAPI.removeExclusion.mockRejectedValueOnce(new Error('Deletion failed'))

    render(<LibrarySettingsTab />)

    await waitFor(() => {
      expect(screen.getByText('Dismissed Upgrades')).toBeTruthy()
    })

    const upgradeSectionBtn = screen.getByRole('button', { name: /Dismissed Upgrades/i })
    await act(async () => {
      fireEvent.click(upgradeSectionBtn)
    })

    const removeBtn = screen.getByTitle('Remove exclusion')
    await act(async () => {
      fireEvent.click(removeBtn)
    })

    expect(mockElectronAPI.log.error).toHaveBeenCalledWith(
      '[LibrarySettingsTab]',
      'Failed to remove exclusion:',
      expect.any(Error)
    )
    expect(mockElectronAPI.getExclusions).toHaveBeenCalledWith('media_upgrade')
  })

  it('handles PIN creation and management', async () => {
    render(<LibrarySettingsTab />)

    await waitFor(() => {
      expect(screen.getByText('Protected Libraries')).toBeTruthy()
    })

    // Expand Protected Libraries card
    await act(async () => {
      fireEvent.click(screen.getByText('Protected Libraries'))
    })

    await waitFor(() => {
      expect(screen.getByText('Set PIN')).toBeTruthy()
    })

    // Click Set PIN
    await act(async () => {
      fireEvent.click(screen.getByText('Set PIN'))
    })

    const pinInput = screen.getByPlaceholderText('Enter 4-8 digits') as HTMLInputElement
    const saveBtn = screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement

    // Try submitting short PIN (< 4 digits)
    await act(async () => {
      fireEvent.change(pinInput, { target: { value: '12' } })
    })

    expect(saveBtn.disabled).toBe(true)

    // Filter non-digit characters and type valid PIN
    await act(async () => {
      fireEvent.change(pinInput, { target: { value: '1234abc' } })
    })

    expect(pinInput.value).toBe('1234')
    expect(saveBtn.disabled).toBe(false)

    // Mock dbHasPin returning true after setting pin
    mockElectronAPI.dbHasPin.mockResolvedValue(true)

    await act(async () => {
      fireEvent.click(saveBtn)
    })

    expect(mockElectronAPI.dbSetPin).toHaveBeenCalledWith('1234')

    await waitFor(() => {
      expect(screen.getByText('••••••••')).toBeTruthy()
    })
  })

  it('handles protected library toggle and allow expanded matching toggle', async () => {
    render(<LibrarySettingsTab />)

    await waitFor(() => {
      expect(screen.getByText('Protected Libraries')).toBeTruthy()
    })

    // Click Protected Libraries header to expand card
    const protectedCardHeader = screen.getByText('Protected Libraries')
    await act(async () => {
      fireEvent.click(protectedCardHeader)
    })

    await waitFor(() => {
      expect(screen.getByText('Movies')).toBeTruthy()
    })

    // Switch roles in the Protected Libraries card:
    // Switch 3: Library "Movies" Protected toggle (currently false)
    const switches = screen.getAllByRole('switch')
    const moviesProtectedSwitch = switches[3]
    expect(moviesProtectedSwitch.getAttribute('aria-checked')).toBe('false')

    await act(async () => {
      fireEvent.click(moviesProtectedSwitch)
    })

    expect(mockElectronAPI.dbSetLibraryProtected).toHaveBeenCalledWith('src-1', 'lib-1', true)

    // Find aria-expanded="false" button for Movies library
    const libToggleButtons = screen.getAllByRole('button').filter(b => b.hasAttribute('aria-expanded'))
    // Movies library toggle button is the first aria-expanded button in Protected Libraries card
    await act(async () => {
      fireEvent.click(libToggleButtons[0])
    })

    await waitFor(() => {
      expect(screen.getByText('Extended Search')).toBeTruthy()
    })

    const extendedSearchContainer = screen.getByText('Extended Search').closest('div')!.parentElement!
    const expandedMatchingSwitch = within(extendedSearchContainer).getByRole('switch')

    await act(async () => {
      fireEvent.click(expandedMatchingSwitch)
    })

    expect(mockElectronAPI.dbSetLibraryAllowExpandedMatching).toHaveBeenCalledWith(
      'src-1',
      'lib-1',
      true
    )
  })

  it('logs errors if loadSourceData or initial data load fails', async () => {
    mockElectronAPI.sourcesList.mockRejectedValueOnce(new Error('Source load error'))

    render(<LibrarySettingsTab />)

    await waitFor(() => {
      expect(mockElectronAPI.log.error).toHaveBeenCalledWith(
        '[LibrarySettingsTab]',
        'Failed to load source/library data:',
        expect.any(Error)
      )
    })
  })
})
