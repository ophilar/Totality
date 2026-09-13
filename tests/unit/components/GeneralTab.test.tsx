/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react'
import { GeneralTab } from '@/components/settings/tabs/GeneralTab'
import React from 'react'

describe('GeneralTab Component', () => {
  let mockElectronAPI: {
    getSetting: ReturnType<typeof vi.fn>
    setSetting: ReturnType<typeof vi.fn>
    monitoringGetConfig: ReturnType<typeof vi.fn>
    monitoringSetConfig: ReturnType<typeof vi.fn>
    sourcesList: ReturnType<typeof vi.fn>
    log: {
      error: ReturnType<typeof vi.fn>
      info: ReturnType<typeof vi.fn>
      warn: ReturnType<typeof vi.fn>
    }
  }

  let originalElectronAPI: Record<string, unknown>

  beforeEach(() => {
    mockElectronAPI = {
      getSetting: vi.fn().mockImplementation((key: string) => {
        if (key === 'minimize_to_tray') return Promise.resolve('false')
        if (key === 'start_minimized_to_tray') return Promise.resolve('false')
        if (key === 'subtitle_preferred_languages') return Promise.resolve('eng, heb, spa')
        if (key === 'transcoding_temp_directory') return Promise.resolve('/tmp/transcode')
        if (key === 'transcoding_default_output_mode') return Promise.resolve('quarantine-replace')
        return Promise.resolve(null)
      }),
      setSetting: vi.fn().mockResolvedValue(true),
      monitoringGetConfig: vi.fn().mockResolvedValue({
        enabled: true,
        startOnLaunch: true,
        pauseDuringManualScan: true,
        pollingIntervals: {
          plex: 300000,
          jellyfin: 300000,
          emby: 300000,
          kodi: 300000,
        },
      }),
      monitoringSetConfig: vi.fn().mockResolvedValue(true),
      sourcesList: vi.fn().mockResolvedValue([
        { source_id: '1', source_type: 'plex', display_name: 'Plex Server', is_enabled: true },
        { source_id: '2', source_type: 'local', display_name: 'Local Movies', is_enabled: true },
      ]),
      log: {
        error: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
      },
    }

    originalElectronAPI = { ...((window as unknown as { electronAPI?: Record<string, unknown> }).electronAPI || {}) }
    Object.assign(window.electronAPI, mockElectronAPI)
  })

  afterEach(() => {
    vi.clearAllMocks()
    Object.assign(window.electronAPI, originalElectronAPI)
  })

  it('renders loading indicator initially and then displays settings cards once loaded', async () => {
    let resolveGetSetting: (val: string) => void
    mockElectronAPI.getSetting.mockImplementation(
      (key: string) =>
        new Promise((resolve) => {
          if (key === 'minimize_to_tray') {
            resolveGetSetting = resolve
          } else {
            resolve('')
          }
        })
    )

    render(<GeneralTab />)

    // Verify loading spinner is present
    expect(document.querySelector('.animate-spin')).not.toBeNull()

    await act(async () => {
      resolveGetSetting!('false')
    })

    await waitFor(() => {
      expect(screen.getByText('Window Behavior')).toBeTruthy()
      expect(screen.getByText('Live Monitoring')).toBeTruthy()
      expect(screen.getByText('Subtitle Stream Preferences')).toBeTruthy()
      expect(screen.getByText('Transcoding Cache & Output Handling')).toBeTruthy()
    })
  })

  it('expands and collapses cards on clicking the card header', async () => {
    render(<GeneralTab />)

    await waitFor(() => {
      expect(screen.getByText('Window Behavior')).toBeTruthy()
    })

    // Content should initially be hidden because expandedCards is empty
    expect(screen.queryByText('Minimize to tray on close')).toBeNull()

    // Click to expand Window Behavior card
    const windowCardHeader = screen.getByText('Window Behavior').closest('button')!
    await act(async () => {
      fireEvent.click(windowCardHeader)
    })

    expect(screen.getByText('Minimize to tray on close')).toBeTruthy()

    // Click again to collapse
    await act(async () => {
      fireEvent.click(windowCardHeader)
    })

    expect(screen.queryByText('Minimize to tray on close')).toBeNull()
  })

  describe('Window Behavior Card', () => {
    it('handles minimize to tray toggle and conditional start minimized setting', async () => {
      render(<GeneralTab />)

      await waitFor(() => {
        expect(screen.getByText('Window Behavior')).toBeTruthy()
      })

      const windowCardHeader = screen.getByText('Window Behavior').closest('button')!
      await act(async () => {
        fireEvent.click(windowCardHeader)
      })

      const minimizeToggle = screen.getAllByRole('switch')[0]
      expect(minimizeToggle.getAttribute('aria-checked')).toBe('false')

      // Toggle minimize to tray ON
      await act(async () => {
        fireEvent.click(minimizeToggle)
      })

      expect(mockElectronAPI.setSetting).toHaveBeenCalledWith('minimize_to_tray', 'true')
      expect(screen.getByText('Start minimized to tray')).toBeTruthy()

      // Toggle start minimized ON
      const startMinimizedToggle = screen.getAllByRole('switch')[1]
      await act(async () => {
        fireEvent.click(startMinimizedToggle)
      })

      expect(mockElectronAPI.setSetting).toHaveBeenCalledWith('start_minimized_to_tray', 'true')

      // Toggle minimize to tray OFF (should also reset start_minimized_to_tray to false)
      const mainToggle = screen.getAllByRole('switch')[0]
      await act(async () => {
        fireEvent.click(mainToggle)
      })

      expect(mockElectronAPI.setSetting).toHaveBeenCalledWith('minimize_to_tray', 'false')
      expect(mockElectronAPI.setSetting).toHaveBeenCalledWith('start_minimized_to_tray', 'false')
      expect(screen.queryByText('Start minimized to tray')).toBeNull()
    })
  })

  describe('Live Monitoring Card', () => {
    it('handles enabling/disabling live monitoring and updating behavior switches', async () => {
      render(<GeneralTab />)

      await waitFor(() => {
        expect(screen.getByText('Live Monitoring')).toBeTruthy()
      })

      const monitoringCardHeader = screen.getByText('Live Monitoring').closest('button')!
      await act(async () => {
        fireEvent.click(monitoringCardHeader)
      })

      expect(screen.getByText('Enable monitoring')).toBeTruthy()

      // Toggle Enable monitoring OFF
      const enableToggle = screen.getAllByRole('switch')[0]
      await act(async () => {
        fireEvent.click(enableToggle)
      })

      expect(mockElectronAPI.monitoringSetConfig).toHaveBeenCalledWith({ enabled: false })

      // Note: when monitoring is disabled in state, behavior toggles get disabled: true
      // Re-enable monitoring so behavior toggles are enabled and clickable
      await act(async () => {
        fireEvent.click(enableToggle)
      })

      // Toggle Start on app launch
      const startOnLaunchToggle = screen.getAllByRole('switch')[1]
      await act(async () => {
        fireEvent.click(startOnLaunchToggle)
      })

      expect(mockElectronAPI.monitoringSetConfig).toHaveBeenCalledWith({ startOnLaunch: false })

      // Toggle Pause during manual scans
      const pauseScanToggle = screen.getAllByRole('switch')[2]
      await act(async () => {
        fireEvent.click(pauseScanToggle)
      })

      expect(mockElectronAPI.monitoringSetConfig).toHaveBeenCalledWith({ pauseDuringManualScan: false })
    })

    it('handles updating provider polling intervals', async () => {
      render(<GeneralTab />)

      await waitFor(() => {
        expect(screen.getByText('Live Monitoring')).toBeTruthy()
      })

      const monitoringCardHeader = screen.getByText('Live Monitoring').closest('button')!
      await act(async () => {
        fireEvent.click(monitoringCardHeader)
      })

      const selects = screen.getAllByRole('combobox')
      const plexSelect = selects[0] as HTMLSelectElement
      expect(plexSelect.value).toBe('300000')

      await act(async () => {
        fireEvent.change(plexSelect, { target: { value: '600000' } })
      })

      expect(mockElectronAPI.monitoringSetConfig).toHaveBeenCalledWith({
        pollingIntervals: {
          plex: 600000,
          jellyfin: 300000,
          emby: 300000,
          kodi: 300000,
        },
      })
    })
  })

  describe('Subtitle Stream Preferences Card', () => {
    it('handles saving subtitle preferred language whitelist input', async () => {
      render(<GeneralTab />)

      await waitFor(() => {
        expect(screen.getByText('Subtitle Stream Preferences')).toBeTruthy()
      })

      const subtitleCardHeader = screen.getByText('Subtitle Stream Preferences').closest('button')!
      await act(async () => {
        fireEvent.click(subtitleCardHeader)
      })

      const input = screen.getByPlaceholderText(/e\.g\. eng, heb, spa, jpn/i) as HTMLInputElement
      expect(input.value).toBe('eng, heb, spa')

      await act(async () => {
        fireEvent.change(input, { target: { value: 'eng, fra, ger' } })
      })

      const saveButton = screen.getByRole('button', { name: 'Save' })
      await act(async () => {
        fireEvent.click(saveButton)
      })

      expect(mockElectronAPI.setSetting).toHaveBeenCalledWith('subtitle_preferred_languages', 'eng, fra, ger')
      expect(screen.getByText('Saved!')).toBeTruthy()
    })

    it('handles quick add / toggle language preset buttons', async () => {
      render(<GeneralTab />)

      await waitFor(() => {
        expect(screen.getByText('Subtitle Stream Preferences')).toBeTruthy()
      })

      const subtitleCardHeader = screen.getByText('Subtitle Stream Preferences').closest('button')!
      await act(async () => {
        fireEvent.click(subtitleCardHeader)
      })

      // Click jpn + to add Japanese
      const jpnButton = screen.getByRole('button', { name: /^jpn \+/i })
      await act(async () => {
        fireEvent.click(jpnButton)
      })

      expect(mockElectronAPI.setSetting).toHaveBeenCalledWith('subtitle_preferred_languages', 'eng, heb, spa, jpn')

      // Click eng ✓ to remove English
      const engButton = screen.getByRole('button', { name: /^eng ✓/i })
      await act(async () => {
        fireEvent.click(engButton)
      })

      expect(mockElectronAPI.setSetting).toHaveBeenCalledWith('subtitle_preferred_languages', 'heb, spa, jpn')
    })
  })

  describe('Transcoding Cache & Output Handling Card', () => {
    it('handles changing temp directory and saving transcode settings', async () => {
      render(<GeneralTab />)

      await waitFor(() => {
        expect(screen.getByText('Transcoding Cache & Output Handling')).toBeTruthy()
      })

      const transcodeCardHeader = screen.getByText('Transcoding Cache & Output Handling').closest('button')!
      await act(async () => {
        fireEvent.click(transcodeCardHeader)
      })

      const tempDirInput = screen.getByPlaceholderText(/e\.g\. D:\\transcode_cache or \/tmp\/transcode/i) as HTMLInputElement
      expect(tempDirInput.value).toBe('/tmp/transcode')

      await act(async () => {
        fireEvent.change(tempDirInput, { target: { value: '/var/tmp/transcode' } })
      })

      const saveSettingsButton = screen.getByRole('button', { name: 'Save Settings' })
      await act(async () => {
        fireEvent.click(saveSettingsButton)
      })

      expect(mockElectronAPI.setSetting).toHaveBeenCalledWith('transcoding_temp_directory', '/var/tmp/transcode')
      expect(mockElectronAPI.setSetting).toHaveBeenCalledWith('transcoding_default_output_mode', 'quarantine-replace')
      expect(screen.getByText('Saved!')).toBeTruthy()
    })

    it('handles output verification mode selection buttons', async () => {
      render(<GeneralTab />)

      await waitFor(() => {
        expect(screen.getByText('Transcoding Cache & Output Handling')).toBeTruthy()
      })

      const transcodeCardHeader = screen.getByText('Transcoding Cache & Output Handling').closest('button')!
      await act(async () => {
        fireEvent.click(transcodeCardHeader)
      })

      // Select Direct Replace
      const directReplaceBtn = screen.getByText('Direct Replace').closest('button')!
      await act(async () => {
        fireEvent.click(directReplaceBtn)
      })

      expect(mockElectronAPI.setSetting).toHaveBeenCalledWith('transcoding_default_output_mode', 'replace')

      // Select Create Sibling Copy
      const copyBtn = screen.getByText('Create Sibling Copy').closest('button')!
      await act(async () => {
        fireEvent.click(copyBtn)
      })

      expect(mockElectronAPI.setSetting).toHaveBeenCalledWith('transcoding_default_output_mode', 'copy')
    })
  })

  describe('Error Handling', () => {
    it('logs error when initial data loading fails', async () => {
      const error = new Error('Database connection failed')
      mockElectronAPI.getSetting.mockRejectedValue(error)

      render(<GeneralTab />)

      await waitFor(() => {
        expect(mockElectronAPI.log.error).toHaveBeenCalledWith(
          '[GeneralTab]',
          'Failed to load general settings:',
          expect.any(Error)
        )
      })
    })

    it('logs error when saving monitoring config fails', async () => {
      mockElectronAPI.monitoringSetConfig.mockRejectedValue(new Error('IPC Save Failed'))

      render(<GeneralTab />)

      await waitFor(() => {
        expect(screen.getByText('Live Monitoring')).toBeTruthy()
      })

      const monitoringCardHeader = screen.getByText('Live Monitoring').closest('button')!
      await act(async () => {
        fireEvent.click(monitoringCardHeader)
      })

      const enableToggle = screen.getAllByRole('switch')[0]
      await act(async () => {
        fireEvent.click(enableToggle)
      })

      await waitFor(() => {
        expect(mockElectronAPI.log.error).toHaveBeenCalledWith(
          '[GeneralTab]',
          'Failed to save monitoring config:',
          expect.any(Error)
        )
      })
    })
  })
})
