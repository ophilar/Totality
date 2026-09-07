/**
 * @vitest-environment jsdom
 */
import { act, renderHook } from '@testing-library/react'
import { createRef } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { useGlobalSearch } from '@/components/library/hooks/useGlobalSearch'
import { MediaItemType, type MediaItem } from '@main/types/database'

function episode(): MediaItem {
  return {
    id: 42,
    source_id: 'source-1',
    library_id: 'tv',
    plex_id: 'episode-42',
    type: MediaItemType.Episode,
    title: 'Identity Episode',
    series_title: 'Shared Show',
    series_identity_key: 'tmdb:4242',
    season_number: 1,
    episode_number: 2,
    file_size: null,
    duration: null,
    resolution: null,
    width: null,
    height: null,
    video_codec: null,
    video_bitrate: null,
    audio_codec: null,
    audio_channels: null,
    audio_bitrate: null,
  }
}

describe('useGlobalSearch episode identity', () => {
  it('carries scoped series identity into episode navigation results', () => {
    const { result } = renderHook(() => useGlobalSearch({
      items: [episode()],
      tvShows: new Map(),
      musicArtists: [],
      musicAlbums: [],
      allMusicTracks: [],
      searchInputRef: createRef<HTMLInputElement>(),
      onNavigateToMovie: vi.fn(),
      onNavigateToTVShow: vi.fn(),
      onNavigateToEpisode: vi.fn(),
      onNavigateToArtist: vi.fn(),
      onNavigateToAlbum: vi.fn(),
      onNavigateToTrack: vi.fn(),
    }))

    act(() => result.current.setSearchInput('Identity'))

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
