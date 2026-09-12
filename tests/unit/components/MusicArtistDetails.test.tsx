/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react'
import React from 'react'
import { MusicArtistDetails } from '@/components/library/music/MusicArtistDetails'
import { WishlistProvider } from '@/contexts/WishlistContext'
import type {
  MusicArtist,
  MusicAlbum,
  ArtistCompletenessData,
  AlbumCompletenessData,
  MissingAlbum
} from '@/components/library/types'

describe('MusicArtistDetails Component', () => {
  const baseArtist: MusicArtist = {
    id: 1,
    name: 'The Beatles',
    sort_name: 'Beatles, The',
    provider_id: 'p-1',
    source_id: 's-1',
    source_type: 'local',
    thumb_url: 'https://example.com/beatles.jpg',
    country: 'United Kingdom',
    genres: '["Rock", "Pop"]',
    biography: 'The Beatles were an English rock band formed in Liverpool in 1960. Lineup: John, Paul, George, and Ringo. They were widely regarded as the foremost and most influential music act in history.',
    album_count: 12,
    track_count: 213
  }

  const mockAlbums: MusicAlbum[] = [
    {
      id: 101,
      title: 'Abbey Road',
      artist_id: 1,
      artist_name: 'The Beatles',
      provider_id: 'al-1',
      source_id: 's-1',
      source_type: 'local',
      year: 1969
    },
    {
      id: 102,
      title: 'Revolver',
      artist_id: 1,
      artist_name: 'The Beatles',
      provider_id: 'al-2',
      source_id: 's-1',
      source_type: 'local',
      year: 1966
    }
  ]

  const mockArtistCompletenessData: ArtistCompletenessData = {
    id: 1,
    artist_name: 'The Beatles',
    total_albums: 15,
    owned_albums: 12,
    missing_albums: JSON.stringify([
      { title: 'Let It Be', year: 1970, musicbrainz_id: 'mb-1', type: 'album' }
    ] as MissingAlbum[]),
    missing_eps: JSON.stringify([
      { title: 'Magical Mystery Tour EP', year: 1967, musicbrainz_id: 'mb-2', type: 'ep' }
    ] as MissingAlbum[]),
    missing_singles: JSON.stringify([
      { title: 'Hey Jude / Revolution', year: 1968, musicbrainz_id: 'mb-3', type: 'single' }
    ] as MissingAlbum[])
  }

  const mockArtistCompleteness = new Map<string, ArtistCompletenessData>([
    ['The Beatles', mockArtistCompletenessData]
  ])

  const mockAlbumCompleteness = new Map<number, AlbumCompletenessData>([
    [101, { id: 101, album_title: 'Abbey Road', total_tracks: 17, owned_tracks: 17, missing_tracks: '[]' }]
  ])

  let defaultProps: React.ComponentProps<typeof MusicArtistDetails>

  beforeEach(() => {
    vi.resetAllMocks()

    Object.assign(window, {
      electronAPI: {
        wishlistGetItems: vi.fn().mockResolvedValue([]),
        wishlistGetCounts: vi.fn().mockResolvedValue({}),
        wishlistGetRegion: vi.fn().mockResolvedValue('US'),
        wishlistAddItem: vi.fn().mockResolvedValue({ id: 1 }),
        wishlistRemoveItem: vi.fn().mockResolvedValue(true),
        getSetting: vi.fn().mockResolvedValue(undefined),
        onWishlistAutoCompleted: vi.fn().mockReturnValue(() => {}),
        log: {
          info: vi.fn(),
          error: vi.fn(),
          warn: vi.fn(),
          debug: vi.fn()
        }
      }
    })

    // Mock clipboard API
    Object.defineProperty(navigator, 'clipboard', {
      value: {
        writeText: vi.fn().mockResolvedValue(undefined)
      },
      writable: true,
      configurable: true
    })

    defaultProps = {
      selectedArtist: baseArtist,
      filteredAlbums: mockAlbums,
      viewType: 'grid',
      showSourceBadge: true,
      allAlbumCompleteness: mockAlbumCompleteness,
      onSelectAlbum: vi.fn(),
      onAnalyzeAlbum: vi.fn().mockResolvedValue(undefined),
      onFixAlbumMatch: vi.fn(),
      artistCompleteness: mockArtistCompleteness,
      onAnalyzeArtist: vi.fn().mockResolvedValue(undefined),
      onFixArtistMatch: vi.fn(),
      onBack: vi.fn(),
      posterMinWidth: 180,
      includeEps: true,
      includeSingles: true,
      onDismissMissingAlbum: vi.fn().mockResolvedValue(undefined)
    }
  })

  afterEach(() => {
    cleanup()
  })

  const renderWithProviders = (ui: React.ReactElement) => {
    return render(<WishlistProvider>{ui}</WishlistProvider>)
  }

  it('renders artist details correctly (thumbnail, country, parsed genres, album/track counts)', async () => {
    await act(async () => {
      renderWithProviders(<MusicArtistDetails {...defaultProps} />)
    })

    expect(screen.getByText('The Beatles')).toBeDefined()
    expect(screen.getByText('United Kingdom')).toBeDefined()
    expect(screen.getByText('Rock, Pop')).toBeDefined()
    expect(screen.getByText('12 albums')).toBeDefined()
    expect(screen.getByText('213 tracks')).toBeDefined()

    const img = screen.getByRole('img', { name: 'The Beatles' }) as HTMLImageElement
    expect(img.src).toBe('https://example.com/beatles.jpg')
  })

  it('renders fallback icon when thumb_url is missing', async () => {
    const artistNoThumb = { ...baseArtist, thumb_url: undefined }
    await act(async () => {
      renderWithProviders(<MusicArtistDetails {...defaultProps} selectedArtist={artistNoThumb} />)
    })

    expect(screen.queryByRole('img', { name: 'The Beatles' })).toBeNull()
  })

  it('handles unparseable or string genre formats gracefully', async () => {
    const artistPlainGenre = { ...baseArtist, genres: 'Classic Rock' }
    await act(async () => {
      renderWithProviders(<MusicArtistDetails {...defaultProps} selectedArtist={artistPlainGenre} />)
    })

    expect(screen.getByText('Classic Rock')).toBeDefined()
  })

  it('copies artist name to clipboard when copy button is clicked', async () => {
    await act(async () => {
      renderWithProviders(<MusicArtistDetails {...defaultProps} />)
    })

    const copyBtn = screen.getByTitle('Copy title')
    await act(async () => {
      fireEvent.click(copyBtn)
    })

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('The Beatles')
  })

  it('renders completeness info for artist if available', async () => {
    await act(async () => {
      renderWithProviders(<MusicArtistDetails {...defaultProps} />)
    })

    expect(screen.getByText('12 of 15 albums in discography')).toBeDefined()
  })

  it('triggers onBack when clicking "Back to Artists"', async () => {
    await act(async () => {
      renderWithProviders(<MusicArtistDetails {...defaultProps} />)
    })

    const backBtn = screen.getByText('Back to Artists')
    await act(async () => {
      fireEvent.click(backBtn)
    })

    expect(defaultProps.onBack).toHaveBeenCalledTimes(1)
  })

  it('expands and collapses artist biography when "More" / "Less" is clicked', async () => {
    await act(async () => {
      renderWithProviders(<MusicArtistDetails {...defaultProps} />)
    })

    const bioText = screen.getByText(/The Beatles were an English rock band/i)
    expect(bioText.className).toContain('line-clamp-3')

    const moreBtn = screen.getByText('More')
    await act(async () => {
      fireEvent.click(moreBtn)
    })

    expect(bioText.className).not.toContain('line-clamp-3')
    expect(screen.getByText('Less')).toBeDefined()

    const lessBtn = screen.getByText('Less')
    await act(async () => {
      fireEvent.click(lessBtn)
    })

    expect(bioText.className).toContain('line-clamp-3')
  })

  it('triggers onAnalyzeArtist and toggles loading state on "Analyze Completeness" button click', async () => {
    let resolveAnalyze: () => void = () => {}
    const analyzePromise = new Promise<void>(res => { resolveAnalyze = res })
    const mockAnalyze = vi.fn().mockReturnValue(analyzePromise)

    await act(async () => {
      renderWithProviders(<MusicArtistDetails {...defaultProps} onAnalyzeArtist={mockAnalyze} />)
    })

    const analyzeBtn = screen.getByText('Analyze Completeness')
    await act(async () => {
      fireEvent.click(analyzeBtn)
    })

    expect(mockAnalyze).toHaveBeenCalledWith(1)
    expect(screen.getByText('Analyzing...')).toBeDefined()

    await act(async () => {
      resolveAnalyze()
      await analyzePromise
    })

    expect(screen.getByText('Analyze Completeness')).toBeDefined()
  })

  it('triggers onFixArtistMatch when fix match button is clicked', async () => {
    await act(async () => {
      renderWithProviders(<MusicArtistDetails {...defaultProps} />)
    })

    const fixBtn = screen.getByTitle('Fix Match')
    await act(async () => {
      fireEvent.click(fixBtn)
    })

    expect(defaultProps.onFixArtistMatch).toHaveBeenCalledWith(1, 'The Beatles')
  })

  it('renders empty albums state when filteredAlbums is empty', async () => {
    await act(async () => {
      renderWithProviders(<MusicArtistDetails {...defaultProps} filteredAlbums={[]} />)
    })

    expect(screen.getByText('No albums found')).toBeDefined()
  })

  it('renders albums in grid view and handles interactions', async () => {
    await act(async () => {
      renderWithProviders(<MusicArtistDetails {...defaultProps} viewType="grid" />)
    })

    expect(screen.getByText('Abbey Road')).toBeDefined()
    expect(screen.getByText('Revolver')).toBeDefined()

    const albumCard = screen.getByText('Abbey Road')
    await act(async () => {
      fireEvent.click(albumCard)
    })

    expect(defaultProps.onSelectAlbum).toHaveBeenCalledWith(mockAlbums[0])
  })

  it('renders albums in list view when viewType is "list"', async () => {
    await act(async () => {
      renderWithProviders(<MusicArtistDetails {...defaultProps} viewType="list" />)
    })

    expect(screen.getByText('Abbey Road')).toBeDefined()
    expect(screen.getByText('Revolver')).toBeDefined()

    const albumItem = screen.getByText('Revolver')
    await act(async () => {
      fireEvent.click(albumItem)
    })

    expect(defaultProps.onSelectAlbum).toHaveBeenCalledWith(mockAlbums[1])
  })

  it('renders missing releases (albums, EPs, singles) according to filter props', async () => {
    let unmountFn: () => void = () => {}
    await act(async () => {
      const { unmount } = renderWithProviders(<MusicArtistDetails {...defaultProps} includeEps={true} includeSingles={true} />)
      unmountFn = unmount
    })

    expect(screen.getByText('Missing (3)')).toBeDefined()
    expect(screen.getByText('Let It Be')).toBeDefined()
    expect(screen.getByText('Magical Mystery Tour EP')).toBeDefined()
    expect(screen.getByText('Hey Jude / Revolution')).toBeDefined()

    unmountFn()

    await act(async () => {
      renderWithProviders(<MusicArtistDetails {...defaultProps} includeEps={false} includeSingles={false} />)
    })

    expect(screen.getByText('Missing (1)')).toBeDefined()
    expect(screen.getByText('Let It Be')).toBeDefined()
    expect(screen.queryByText('Magical Mystery Tour EP')).toBeNull()
    expect(screen.queryByText('Hey Jude / Revolution')).toBeNull()
  })

  it('renders missing releases in list view when viewType is "list"', async () => {
    await act(async () => {
      renderWithProviders(<MusicArtistDetails {...defaultProps} viewType="list" />)
    })

    expect(screen.getByText('Missing (3)')).toBeDefined()
    expect(screen.getByText('Let It Be')).toBeDefined()
  })

  it('triggers onDismissMissingAlbum when a missing album is dismissed', async () => {
    await act(async () => {
      renderWithProviders(<MusicArtistDetails {...defaultProps} viewType="grid" />)
    })

    const dismissBtns = screen.getAllByTitle('Dismiss')
    expect(dismissBtns.length).toBeGreaterThan(0)

    await act(async () => {
      fireEvent.click(dismissBtns[0])
    })

    expect(defaultProps.onDismissMissingAlbum).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Let It Be' }),
      'The Beatles',
      undefined
    )
  })
})
