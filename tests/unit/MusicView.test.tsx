/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import React from 'react'
import type { ReactNode, ComponentType } from 'react'
import { MusicView } from '@/components/library/MusicView'
import { TrackListItem } from '@/components/library/music/TrackListItem'
import { MusicAlbumDetails } from '@/components/library/music/MusicAlbumDetails'
import { getSortOptions } from '@/components/library/sortDefinitions'
import { TestProviders } from '../TestProviders'
import type { MusicArtist, MusicAlbum, MusicTrack } from '@/components/library/types'

interface MockVirtuosoProps {
  data?: unknown[]
  itemContent: (index: number, item: unknown) => ReactNode
  components?: { Footer?: ComponentType; List?: ComponentType<{ children?: ReactNode }>; Item?: ComponentType<{ children?: ReactNode }> }
}

vi.mock('react-virtuoso', () => ({
  Virtuoso: ({ data, itemContent, components }: MockVirtuosoProps) => (
    <div data-testid="virtuoso-list">
      {data?.map((item, index) => (
        <div key={index}>{itemContent(index, item)}</div>
      ))}
      {components?.Footer && <components.Footer />}
    </div>
  ),
  VirtuosoGrid: ({ data, itemContent, components }: MockVirtuosoProps) => {
    const List = components?.List || (({ children }: { children?: ReactNode }) => <div>{children}</div>)
    const Item = components?.Item || (({ children }: { children?: ReactNode }) => <div>{children}</div>)
    return (
      <div data-testid="virtuoso-grid">
        <List>
          {data?.map((item, index) => (
            <Item key={index}>{itemContent(index, item)}</Item>
          ))}
        </List>
        {components?.Footer && <components.Footer />}
      </div>
    )
  }
}))

