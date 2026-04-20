/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MoviesView } from '../../src/renderer/src/components/library/MoviesView'
import { useSources } from '../../src/renderer/src/contexts/SourceContext'
import React from 'react'

// Mock useSources
vi.mock('../../src/renderer/src/contexts/SourceContext', () => ({
  useSources: vi.fn(),
}))

// Mock MediaGridView to simplify rendering
vi.mock('../../src/renderer/src/components/library/MediaGridView', () => ({
  MediaGridView: ({ items, renderGridItem, emptyState, banner }: any) => (
    <div data-testid="media-grid">
      {banner}
      {items.length > 0 ? items.map((item: any) => renderGridItem(item)) : emptyState}
    </div>
  ),
}))

describe('MoviesView Rendering', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('should show "Scan in Progress" when scanning and no movies found', () => {
    ;(useSources as any).mockReturnValue({
      isScanning: true,
      scanProgress: new Map([['test-source', { phase: 'analyzing', percentage: 50, currentItem: 'Movie.mkv' }]]),
    })

    render(
      <MoviesView
        movies={[]}
        sortBy="title"
        onSortChange={() => {}}
        slimDown={false}
        onSelectMovie={() => {}}
        onSelectCollection={() => {}}
        viewType="grid"
        gridScale={5}
        getCollectionForMovie={() => undefined}
        movieCollections={[]}
        showSourceBadge={true}
        totalMovieCount={0}
        moviesLoading={false}
        onLoadMoreMovies={() => {}}
      />
    )

    expect(screen.getByText('Scan in Progress')).toBeTruthy()
    expect(screen.getByText(/Found/)).toBeTruthy()
    expect(screen.getByText('analyzing')).toBeTruthy()
    expect(screen.getByText('Movie.mkv')).toBeTruthy()
  })

  it('should show "Analyzing" overlay on movies without efficiency score', () => {
    ;(useSources as any).mockReturnValue({
      isScanning: false,
      scanProgress: new Map(),
    })

    const movies = [
      { id: 1, title: 'Unanalyzed Movie', efficiency_score: null, source_type: 'local' }
    ]

    render(
      <MoviesView
        movies={movies as any}
        sortBy="title"
        onSortChange={() => {}}
        slimDown={false}
        onSelectMovie={() => {}}
        onSelectCollection={() => {}}
        viewType="grid"
        gridScale={5}
        getCollectionForMovie={() => undefined}
        movieCollections={[]}
        showSourceBadge={true}
        totalMovieCount={1}
        moviesLoading={false}
        onLoadMoreMovies={() => {}}
      />
    )

    expect(screen.getByText('Unanalyzed Movie')).toBeTruthy()
    expect(screen.getByText('Analyzing')).toBeTruthy()
  })

  it('should not show "Analyzing" overlay on movies with efficiency score', () => {
    ;(useSources as any).mockReturnValue({
      isScanning: false,
      scanProgress: new Map(),
    })

    const movies = [
      { id: 1, title: 'Analyzed Movie', efficiency_score: 85, source_type: 'local' }
    ]

    render(
      <MoviesView
        movies={movies as any}
        sortBy="title"
        onSortChange={() => {}}
        slimDown={false}
        onSelectMovie={() => {}}
        onSelectCollection={() => {}}
        viewType="grid"
        gridScale={5}
        getCollectionForMovie={() => undefined}
        movieCollections={[]}
        showSourceBadge={true}
        totalMovieCount={1}
        moviesLoading={false}
        onLoadMoreMovies={() => {}}
      />
    )

    expect(screen.getByText('Analyzed Movie')).toBeTruthy()
    expect(screen.queryByText('Analyzing')).toBeNull()
  })
})
