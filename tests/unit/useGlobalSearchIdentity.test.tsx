/**
 * @vitest-environment jsdom
 */
import { act, renderHook } from '@testing-library/react'
import { createRef } from 'react'
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { useGlobalSearch } from '@/components/library/hooks/useGlobalSearch'
import type { GlobalSearchResults } from '@preload/api/types'

describe('useGlobalSearch episode identity', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    window.electronAPI.searchGlobal = vi.fn<() => Promise<GlobalSearchResults>>().mockResolvedValue({
        movies: [],
        tvShows: [],
        episodes: [
          {
            id: 42,
            type: 'episode',
            title: 'Identity Episode',
            series_title: 'Shared Show',
            series_identity_key: 'tmdb:4242',
            source_id: 'source-1',
            library_id: 'tv',
            season_number: 1,
            episode_number: 2,
            thumb_url: null,
            needs_upgrade: false
          }
        ],
        artists: [],
        albums: [],
        tracks: []
      })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('carries scoped series identity into episode navigation results', async () => {
    const { result } = renderHook(() => useGlobalSearch({
      searchInputRef: createRef<HTMLInputElement>(),
      onNavigateToMovie: vi.fn(),
      onNavigateToTVShow: vi.fn(),
      onNavigateToEpisode: vi.fn(),
      onNavigateToArtist: vi.fn(),
      onNavigateToAlbum: vi.fn(),
      onNavigateToTrack: vi.fn(),
    }))

    act(() => result.current.setSearchInput('Identity'))
    
    // Fast forward debounce timer
    await act(async () => {
      vi.advanceTimersByTime(300)
      // Flush promises
      await Promise.resolve()
    })

    expect(window.electronAPI.searchGlobal).toHaveBeenCalledWith('Identity')

    expect(result.current.globalSearchResults.episodes[0]).toMatchObject({
      id: 42,
      series_identity_key: 'tmdb:4242',
      source_id: 'source-1',
      library_id: 'tv',
    })
    expect(result.current.flattenedResults).toContainEqual({
      type: 'episode',
      id: 42,
      extra: {
        series_identity_key: 'tmdb:4242',
        source_id: 'source-1',
        library_id: 'tv',
      },
    })
  })
})
