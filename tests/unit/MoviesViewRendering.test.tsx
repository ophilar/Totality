/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, act, waitFor, fireEvent } from '@testing-library/react'
import { MoviesView } from '@/components/library/MoviesView'
import { LibraryProvider } from '@/contexts/LibraryContext'
import { SourceProvider } from '@/contexts/SourceContext'
import { setupRealIntegratedBridge, setupTestDb, cleanupTestDb } from '@tests/TestUtils'
import { TestProviders } from '@tests/TestProviders'
import React from 'react'
import type { MediaItem } from '@/components/library/types'
import type { TaskQueueState } from '@main/types/database'

describe('MoviesView Integrated Rendering (No Mocks)', () => {
  let db: Awaited<ReturnType<typeof setupTestDb>>

  beforeEach(async () => {
    db = await setupTestDb()
    setupRealIntegratedBridge()
  })

  afterEach(() => {
    cleanupTestDb()
  })

  it('should show "Scan in Progress" when scanning and no movies found', async () => {
    const { api } = setupRealIntegratedBridge()

    // Explicitly capture the listener registered by SourceContext
    let taskListener: ((state: TaskQueueState) => void) | undefined
    api.onTaskQueueUpdated = (cb: (state: TaskQueueState) => void) => {
      taskListener = cb
      return () => {}
    }

    // Define the scanning state
    const scanningState = {
      currentTask: {
        type: 'library-scan',
        label: 'Scanning Library',
        sourceId: 'test-source',
        progress: {
          phase: 'analyzing',
          percentage: 50,
          currentItem: 'Interstellar.mkv',
          current: 5,
          total: 10
        }
      }
    }

    // Return the scanning state on mount
    api.taskQueueGetState = vi.fn().mockResolvedValue(scanningState)

    render(
      <TestProviders>
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
      </TestProviders>
    )

    // Trigger state change
    await act(async () => {
      if (taskListener) taskListener(scanningState)
    })

    // Now it should show scan progress
    await waitFor(() => {
      expect(screen.getByText('Scan in Progress')).toBeTruthy()
    }, { timeout: 5000 })

    expect(screen.getByText('analyzing')).toBeTruthy()
    expect(screen.getByText('Interstellar.mkv')).toBeTruthy()
  })

  it('should show "Analyzing" overlay on movies without efficiency score', async () => {
    // Seed real movie in real DB
    await db.sources.upsertSource({
      source_id: 'src-1',
      source_type: 'local',
      display_name: 'Local',
      connection_config: '{}', // connection_config is NOT NULL
      is_enabled: 1
    })

    const movie = {
      id: 1,
      title: 'Unanalyzed Movie',
      efficiency_score: null,
      source_type: 'local',
      source_id: 'src-1',
      type: 'movie',
      file_path: '/movies/unanalyzed.mkv'
    }

    render(
      <TestProviders>
        <MoviesView
          movies={[movie as MediaItem]}
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
          isAnalyzing={true}
        />
      </TestProviders>
    )

    expect(screen.getByText('Unanalyzed Movie')).toBeTruthy()
    expect(screen.getByText('Analyzing')).toBeTruthy()
  })

  it('should not show "Analyzing" overlay on movies with efficiency score', async () => {
    const movie = {
      id: 2,
      title: 'Analyzed Movie',
      efficiency_score: 85,
      source_type: 'local',
      type: 'movie'
    }

    render(
      <TestProviders>
        <MoviesView
          movies={[movie as MediaItem]}
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
      </TestProviders>
    )

    expect(screen.getByText('Analyzed Movie')).toBeTruthy()
    expect(screen.queryByText('Analyzing')).toBeNull()
  })

  it('sorts movies when a sortable list column header is clicked', () => {
    const onSortChange = vi.fn()

    render(
      <TestProviders>
        <MoviesView
          movies={[{ id: 3, title: 'Sortable Movie', type: 'movie' } as MediaItem]}
          sortBy="title"
          onSortChange={onSortChange}
          slimDown={false}
          onSelectMovie={() => {}}
          onSelectCollection={() => {}}
          viewType="list"
          gridScale={5}
          getCollectionForMovie={() => undefined}
          movieCollections={[]}
          showSourceBadge={false}
          totalMovieCount={1}
          moviesLoading={false}
          onLoadMoreMovies={() => {}}
        />
      </TestProviders>
    )

    fireEvent.click(screen.getByRole('button', { name: 'Sort movies by year' }))
    expect(onSortChange).toHaveBeenCalledWith('year')
  })

  it('renders flat movies when groupByCollections is false even if collection exists', () => {
    const movie1 = { id: 10, title: 'Avatar 1', type: 'movie' } as MediaItem
    const movie2 = { id: 11, title: 'Avatar 2', type: 'movie' } as MediaItem
    const collection = {
      collection_name: 'Avatar Collection',
      total_movies: 2,
      owned_movies: 2,
      movies: [movie1, movie2],
    }

    render(
      <TestProviders>
        <MoviesView
          movies={[movie1, movie2]}
          sortBy="title"
          onSortChange={() => {}}
          slimDown={false}
          onSelectMovie={() => {}}
          onSelectCollection={() => {}}
          viewType="grid"
          gridScale={5}
          groupByCollections={false}
          getCollectionForMovie={() => collection}
          movieCollections={[collection]}
          showSourceBadge={false}
          totalMovieCount={2}
          moviesLoading={false}
          onLoadMoreMovies={() => {}}
        />
      </TestProviders>
    )

    expect(screen.getByText('Avatar 1')).toBeTruthy()
    expect(screen.getByText('Avatar 2')).toBeTruthy()
    expect(screen.queryByText('Avatar Collection')).toBeNull()
  })

  it('groups movies into collection cards when groupByCollections is true', () => {
    const movie1 = { id: 20, title: 'Alien 1', type: 'movie' } as MediaItem
    const movie2 = { id: 21, title: 'Alien 2', type: 'movie' } as MediaItem
    const collection = {
      collection_name: 'Alien Collection',
      total_movies: 2,
      owned_movies: 2,
      movies: [movie1, movie2],
    }

    render(
      <TestProviders>
        <MoviesView
          movies={[movie1, movie2]}
          sortBy="title"
          onSortChange={() => {}}
          slimDown={false}
          onSelectMovie={() => {}}
          onSelectCollection={() => {}}
          viewType="grid"
          gridScale={5}
          groupByCollections={true}
          getCollectionForMovie={() => collection}
          movieCollections={[collection]}
          showSourceBadge={false}
          totalMovieCount={2}
          moviesLoading={false}
          onLoadMoreMovies={() => {}}
        />
      </TestProviders>
    )

    expect(screen.getByText('Alien Collection')).toBeTruthy()
  })

  it('filters out non-collection movies when collectionsOnly is true', () => {
    const movie1 = { id: 30, title: 'Iron Man', type: 'movie' } as MediaItem
    const standaloneMovie = { id: 31, title: 'Inception', type: 'movie' } as MediaItem
    const collection = {
      collection_name: 'Iron Man Collection',
      tmdb_collection_id: 'coll_iron_man',
      total_movies: 1,
      owned_movies: 1,
      movies: [movie1],
    }

    render(
      <TestProviders>
        <MoviesView
          movies={[movie1, standaloneMovie]}
          sortBy="title"
          onSortChange={() => {}}
          slimDown={false}
          onSelectMovie={() => {}}
          onSelectCollection={() => {}}
          viewType="grid"
          gridScale={5}
          groupByCollections={true}
          collectionsOnly={true}
          getCollectionForMovie={(m) => (m.id === 30 ? collection : undefined)}
          movieCollections={[collection]}
          showSourceBadge={false}
          totalMovieCount={2}
          moviesLoading={false}
          onLoadMoreMovies={() => {}}
        />
      </TestProviders>
    )

    expect(screen.getByText('Iron Man Collection')).toBeTruthy()
    expect(screen.queryByText('Inception')).toBeNull()
  })
})



