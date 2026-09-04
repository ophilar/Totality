/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import React from 'react'
import { MoviesView } from '@/components/library/MoviesView'
import { useSources } from '@/contexts/SourceContext'
import { ScrollMemoryProvider } from '@/contexts/ScrollMemoryContext'
import type { MediaItem, MovieCollectionData } from '@/components/library/types'

vi.mock('@/contexts/SourceContext', () => ({
  useSources: vi.fn(),
}))

describe('MoviesView and MovieCard Canonical Parity', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(useSources).mockReturnValue({
      sources: [],
      isLoading: false,
      scanProgress: new Map(),
      isScanning: false,
      isMonitoring: false,
      refreshSources: vi.fn(),
      addSource: vi.fn(),
      updateSource: vi.fn(),
      deleteSource: vi.fn(),
      scanSource: vi.fn(),
      cancelScan: vi.fn(),
    } as never)
  })

  afterEach(() => {
    cleanup()
  })

  it('renders movie card with canonical metrics row, collection badge, and existing metadata without data loss', () => {
    const movie: MediaItem = {
      id: 101,
      title: 'The Matrix',
      year: 1999,
      resolution: '4K',
      video_codec: 'hevc',
      video_bitrate: 25000,
      file_size: 15000000000,
      efficiency_score: 55,
      storage_debt_bytes: 8000000000,
      evidence_status: 'measured',
      tier_quality: 'LOW',
      needs_upgrade: 1,
      source_id: 's1',
      source_type: 'local',
      file_path: '/movies/matrix.mkv'
    }

    const collection: MovieCollectionData = {
      tmdb_collection_id: 'col-1',
      collection_name: 'The Matrix Collection',
      total_movies: 4,
      owned_movies: 3,
      completeness_percentage: 75,
      missing_movies: '["The Matrix Resurrections"]',
      movies: [movie]
    }

    render(
      <ScrollMemoryProvider>
        <MoviesView
          movies={[movie]}
          sortBy="title"
          sortOrder="asc"
          onSortChange={vi.fn()}
          slimDown={false}
          onSelectMovie={vi.fn()}
          onSelectCollection={vi.fn()}
          viewType="grid"
          gridScale={1}
          getCollectionForMovie={() => collection}
          movieCollections={[collection]}
          showSourceBadge={true}
          totalMovieCount={1}
          moviesLoading={false}
          onLoadMoreMovies={vi.fn()}
          groupByCollections={false}
        />
      </ScrollMemoryProvider>
    )

    // Verify Title & Original Metadata
    expect(screen.getByText('The Matrix')).toBeDefined()
    expect(screen.getByText('1999')).toBeDefined()
    expect(screen.getByText('4K')).toBeDefined()

    // Verify Collection badge is preserved
    expect(screen.getByText('3/4')).toBeDefined()

    // Verify Canonical metrics row is present (both in card and in header metrics)
    expect(screen.getByText('Measured')).toBeDefined()
    expect(screen.getAllByText('55%')).toHaveLength(2)
    expect(screen.getByText(/14 GB|13.97 GB/)).toBeDefined()
    expect(screen.getAllByText('7.5 GB')).toHaveLength(2)

    // Verify Top-Level OptimizationMetrics Header
    expect(screen.getByText('Efficiency:')).toBeDefined()
    expect(screen.getByText('Recoverable:')).toBeDefined()
    expect(screen.getByText('1/1 items analyzed')).toBeDefined()
    expect(screen.getByText('(100% coverage)')).toBeDefined()
  })
})
