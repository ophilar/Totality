/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useMediaActions } from '@/components/library/hooks/useMediaActions'

describe('useMediaActions', () => {
  beforeEach(() => {
    window.electronAPI = {
      log: {
        info: vi.fn(),
        error: vi.fn(),
        warn: vi.fn(),
        debug: vi.fn(),
      },
      sourcesScanItem: vi.fn().mockResolvedValue(undefined),
    } as unknown as typeof window.electronAPI
  })

  it('initializes modal states to null and allows setting matchFixModal and selectedMissingItem', () => {
    const loadMedia = vi.fn().mockResolvedValue(undefined)
    const setDetailRefreshKey = vi.fn()

    const { result } = renderHook(() =>
      useMediaActions({
        selectedMediaId: null,
        loadMedia,
        setDetailRefreshKey,
      })
    )

    expect(result.current.matchFixModal).toBeNull()
    expect(result.current.selectedMissingItem).toBeNull()

    const mockMatchFix = {
      isOpen: true,
      type: 'movie' as const,
      title: 'Inception',
      year: 2010,
    }

    act(() => {
      result.current.setMatchFixModal(mockMatchFix)
    })
    expect(result.current.matchFixModal).toEqual(mockMatchFix)

    const mockMissingItem = {
      type: 'movie' as const,
      title: 'Interstellar',
      year: 2014,
    }

    act(() => {
      result.current.setSelectedMissingItem(mockMissingItem)
    })
    expect(result.current.selectedMissingItem).toEqual(mockMissingItem)
  })

  it('rescans item, reloads media, and updates detail refresh key when selectedMediaId matches mediaItemId', async () => {
    const loadMedia = vi.fn().mockResolvedValue(undefined)
    const setDetailRefreshKey = vi.fn((fn) => {
      if (typeof fn === 'function') {
        const nextValue = fn(1)
        expect(nextValue).toBe(2)
      }
    })

    const { result } = renderHook(() =>
      useMediaActions({
        selectedMediaId: 42,
        loadMedia,
        setDetailRefreshKey,
      })
    )

    await act(async () => {
      await result.current.handleRescanItem(42, 'source-1', 'library-1', '/path/to/file.mp4')
    })

    expect(window.electronAPI.log.info).toHaveBeenCalledWith(
      '[useMediaActions]',
      'Rescanning item: /path/to/file.mp4'
    )
    expect(window.electronAPI.sourcesScanItem).toHaveBeenCalledWith(
      'source-1',
      'library-1',
      '/path/to/file.mp4'
    )
    expect(loadMedia).toHaveBeenCalledTimes(1)
    expect(setDetailRefreshKey).toHaveBeenCalledTimes(1)
  })

  it('rescans item without updating detail refresh key when selectedMediaId does not match mediaItemId', async () => {
    const loadMedia = vi.fn().mockResolvedValue(undefined)
    const setDetailRefreshKey = vi.fn()

    const { result } = renderHook(() =>
      useMediaActions({
        selectedMediaId: 10,
        loadMedia,
        setDetailRefreshKey,
      })
    )

    await act(async () => {
      await result.current.handleRescanItem(42, 'source-1', 'library-1', '/path/to/file.mp4')
    })

    expect(window.electronAPI.sourcesScanItem).toHaveBeenCalledWith(
      'source-1',
      'library-1',
      '/path/to/file.mp4'
    )
    expect(loadMedia).toHaveBeenCalledTimes(1)
    expect(setDetailRefreshKey).not.toHaveBeenCalled()
  })

  it('logs error when sourcesScanItem throws an exception', async () => {
    const scanError = new Error('Scan failed')
    vi.mocked(window.electronAPI.sourcesScanItem).mockRejectedValueOnce(scanError)

    const loadMedia = vi.fn().mockResolvedValue(undefined)
    const setDetailRefreshKey = vi.fn()

    const { result } = renderHook(() =>
      useMediaActions({
        selectedMediaId: 42,
        loadMedia,
        setDetailRefreshKey,
      })
    )

    await act(async () => {
      await result.current.handleRescanItem(42, 'source-1', null, '/path/to/file.mp4')
    })

    expect(window.electronAPI.log.error).toHaveBeenCalledWith(
      '[useMediaActions]',
      'Rescan failed:',
      scanError
    )
    expect(loadMedia).not.toHaveBeenCalled()
    expect(setDetailRefreshKey).not.toHaveBeenCalled()
  })
})
