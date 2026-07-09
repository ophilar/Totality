/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, act, waitFor } from '@testing-library/react'
import { MoviesView } from '@/components/library/MoviesView'
import { LibraryProvider } from '@/contexts/LibraryContext'
import { SourceProvider } from '@/contexts/SourceContext'
import { setupRealIntegratedBridge, setupTestDb, cleanupTestDb } from '@tests/TestUtils'
import { TestProviders } from '@tests/TestProviders'
import React from 'react'

describe('MoviesView Integrated Rendering (No Mocks)', () => {
  let db: any

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
    let taskListener: any
    api.onTaskQueueUpdated = (cb: any) => {
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
      connection_config: '{}', // Fixed: connection_config is NOT NULL
      is_enabled: 1
    } as any)

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
          movies={[movie] as any}
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
          movies={[movie] as any}
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
})



