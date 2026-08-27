/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { MatchFixModal } from '@/components/library/MatchFixModal'
import React from 'react'

describe('MatchFixModal Series Disambiguation Indicators', () => {
  afterEach(() => {
    cleanup()
  })

  beforeEach(() => {
    Object.assign(window, {
      electronAPI: {
        log: { info: vi.fn(), error: vi.fn() },
        mediaSearchMetadata: vi.fn(),
        seriesFixMatch: vi.fn().mockResolvedValue({ success: true, updatedEpisodes: 10, completeness: {} }),
        movieFixMatch: vi.fn().mockResolvedValue({ success: true, tmdbId: 123, title: 'Test Movie' }),
        musicFixArtistMatch: vi.fn().mockResolvedValue(true),
        musicFixAlbumMatch: vi.fn().mockResolvedValue(true),
        getMediaItem: vi.fn().mockResolvedValue(null),
        sourcesGetLibrariesWithStatus: vi.fn().mockResolvedValue([]),
      },
    })
  })

  it('renders rich disambiguation metadata (network, country, status, external IDs, air date)', async () => {
    const mockResults = [
      {
        id: '1399',
        provider: 'tmdb',
        title: 'Game of Thrones',
        year: 2011,
        firstAirDate: '2011-04-17',
        type: 'tv' as const,
        posterUrl: 'https://image.tmdb.org/t/p/w500/u3bZgnGQ9T01sWNhyveQz0wH0Hl.jpg',
        overview: 'Seven noble families fight for control of the mythical land of Westeros. Friction between the houses leads to full-scale war. All while a very ancient evil awakens in the farthest north.',
        score: 8.4,
        network: 'HBO',
        country: 'US',
        status: 'Ended',
        originalLanguage: 'en',
        externalIds: {
          tmdbId: '1399',
          tvdbId: '121361',
          imdbId: 'tt0944947',
        },
      },
    ]

    ;(window.electronAPI.mediaSearchMetadata as ReturnType<typeof vi.fn>).mockResolvedValue(mockResults)

    render(
      <MatchFixModal
        isOpen={true}
        onClose={vi.fn()}
        type="series"
        currentTitle="Game of Thrones"
        sourceId="source-1"
      />
    )

    // Click search
    const searchButton = screen.getByRole('button', { name: /search/i })
    fireEvent.click(searchButton)

    await waitFor(() => {
      expect(screen.getAllByText('Game of Thrones').length).toBeGreaterThanOrEqual(2)
    })

    // Verify network, country, and status badges
    expect(screen.getByText('HBO')).toBeTruthy()
    expect(screen.getByText('US')).toBeTruthy()
    expect(screen.getByText('Ended')).toBeTruthy()

    // Verify air date / year badge
    expect(screen.getByText(/2011-04-17|2011/)).toBeTruthy()

    // Verify external IDs chips
    expect(screen.getByText(/TMDB:\s*1399/)).toBeTruthy()
    expect(screen.getByText(/TVDB:\s*121361/)).toBeTruthy()
    expect(screen.getByText(/IMDb:\s*tt0944947/)).toBeTruthy()
  })

  it('disambiguates between series with identical titles from different countries/networks', async () => {
    const mockResults = [
      {
        id: '2316',
        provider: 'tmdb',
        title: 'The Office',
        year: 2005,
        firstAirDate: '2005-03-24',
        type: 'tv' as const,
        network: 'NBC',
        country: 'US',
        status: 'Ended',
        overview: 'A mockumentary on a group of typical office workers in Scranton, Pennsylvania.',
        externalIds: { tmdbId: '2316', tvdbId: '73244', imdbId: 'tt0386676' },
      },
      {
        id: '2996',
        provider: 'tmdb',
        title: 'The Office',
        year: 2001,
        firstAirDate: '2001-07-09',
        type: 'tv' as const,
        network: 'BBC Two',
        country: 'GB',
        status: 'Ended',
        overview: 'Documentary-style sitcom following the staff of a paper company in Slough.',
        externalIds: { tmdbId: '2996', tvdbId: '78229', imdbId: 'tt0290978' },
      },
    ]

    ;(window.electronAPI.mediaSearchMetadata as ReturnType<typeof vi.fn>).mockResolvedValue(mockResults)

    render(
      <MatchFixModal
        isOpen={true}
        onClose={vi.fn()}
        type="series"
        currentTitle="The Office"
        sourceId="source-1"
      />
    )

    const searchButton = screen.getByRole('button', { name: /search/i })
    fireEvent.click(searchButton)

    await waitFor(() => {
      expect(screen.getByText('NBC')).toBeTruthy()
      expect(screen.getByText('BBC Two')).toBeTruthy()
      expect(screen.getByText('US')).toBeTruthy()
      expect(screen.getByText('GB')).toBeTruthy()
    })

    expect(screen.getByText(/TMDB:\s*2316/)).toBeTruthy()
    expect(screen.getByText(/TMDB:\s*2996/)).toBeTruthy()
  })

  it('allows expanding and collapsing the plot overview synopsis', async () => {
    const longOverview =
      'This is a very long plot overview for a TV series that contains significant amounts of lore, character backstories, and narrative complexity. It spans multiple sentences to ensure that when rendered in the search card, it exceeds standard line clamp thresholds and allows the user to expand or collapse it to read full context.'

    const mockResults = [
      {
        id: '100',
        provider: 'tmdb',
        title: 'Expansive Drama',
        year: 2024,
        type: 'tv' as const,
        overview: longOverview,
        network: 'Netflix',
      },
    ]

    ;(window.electronAPI.mediaSearchMetadata as ReturnType<typeof vi.fn>).mockResolvedValue(mockResults)

    render(
      <MatchFixModal
        isOpen={true}
        onClose={vi.fn()}
        type="series"
        currentTitle="Expansive Drama"
        sourceId="source-1"
      />
    )

    fireEvent.click(screen.getByRole('button', { name: /search/i }))

    await waitFor(() => {
      expect(screen.getAllByText(/Expansive Drama/).length).toBeGreaterThanOrEqual(2)
    })

    const showMoreButton = screen.getByText('Show more')
    expect(showMoreButton).toBeTruthy()

    // Expand
    fireEvent.click(showMoreButton)
    expect(screen.getByText('Show less')).toBeTruthy()

    // Collapse
    fireEvent.click(screen.getByText('Show less'))
    expect(screen.getByText('Show more')).toBeTruthy()
  })

  it('applies the selected match correctly with provider and id', async () => {
    const onMatchFixed = vi.fn()
    const onClose = vi.fn()

    const mockResults = [
      {
        id: '1399',
        provider: 'tmdb',
        title: 'Game of Thrones',
        year: 2011,
        type: 'tv' as const,
        network: 'HBO',
      },
    ]

    ;(window.electronAPI.mediaSearchMetadata as ReturnType<typeof vi.fn>).mockResolvedValue(mockResults)

    render(
      <MatchFixModal
        isOpen={true}
        onClose={onClose}
        type="series"
        currentTitle="Game of Thrones"
        sourceId="source-1"
        onMatchFixed={onMatchFixed}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: /search/i }))

    await waitFor(() => {
      expect(screen.getAllByText('Game of Thrones').length).toBeGreaterThanOrEqual(2)
    })

    // Click candidate card (the match in the search result card)
    const cardTitle = screen.getAllByText('Game of Thrones').find((el) => el.closest('.cursor-pointer'))
    expect(cardTitle).toBeDefined()
    const cardElement = cardTitle?.closest('[role="button"]')
    expect(cardElement).not.toBeNull()
    fireEvent.click(cardElement)

    // Apply match
    const applyButton = screen.getByRole('button', { name: /apply match/i })
    fireEvent.click(applyButton)

    await waitFor(() => {
      expect(window.electronAPI.seriesFixMatch).toHaveBeenCalledWith(
        'Game of Thrones',
        'source-1',
        'tmdb',
        '1399'
      )
      expect(onMatchFixed).toHaveBeenCalled()
      expect(onClose).toHaveBeenCalled()
    })
  })
})
