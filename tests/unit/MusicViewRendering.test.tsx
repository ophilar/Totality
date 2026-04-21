/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MusicView } from '../../src/renderer/src/components/library/MusicView'
import { SourceProvider } from '../../src/renderer/src/contexts/SourceContext'
import { LibraryProvider } from '../../src/renderer/src/contexts/LibraryContext'
import { ToastProvider } from '../../src/renderer/src/contexts/ToastContext'
import { setupTestDb, cleanupTestDb } from '../TestUtils'
import React from 'react'

// Mock react-virtuoso to render items in JSDOM (infrastructure mock)
vi.mock('react-virtuoso', () => ({
  Virtuoso: ({ data, itemContent, components }: any) => (
    <div data-testid="virtuoso-list">
      {data?.map((item: any, index: number) => (
        <div key={index}>{itemContent(index, item)}</div>
      ))}
      {components?.Footer && <components.Footer />}
    </div>
  ),
  VirtuosoGrid: ({ data, itemContent, components }: any) => {
    const List = components?.List || (({ children }: any) => <div>{children}</div>)
    const Item = components?.Item || (({ children }: any) => <div>{children}</div>)
    return (
      <div data-testid="virtuoso-grid">
        <List>
          {data?.map((item: any, index: number) => (
            <Item key={index}>{itemContent(index, item)}</Item>
          ))}
        </List>
        {components?.Footer && <components.Footer />}
      </div>
    )
  }
}))

describe('MusicView Rendering (No Logic Mocks)', () => {
  let db: any

  beforeEach(async () => {
    db = await setupTestDb()
    
    // Setup real bridge for contexts
    ;(window as any).electronAPI = {
      sourcesList: () => Promise.resolve([]),
      getSetting: (key: string) => Promise.resolve(db.config.getSetting(key)),
      setSetting: (key: string, value: string) => {
        db.config.setSetting(key, value)
        return Promise.resolve(true)
      },
      log: { info: () => {}, error: () => {}, warn: () => {}, debug: () => {} },
      onSourcesScanProgress: () => () => {},
      onSourcesScanCompleted: () => () => {},
      onScanCompleted: () => () => {},
      onSettingsChanged: () => () => {},
      onWishlistAutoCompleted: () => () => {}
    }
  })

  afterEach(() => {
    cleanupTestDb()
  })

  const mockArtists = [
    { id: 1, name: 'Artist One', sort_name: 'Artist One', provider_id: 'a1', source_id: 's1', source_type: 'local', album_count: 1 },
    { id: 2, name: 'Artist Two', sort_name: 'Artist Two', provider_id: 'a2', source_id: 's1', source_type: 'local', album_count: 2 }
  ]

  const mockAlbums = [
    { id: 10, title: 'Album One', artist_id: 1, artist_name: 'Artist One', provider_id: 'al1', source_id: 's1', source_type: 'local', year: 2020 },
    { id: 11, title: 'Album Two', artist_id: 2, artist_name: 'Artist Two', provider_id: 'al2', source_id: 's1', source_type: 'local', year: 2021 }
  ]

  const defaultProps: any = {
    artists: [],
    totalArtistCount: 0,
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
    viewType: 'grid',
    searchQuery: '',
    qualityFilter: 'all',
    showSourceBadge: true,
    onAnalyzeAlbum: async () => {},
    onAnalyzeArtist: async () => {},
    onArtistCompletenessUpdated: () => {},
    includeEps: true,
    includeSingles: true,
    sortBy: 'title',
    onSortChange: () => {},
    slimDown: false
  }

  it('renders artist grid by default', () => {
    render(
      <ToastProvider>
        <LibraryProvider>
          <SourceProvider>
            <MusicView {...defaultProps} artists={mockArtists as any} totalArtistCount={2} />
          </SourceProvider>
        </LibraryProvider>
      </ToastProvider>
    )
    expect(screen.getByText('Artist One')).toBeTruthy()
    expect(screen.getByText('Artist Two')).toBeTruthy()
  })

  it('renders album grid in albums mode', () => {
    render(
      <ToastProvider>
        <LibraryProvider>
          <SourceProvider>
            <MusicView {...defaultProps} musicViewMode="albums" albums={mockAlbums as any} totalAlbumCount={2} />
          </SourceProvider>
        </LibraryProvider>
      </ToastProvider>
    )
    expect(screen.getByText('Album One')).toBeTruthy()
    expect(screen.getByText('Album Two')).toBeTruthy()
  })

  it('calls onSelectArtist when an artist card is clicked', () => {
    const onSelectArtist = vi.fn()
    render(
      <ToastProvider>
        <LibraryProvider>
          <SourceProvider>
            <MusicView {...defaultProps} artists={mockArtists as any} onSelectArtist={onSelectArtist} />
          </SourceProvider>
        </LibraryProvider>
      </ToastProvider>
    )
    
    const artistCard = screen.getByText('Artist One')
    fireEvent.click(artistCard)
    expect(onSelectArtist).toHaveBeenCalledWith(expect.objectContaining({ name: 'Artist One' }))
  })
})
