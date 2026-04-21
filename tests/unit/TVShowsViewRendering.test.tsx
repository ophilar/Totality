/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { TVShowsView } from '../../src/renderer/src/components/library/TVShowsView'
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

describe('TVShowsView Rendering (No Logic Mocks)', () => {
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
      onSettingsChanged: () => () => {}
    }
  })

  afterEach(() => {
    cleanupTestDb()
  })

  const defaultProps: any = {
    shows: [],
    totalShowCount: 0,
    showsLoading: false,
    onLoadMoreShows: () => {},
    selectedShow: null,
    selectedSeason: null,
    selectedShowData: null,
    selectedShowLoading: false,
    onSelectShow: () => {},
    onSelectSeason: () => {},
    onSelectEpisode: () => {},
    filterItem: () => true,
    gridScale: 5,
    viewType: 'grid',
    seriesCompleteness: new Map(),
    onMissingItemClick: () => {},
    showSourceBadge: true,
    onAnalyzeSeries: () => {},
    sortBy: 'title',
    onSortChange: () => {},
    slimDown: false
  }

  it('should render the TV Shows view header', () => {
    render(
      <ToastProvider>
        <LibraryProvider>
          <SourceProvider>
            <TVShowsView {...defaultProps} totalShowCount={0} />
          </SourceProvider>
        </LibraryProvider>
      </ToastProvider>
    )

    expect(screen.getByText(/TV Shows/)).toBeTruthy()
    expect(screen.getByText(/No TV shows found/)).toBeTruthy()
  })

  it('should render show cards when data is present', () => {
    const shows = [
      { series_title: 'Test Show', season_count: 1, episode_count: 10, source_id: 's1', source_type: 'local' }
    ]

    render(
      <ToastProvider>
        <LibraryProvider>
          <SourceProvider>
            <TVShowsView {...defaultProps} shows={shows as any} totalShowCount={1} />
          </SourceProvider>
        </LibraryProvider>
      </ToastProvider>
    )

    expect(screen.getByText('Test Show')).toBeTruthy()
    expect(screen.getByText(/1 Season • 10 Episodes/)).toBeTruthy()
  })

  it('should show "Analyzing" overlay on shows without efficiency score', () => {
    const shows = [
      { series_title: 'Unanalyzed Show', season_count: 1, episode_count: 5, source_id: 's1', source_type: 'local' }
    ]
    
    const seriesCompleteness = new Map([
      ['Unanalyzed Show', { efficiency_score: null, completeness_percentage: 50, owned_episodes: 5, total_episodes: 10 }]
    ])

    render(
      <ToastProvider>
        <LibraryProvider>
          <SourceProvider>
            <TVShowsView 
              {...defaultProps} 
              shows={shows as any} 
              totalShowCount={1} 
              seriesCompleteness={seriesCompleteness as any} 
            />
          </SourceProvider>
        </LibraryProvider>
      </ToastProvider>
    )

    expect(screen.getByText('Unanalyzed Show')).toBeTruthy()
    expect(screen.getByText('Analyzing')).toBeTruthy()
  })
})
