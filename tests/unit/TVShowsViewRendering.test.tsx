/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, act, fireEvent } from '@testing-library/react'
import { TVShowsView } from '@/components/library/TVShowsView'
import { SourceProvider } from '@/contexts/SourceContext'
import { LibraryProvider } from '@/contexts/LibraryContext'
import { ToastProvider } from '@/contexts/ToastContext'
import { ScrollMemoryProvider } from '@/contexts/ScrollMemoryContext'

import React from 'react'
import type { ReactNode, ComponentType } from 'react'
import type { TVShowSummary } from '@/components/library/types'

interface MockVirtuosoProps {
  data?: unknown[]
  itemContent: (index: number, item: unknown) => ReactNode
  components?: { Footer?: ComponentType; List?: ComponentType<{ children?: ReactNode }>; Item?: ComponentType<{ children?: ReactNode }> }
}

// Mock react-virtuoso to render items in JSDOM (infrastructure mock)
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

describe('TVShowsView Rendering (Mocked Bridge)', () => {
  let mockConfig: Record<string, string | undefined> = {}
  let optimizationDryRun: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    mockConfig = {}
    optimizationDryRun = vi.fn().mockResolvedValue({
      totalBytes: 1_000_000_000,
      recoverableBytes: 100_000_000,
      audioPruningBytes: 100_000_000,
      videoDebtBytes: 200_000_000,
      totalRecoverableBytes: 300_000_000,
      totalCombinedSavingsBytes: 300_000_000,
      percentageSavings: 30,
      coverage: 'partial',
      totalEpisodes: 1,
      scoredEpisodes: 1,
      unscoredEpisodes: 0,
      weightedEfficiency: 80,
      trackDecisions: [],
      primaryAction: 'remove-audio-tracks',
      action: 'stream-pruning'
    })

    // Setup real bridge for contexts
    Object.assign(window, { electronAPI: {
      sourcesList: () => Promise.resolve([]),
      getSetting: (key: string) => Promise.resolve(mockConfig[key]),
      setSetting: (key: string, value: string) => {
        mockConfig[key] = value
        return Promise.resolve(true)
      },
      optimizationDryRun,
      log: { info: () => {}, error: () => {}, warn: () => {}, debug: () => {} },
      onSourcesScanProgress: () => () => {},
      onSourcesScanCompleted: () => () => {},
      onScanCompleted: () => () => {},
      onSettingsChanged: () => () => {}
    }})
  })

  afterEach(() => {})

  const defaultProps: Parameters<typeof TVShowsView>[0] = {
    shows: [],
    totalShowCount: 0,
    showsLoading: false,
    onLoadMoreShows: () => {},
    selectedShow: null,
    selectedShowData: null,
    selectedShowLoading: false,
    onSelectShow: () => {},
    onSelectEpisode: () => {},
    filterItem: () => true,
    gridScale: 5,
    viewType: 'grid',
    seriesCompleteness: new Map(),
    onMissingItemClick: () => {},
    showSourceBadge: true,
    onAnalyzeSeries: () => {},
    sortBy: 'title',
    sortOrder: 'asc',
    onSortChange: () => {},
    slimDown: false,
    onDismissUpgrade: () => {}
  }

  const wrap = (view: ReactNode) => (
    <ToastProvider>
      <LibraryProvider>
        <SourceProvider>
          <ScrollMemoryProvider>
            {view}
          </ScrollMemoryProvider>
        </SourceProvider>
      </LibraryProvider>
    </ToastProvider>
  )

  it('should render the TV Shows view header', async () => {
    await act(async () => {
      render(wrap(<TVShowsView {...defaultProps} totalShowCount={0} />))
    })

    expect(screen.getByText(/TV Shows/)).toBeTruthy()
    expect(screen.getByText(/No TV shows found/)).toBeTruthy()
  })

  it('should render show cards when data is present', async () => {
    const shows = [
      { series_title: 'Test Show', season_count: 1, episode_count: 10, source_id: 's1', source_type: 'local' }
    ]

    await act(async () => {
      render(wrap(<TVShowsView {...defaultProps} shows={shows as TVShowSummary[]} totalShowCount={1} />))
    })

    expect(screen.getByText('Test Show')).toBeTruthy()
    expect(screen.getByText(/1 Season • 10 Episodes/)).toBeTruthy()
  })

  it('should show "Analyzing" overlay on shows without efficiency score', async () => {
    const shows = [
      { series_title: 'Unanalyzed Show', season_count: 1, episode_count: 5, source_id: 's1', source_type: 'local' }
    ]

    const seriesCompleteness = new Map([
      ['Unanalyzed Show', { efficiency_score: null, completeness_percentage: 50, owned_episodes: 5, total_episodes: 10 }]
    ])

    await act(async () => {
      render(wrap(
        <TVShowsView
          {...defaultProps}
          shows={shows as TVShowSummary[]}
          totalShowCount={1}
          seriesCompleteness={seriesCompleteness}
          isAnalyzing={true}
        />
      ))
    })

    expect(screen.getByText('Unanalyzed Show')).toBeTruthy()
    expect(screen.getByText('Analyzing')).toBeTruthy()
  })

  it('uses identity-scoped dry run data and displays one canonical recoverable total and percentage', async () => {
    const show = {
      series_title: 'Shared Title',
      series_identity_key: 'tmdb:202',
      source_id: 's1',
      library_id: 'tv',
      source_type: 'local',
      season_count: 1,
      episode_count: 1,
      total_size: 1_000_000_000,
    } as TVShowSummary

    let container!: HTMLElement
    await act(async () => {
      const rendered = render(wrap(<TVShowsView {...defaultProps} shows={[show]} totalShowCount={1} />))
      container = rendered.container
    })

    const menuButton = container.querySelector('button.w-7.h-7')
    expect(menuButton).toBeTruthy()
    fireEvent.click(menuButton!)
    fireEvent.click(screen.getByRole('button', { name: 'Dry-run optimization' }))

    await vi.waitFor(() => {
      expect(optimizationDryRun).toHaveBeenCalledWith('Shared Title', 's1', 'tmdb:202', 'tv')
      expect(screen.getByText(/286 MB \(30\.0%\)/)).toBeTruthy()
      expect(screen.getByText('Recovery evidence: partial')).toBeTruthy()
    })
  })
})
