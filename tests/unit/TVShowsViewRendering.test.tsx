/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { TVShowsView } from '../../src/renderer/src/components/library/TVShowsView'
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

describe('TVShowsView Rendering', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('should show "Scan in Progress" when scanning and no shows found', () => {
    ;(useSources as any).mockReturnValue({
      isScanning: true,
      scanProgress: new Map([['test-source', { phase: 'fetching', percentage: 10, currentItem: 'Scanning...' }]]),
    })

    render(
      <TVShowsView
        shows={[]}
        sortBy="title"
        onSortChange={() => {}}
        slimDown={false}
        selectedShow={null}
        selectedSeason={null}
        selectedShowData={null}
        selectedShowLoading={false}
        onSelectShow={() => {}}
        onSelectSeason={() => {}}
        onSelectEpisode={() => {}}
        filterItem={() => true}
        gridScale={5}
        viewType="grid"
        seriesCompleteness={new Map()}
        onMissingItemClick={() => {}}
        showSourceBadge={true}
        onAnalyzeSeries={() => {}}
        totalShowCount={0}
        totalEpisodeCount={0}
        showsLoading={false}
        onLoadMoreShows={() => {}}
      />
    )

    expect(screen.getByText(/Scan:/)).toBeTruthy()
    expect(screen.getByText(/fetching/)).toBeTruthy()
  })

  it('should render show cards when data is present', () => {
    ;(useSources as any).mockReturnValue({
      isScanning: false,
      scanProgress: new Map(),
    })

    const shows = [
      { series_title: 'Test Show', season_count: 1, episode_count: 10, source_id: 's1', source_type: 'local' }
    ]

    render(
      <TVShowsView
        shows={shows as any}
        sortBy="title"
        onSortChange={() => {}}
        slimDown={false}
        selectedShow={null}
        selectedSeason={null}
        selectedShowData={null}
        selectedShowLoading={false}
        onSelectShow={() => {}}
        onSelectSeason={() => {}}
        onSelectEpisode={() => {}}
        filterItem={() => true}
        gridScale={5}
        viewType="grid"
        seriesCompleteness={new Map()}
        onMissingItemClick={() => {}}
        showSourceBadge={true}
        onAnalyzeSeries={() => {}}
        totalShowCount={1}
        totalEpisodeCount={10}
        showsLoading={false}
        onLoadMoreShows={() => {}}
      />
    )

    expect(screen.getByText('Test Show')).toBeTruthy()
    expect(screen.getByText(/1 Season • 10 Episodes/)).toBeTruthy()
  })

  it('should show "Analyzing" overlay on shows without efficiency score', () => {
    ;(useSources as any).mockReturnValue({
      isScanning: false,
      scanProgress: new Map(),
    })

    const shows = [
      { series_title: 'Unanalyzed Show', season_count: 1, episode_count: 5, source_id: 's1', source_type: 'local' }
    ]
    
    const seriesCompleteness = new Map([
      ['Unanalyzed Show', { efficiency_score: null, completeness_percentage: 50, owned_episodes: 5, total_episodes: 10 }]
    ])

    render(
      <TVShowsView
        shows={shows as any}
        sortBy="title"
        onSortChange={() => {}}
        slimDown={false}
        selectedShow={null}
        selectedSeason={null}
        selectedShowData={null}
        selectedShowLoading={false}
        onSelectShow={() => {}}
        onSelectSeason={() => {}}
        onSelectEpisode={() => {}}
        filterItem={() => true}
        gridScale={5}
        viewType="grid"
        seriesCompleteness={seriesCompleteness as any}
        onMissingItemClick={() => {}}
        showSourceBadge={true}
        onAnalyzeSeries={() => {}}
        totalShowCount={1}
        totalEpisodeCount={5}
        showsLoading={false}
        onLoadMoreShows={() => {}}
      />
    )

    expect(screen.getByText('Unanalyzed Show')).toBeTruthy()
    expect(screen.getByText('Analyzing')).toBeTruthy()
  })
})
