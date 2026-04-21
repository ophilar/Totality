/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MusicView } from '../../src/renderer/src/components/library/MusicView'
import { useSources } from '../../src/renderer/src/contexts/SourceContext'
import React from 'react'

// Mock useSources
vi.mock('../../src/renderer/src/contexts/SourceContext', () => ({
  useSources: vi.fn(),
}))

// Mock react-virtuoso to render items in JSDOM
vi.mock('react-virtuoso', () => ({
  Virtuoso: ({ data, itemContent, components }: any) => (
    <div data-testid="virtuoso-list">
      {data.map((item: any, index: number) => (
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
          {data.map((item: any, index: number) => (
            <Item key={index}>{itemContent(index, item)}</Item>
          ))}
        </List>
        {components?.Footer && <components.Footer />}
      </div>
    )
  }
}))

const mockArtists = [
  { id: 1, name: 'Artist One', sort_name: 'Artist One', provider_id: 'a1', source_id: 's1', source_type: 'local' },
  { id: 2, name: 'Artist Two', sort_name: 'Artist Two', provider_id: 'a2', source_id: 's1', source_type: 'local' }
]

const mockAlbums = [
  { id: 10, title: 'Album One', artist_id: 1, artist_name: 'Artist One', provider_id: 'al1', source_id: 's1', source_type: 'local', year: 2020 },
  { id: 11, title: 'Album Two', artist_id: 2, artist_name: 'Artist Two', provider_id: 'al2', source_id: 's1', source_type: 'local', year: 2021 }
]

const defaultProps: any = {
  artists: [],
  totalArtistCount: 0,
  artistsLoading: false,
  onLoadMoreArtists: vi.fn(),
  albums: [],
  tracks: [],
  allTracks: [],
  totalTrackCount: 0,
  tracksLoading: false,
  onLoadMoreTracks: vi.fn(),
  totalAlbumCount: 0,
  albumsLoading: false,
  onLoadMoreAlbums: vi.fn(),
  albumSortColumn: 'title',
  albumSortDirection: 'asc',
  onAlbumSortChange: vi.fn(),
  stats: null,
  selectedArtist: null,
  selectedAlbum: null,
  artistCompleteness: new Map(),
  albumCompleteness: null,
  allAlbumCompleteness: new Map(),
  musicViewMode: 'artists',
  trackSortColumn: 'title',
  trackSortDirection: 'asc',
  onTrackSortChange: vi.fn(),
  onSelectArtist: vi.fn(),
  onSelectAlbum: vi.fn(),
  onBack: vi.fn(),
  gridScale: 5,
  viewType: 'grid',
  searchQuery: '',
  qualityFilter: 'all',
  showSourceBadge: true,
  onAnalyzeAlbum: vi.fn(),
  onAnalyzeArtist: vi.fn(),
  onArtistCompletenessUpdated: vi.fn(),
  includeEps: true,
  includeSingles: true,
  sortBy: 'title',
  onSortChange: vi.fn(),
  slimDown: false
}

describe('MusicView Rendering', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    ;(useSources as any).mockReturnValue({
      isScanning: false,
      scanProgress: new Map(),
    })
  })

  it('renders artist grid by default', () => {
    render(<MusicView {...defaultProps} artists={mockArtists as any} totalArtistCount={2} />)
    expect(screen.getByText('Artist One')).toBeTruthy()
    expect(screen.getByText('Artist Two')).toBeTruthy()
  })

  it('renders loading skeletons when loading', () => {
    render(<MusicView {...defaultProps} artistsLoading={true} />)
    // MediaGridView renders 12 skeletons by default when items.length === 0 and loading is true
    const skeletons = screen.getAllByTestId('media-card-skeleton')
    expect(skeletons.length).toBeGreaterThan(0)
  })

  it('renders album grid in albums mode', () => {
    render(<MusicView {...defaultProps} musicViewMode="albums" albums={mockAlbums as any} totalAlbumCount={2} />)
    expect(screen.getByText('Album One')).toBeTruthy()
    expect(screen.getByText('Album Two')).toBeTruthy()
  })

  it('calls onSelectArtist when an artist card is clicked', () => {
    const onSelectArtist = vi.fn()
    render(<MusicView {...defaultProps} artists={mockArtists as any} onSelectArtist={onSelectArtist} />)
    
    const artistCard = screen.getByText('Artist One')
    fireEvent.click(artistCard)
    expect(onSelectArtist).toHaveBeenCalledWith(expect.objectContaining({ name: 'Artist One' }))
  })
})