describe('Music Simplification Architecture', () => {
  beforeEach(() => {
    Object.assign(window, {
      electronAPI: {
        sourcesList: () => Promise.resolve([]),
        getSetting: () => Promise.resolve(undefined),
        setSetting: () => Promise.resolve(true),
        log: { info: () => {}, error: () => {}, warn: () => {}, debug: () => {} },
        onSourcesScanProgress: () => () => {},
        onSourcesScanCompleted: () => () => {},
        onScanCompleted: () => () => {},
        onSettingsChanged: () => () => {},
        onWishlistAutoCompleted: () => () => {},
        wishlistGetItems: () => Promise.resolve([]),
        wishlistGetCounts: () => Promise.resolve({ missing: 0, upgrade: 0, active: 0, completed: 0, total: 0 }),
        wishlistAddItem: () => Promise.resolve(1),
        getAllSettings: () => Promise.resolve({})
      }
    })
  })

  describe('Canonical Sort Options', () => {
    it('returns canonical sort options for music without efficiency or recoverable', () => {
      const musicSorts = getSortOptions('music')
      const keys = musicSorts.map(s => s.key)
      expect(keys).toEqual(['title', 'artist', 'album', 'year', 'size', 'quality'])
      expect(keys).not.toContain('efficiency')
      expect(keys).not.toContain('recoverable')
    })

    it('renders MusicView with canonical sort controls and headers without efficiency or recoverable', () => {
      const defaultProps: Parameters<typeof MusicView>[0] = {
        artists: [{ id: 1, name: 'Artist 1', provider_id: 'a1', source_id: 's1', source_type: 'local' }] as MusicArtist[],
        totalArtistCount: 1,
        artistsLoading: false,
        onLoadMoreArtists: () => {},
        albums: [],
        tracks: [],
        allTracks: [],
        totalTrackCount: 0,
        tracksLoading: false,
        onLoadMoreTracks: () => {},
        totalAlbumCount: 0,
        albumsLoading: false,
        onLoadMoreAlbums: () => {},
        albumSortColumn: 'title',
        albumSortDirection: 'asc',
        onAlbumSortChange: () => {},
        stats: null,
        selectedArtist: null,
        selectedAlbum: null,
        artistCompleteness: new Map(),
        albumCompleteness: null,
        allAlbumCompleteness: new Map(),
        musicViewMode: 'artists',
        trackSortColumn: 'title',
        trackSortDirection: 'asc',
        onTrackSortChange: () => {},
        onSelectArtist: () => {},
        onSelectAlbum: () => {},
        onBack: () => {},
        gridScale: 5,
        viewType: 'list',
        searchQuery: '',
        qualityFilter: 'all',
        showSourceBadge: true,
        onAnalyzeAlbum: async () => {},
        onAnalyzeArtist: async () => {},
        onArtistCompletenessUpdated: () => {},
        includeEps: true,
        includeSingles: true,
        sortBy: 'title',
        sortOrder: 'asc',
        onSortChange: () => {},
        slimDown: false
      }

      render(
        <TestProviders>
          <MusicView {...defaultProps} />
        </TestProviders>
      )

      // Verify canonical sort options rendered
      expect(screen.getByRole('button', { name: /^Title/ })).toBeTruthy()
      expect(screen.getByRole('button', { name: /^Artist/ })).toBeTruthy()
      expect(screen.getByRole('button', { name: /^Album/ })).toBeTruthy()
      expect(screen.getByRole('button', { name: /^Year/ })).toBeTruthy()
      expect(screen.getByRole('button', { name: /^Size/ })).toBeTruthy()
      expect(screen.getByRole('button', { name: /^Quality/ })).toBeTruthy()

      // Verify no efficiency or recoverable sort buttons
      expect(screen.queryByRole('button', { name: /Efficiency/i })).toBeNull()
      expect(screen.queryByRole('button', { name: /Recoverable/i })).toBeNull()

      // Verify list header columns
      expect(screen.getByRole('button', { name: /Sort music by Track Count/i })).toBeTruthy()
    })
  })

  describe('TrackListItem Authoritative Quality Tier', () => {
    it('uses authoritative tier from data without local calculation', () => {
      const hiResTrack: MusicTrack = {
        id: 1,
        title: 'Hi-Res Track',
        artist_name: 'Artist',
        audio_codec: 'flac',
        provider_id: 'p1',
        source_id: 's1',
        source_type: 'local',
        quality_tier: 'HI_RES'
      }

      const { rerender } = render(
        <TestProviders>
          <TrackListItem track={hiResTrack} index={1} />
        </TestProviders>
      )

      expect(screen.getByText('Hi-Res')).toBeTruthy()

      // Authoritative low tier triggers upgrade recommendation
      const lowTrack: MusicTrack = {
        ...hiResTrack,
        id: 2,
        title: 'Low Track',
        quality_tier: 'LOSSY_LOW'
      }

      rerender(
        <TestProviders>
          <TrackListItem track={lowTrack} index={2} />
        </TestProviders>
      )
      expect(screen.getByText('Low')).toBeTruthy()
      expect(screen.getByTitle('Quality upgrade recommended')).toBeTruthy()
    })

    it('renders raw audio specs or Unanalyzed when quality_tier is missing without defaulting to LOSSY_MID', () => {
      const unanalyzedWithBitrate: MusicTrack = {
        id: 3,
        title: 'Unanalyzed With Bitrate',
        artist_name: 'Artist',
        audio_codec: 'mp3',
        audio_bitrate: 192,
        provider_id: 'p3',
        source_id: 's1',
        source_type: 'local',
        quality_tier: undefined
      }

      const { rerender } = render(
        <TestProviders>
          <TrackListItem track={unanalyzedWithBitrate} index={1} />
        </TestProviders>
      )

      // Must NOT display "Mid" or "LOSSY_MID" default
      expect(screen.queryByText('Mid')).toBeNull()
      expect(screen.queryByText('LOSSY_MID')).toBeNull()
      expect(screen.getByText('192 kbps')).toBeTruthy()

      const completelyUnanalyzed: MusicTrack = {
        id: 4,
        title: 'Completely Unanalyzed',
        artist_name: 'Artist',
        audio_codec: 'mp3',
        provider_id: 'p4',
        source_id: 's1',
        source_type: 'local'
      }

      rerender(
        <TestProviders>
          <TrackListItem track={completelyUnanalyzed} index={2} />
        </TestProviders>
      )
      expect(screen.queryByText('Mid')).toBeNull()
      expect(screen.getByText('Unanalyzed')).toBeTruthy()
    })
  })

  describe('MusicAlbumDetails Authoritative Quality Tier', () => {
    it('uses authoritative tier from album without local calculation', () => {
      const album: MusicAlbum = {
        id: 10,
        title: 'Test Album',
        artist_name: 'Test Artist',
        provider_id: 'a10',
        source_id: 's1',
        source_type: 'local',
        track_count: 1,
        quality_tier: 'LOSSLESS',
        best_audio_codec: 'flac'
      }

      render(
        <MusicAlbumDetails
          selectedAlbum={album}
          selectedArtist={null}
          albumCompleteness={null}
          tracks={[{
            id: 101,
            title: 'Album Track 1',
            artist_name: 'Test Artist',
            audio_codec: 'flac',
            provider_id: 't1',
            source_id: 's1',
            source_type: 'local',
            quality_tier: 'LOSSLESS'
          }]}
          tracksLoading={false}
          onBack={() => {}}
          onAnalyzeAlbum={async () => {}}
        />
      )

      expect(screen.getByText('Lossless')).toBeTruthy()
    })

    it('renders raw audio specs or Unanalyzed when album quality_tier is missing without defaulting to LOSSY_MID', () => {
      const unanalyzedAlbum: MusicAlbum = {
        id: 11,
        title: 'Unanalyzed Album',
        artist_name: 'Test Artist',
        provider_id: 'a11',
        source_id: 's1',
        source_type: 'local',
        track_count: 0
      }

      render(
        <MusicAlbumDetails
          selectedAlbum={unanalyzedAlbum}
          selectedArtist={null}
          albumCompleteness={null}
          tracks={[]}
          tracksLoading={false}
          onBack={() => {}}
          onAnalyzeAlbum={async () => {}}
        />
      )

      expect(screen.queryByText('Standard')).toBeNull()
      expect(screen.queryByText('LOSSY_MID')).toBeNull()
      expect(screen.getByText('Unanalyzed')).toBeTruthy()
    })
  })
})
