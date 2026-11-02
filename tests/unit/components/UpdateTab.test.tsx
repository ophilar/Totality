/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react'
import { UpdateTab } from '@/components/settings/tabs/UpdateTab'
import React from 'react'

describe('UpdateTab Component', () => {
  let mockGetAppVersion: ReturnType<typeof vi.fn>
  let mockAutoUpdateGetState: ReturnType<typeof vi.fn>
  let mockGetSetting: ReturnType<typeof vi.fn>
  let mockSetSetting: ReturnType<typeof vi.fn>
  let mockAutoUpdateCheckForUpdates: ReturnType<typeof vi.fn>
  let mockAutoUpdateDownloadUpdate: ReturnType<typeof vi.fn>
  let mockAutoUpdateInstallUpdate: ReturnType<typeof vi.fn>
  let mockOnAutoUpdateStateChanged: ReturnType<typeof vi.fn>
  let stateChangeListener: ((state: unknown) => void) | null = null
  let cleanupFn: ReturnType<typeof vi.fn>

  beforeEach(() => {
    stateChangeListener = null
    cleanupFn = vi.fn()

    mockGetAppVersion = vi.fn().mockResolvedValue('1.2.0')
    mockAutoUpdateGetState = vi.fn().mockResolvedValue({ status: 'idle' })
    mockGetSetting = vi.fn().mockResolvedValue('true')
    mockSetSetting = vi.fn().mockResolvedValue(undefined)
    mockAutoUpdateCheckForUpdates = vi.fn().mockResolvedValue(undefined)
    mockAutoUpdateDownloadUpdate = vi.fn().mockResolvedValue(undefined)
    mockAutoUpdateInstallUpdate = vi.fn().mockResolvedValue(undefined)
    mockOnAutoUpdateStateChanged = vi.fn().mockImplementation((cb) => {
      stateChangeListener = cb
      return cleanupFn
    })

    const mockApi = {
      getAppVersion: mockGetAppVersion,
      autoUpdateGetState: mockAutoUpdateGetState,
      getSetting: mockGetSetting,
      setSetting: mockSetSetting,
      autoUpdateCheckForUpdates: mockAutoUpdateCheckForUpdates,
      autoUpdateDownloadUpdate: mockAutoUpdateDownloadUpdate,
      autoUpdateInstallUpdate: mockAutoUpdateInstallUpdate,
      onAutoUpdateStateChanged: mockOnAutoUpdateStateChanged,
      log: {
        error: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
      },
    }

    if (typeof window !== 'undefined') {
      Object.assign(window, { electronAPI: mockApi })
    }
    Object.assign(globalThis, { electronAPI: mockApi })
  })

  afterEach(() => {
    vi.clearAllMocks()
    vi.useRealTimers()
  })

  it('renders loading spinner initially and then displays initial update state', async () => {
    let resolveVersion!: (v: string) => void
    mockGetAppVersion.mockReturnValue(new Promise(res => { resolveVersion = res }))

    render(<UpdateTab />)

    // Spinner visible while loading
    expect(document.querySelector('.animate-spin')).toBeTruthy()

    await act(async () => {
      resolveVersion('1.2.0')
    })

    await waitFor(() => {
      expect(screen.getByText('Totality v1.2.0')).toBeTruthy()
    })

    expect(screen.getByText('Up to date')).toBeTruthy()
    expect(screen.getByRole('button', { name: /Check for Updates/i })).toBeTruthy()
  })

  it('displays last checked time when status is idle and lastChecked is present', async () => {
    const lastCheckedDate = '2025-01-01T12:00:00.000Z'
    mockAutoUpdateGetState.mockResolvedValue({ status: 'idle', lastChecked: lastCheckedDate })

    render(<UpdateTab />)

    await waitFor(() => {
      expect(screen.getByText(/Last checked/i)).toBeTruthy()
    })
  })

  it('displays checking status correctly', async () => {
    mockAutoUpdateGetState.mockResolvedValue({ status: 'checking' })

    render(<UpdateTab />)

    await waitFor(() => {
      expect(screen.getByText('Checking for updates...')).toBeTruthy()
    })

    const button = screen.getByRole('button', { name: /Checking\.\.\./i })
    expect(button).toBeTruthy()
    expect(button.getAttribute('disabled')).toBe('')
  })

  it('displays available update status and handles download action', async () => {
    mockAutoUpdateGetState.mockResolvedValue({ status: 'available', version: '2.0.0' })

    render(<UpdateTab />)

    await waitFor(() => {
      expect(screen.getByText('Version 2.0.0 available')).toBeTruthy()
    })

    const downloadButton = screen.getByRole('button', { name: /Download/i })
    expect(downloadButton).toBeTruthy()

    await act(async () => {
      fireEvent.click(downloadButton)
    })

    expect(mockAutoUpdateDownloadUpdate).toHaveBeenCalled()
  })

  it('displays downloading progress and progress bar', async () => {
    mockAutoUpdateGetState.mockResolvedValue({
      status: 'downloading',
      downloadProgress: { percent: 45, bytesPerSecond: 1000, transferred: 450, total: 1000 },
    })

    render(<UpdateTab />)

    await waitFor(() => {
      expect(screen.getByText('Downloading... 45%')).toBeTruthy()
    })

    // Action button should be disabled during download
    const actionBtn = screen.getByRole('button', { name: /Check for Updates/i })
    expect(actionBtn.getAttribute('disabled')).toBe('')
  })

  it('displays downloaded status and handles install action', async () => {
    mockAutoUpdateGetState.mockResolvedValue({ status: 'downloaded', version: '2.0.0' })

    render(<UpdateTab />)

    await waitFor(() => {
      expect(screen.getByText('Version 2.0.0 ready to install')).toBeTruthy()
    })

    const installBtn = screen.getByRole('button', { name: /Install/i })
    expect(installBtn).toBeTruthy()

    await act(async () => {
      fireEvent.click(installBtn)
    })

    expect(mockAutoUpdateInstallUpdate).toHaveBeenCalled()
  })

  it('displays error status when update check fails', async () => {
    mockAutoUpdateGetState.mockResolvedValue({ status: 'error', error: 'Network failure' })

    render(<UpdateTab />)

    await waitFor(() => {
      expect(screen.getByText('Update check failed')).toBeTruthy()
    })
  })

  it('handles manual check for updates action with minimum 1 second loading indicator', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    render(<UpdateTab />)

    await waitFor(() => {
      expect(screen.getByText('Totality v1.2.0')).toBeTruthy()
    })

    const checkBtn = screen.getByRole('button', { name: /Check for Updates/i })

    await act(async () => {
      fireEvent.click(checkBtn)
    })

    expect(mockAutoUpdateCheckForUpdates).toHaveBeenCalled()

    // Button should now show Checking... while isChecking state is true
    expect(screen.getByRole('button', { name: /Checking\.\.\./i })).toBeTruthy()

    // Fast-forward past 1000ms timeout
    await act(async () => {
      vi.advanceTimersByTime(1000)
    })

    expect(screen.getByRole('button', { name: /Check for Updates/i })).toBeTruthy()
  })

  it('handles automatic update toggle state changes', async () => {
    mockGetSetting.mockResolvedValue('true')

    render(<UpdateTab />)

    await waitFor(() => {
      expect(screen.getByRole('switch')).toBeTruthy()
    })

    const toggleBtn = screen.getByRole('switch')
    expect(toggleBtn.getAttribute('aria-checked')).toBe('true')

    await act(async () => {
      fireEvent.click(toggleBtn)
    })

    expect(mockSetSetting).toHaveBeenCalledWith('auto_update_enabled', 'false')
    expect(toggleBtn.getAttribute('aria-checked')).toBe('false')

    await act(async () => {
      fireEvent.click(toggleBtn)
    })

    expect(mockSetSetting).toHaveBeenCalledWith('auto_update_enabled', 'true')
    expect(toggleBtn.getAttribute('aria-checked')).toBe('true')
  })

  it('updates state dynamically when onAutoUpdateStateChanged fires', async () => {
    render(<UpdateTab />)

    await waitFor(() => {
      expect(screen.getByText('Totality v1.2.0')).toBeTruthy()
    })

    expect(mockOnAutoUpdateStateChanged).toHaveBeenCalled()
    expect(stateChangeListener).not.toBeNull()

    // Trigger state change event
    await act(async () => {
      stateChangeListener?.({ status: 'available', version: '3.0.0' })
    })

    expect(screen.getByText('Version 3.0.0 available')).toBeTruthy()
  })

  it('cleans up auto-update state listener on unmount', async () => {
    const { unmount } = render(<UpdateTab />)

    await waitFor(() => {
      expect(screen.getByText('Totality v1.2.0')).toBeTruthy()
    })

    unmount()
    expect(cleanupFn).toHaveBeenCalled()
  })

  it('handles errors gracefully when initial load fails', async () => {
    const consoleSpy = vi.spyOn(window.electronAPI.log, 'error')
    mockGetAppVersion.mockRejectedValue(new Error('IPC Error'))

    render(<UpdateTab />)

    await waitFor(() => {
      expect(consoleSpy).toHaveBeenCalledWith('[UpdateTab]', 'Failed to load update settings:', expect.any(Error))
    })
  })
})
