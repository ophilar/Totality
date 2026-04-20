/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Dashboard } from '../../src/renderer/src/components/dashboard/Dashboard'
import { useSources } from '../../src/renderer/src/contexts/SourceContext'
import { useDashboardData } from '../../src/renderer/src/components/dashboard/hooks/useDashboardData'
import { useWishlist } from '../../src/renderer/src/contexts/WishlistContext'
import React from 'react'

// Mock the contexts and hooks
vi.mock('../../src/renderer/src/contexts/SourceContext', () => ({
  useSources: vi.fn(),
}))

vi.mock('../../src/renderer/src/components/dashboard/hooks/useDashboardData', () => ({
  useDashboardData: vi.fn(),
}))

vi.mock('../../src/renderer/src/contexts/WishlistContext', () => ({
  useWishlist: vi.fn(),
}))

// Mock virtualized list to avoid measurement issues in test environment
vi.mock('react-window', () => ({
  VariableSizeList: ({ children, itemCount }: any) => (
    <div data-testid="virtual-list">
      {Array.from({ length: itemCount }).map((_, i) => children({ index: i, style: { top: i * 100 } }))}
    </div>
  ),
}))

describe('Dashboard Rendering', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    ;(useSources as any).mockReturnValue({
      sources: [{ source_id: 's1' }],
      activeSourceId: undefined,
    })
    ;(useWishlist as any).mockReturnValue({
      items: [],
      addItem: vi.fn(),
    })
  })

  it('should show skeletons when loading', () => {
    ;(useDashboardData as any).mockReturnValue({
      movieUpgrades: [],
      tvUpgrades: [],
      musicUpgrades: [],
      collections: [],
      series: [],
      artists: [],
      isLoading: true,
      error: null,
    })

    render(<Dashboard hasMovies={true} />)
    
    // Check for skeleton elements (DashboardRowSkeleton contains animate-pulse)
    const skeletons = document.querySelectorAll('.animate-pulse')
    expect(skeletons.length).toBeGreaterThan(0)
  })

  it('should show empty state when no data and not loading', () => {
    ;(useDashboardData as any).mockReturnValue({
      movieUpgrades: [],
      tvUpgrades: [],
      musicUpgrades: [],
      collections: [],
      series: [],
      artists: [],
      isLoading: false,
      error: null,
    })

    render(<Dashboard hasMovies={true} />)
    
    expect(screen.getByText('All caught up!')).toBeTruthy()
  })

  it('should render upgrade rows when data is present', () => {
    ;(useDashboardData as any).mockReturnValue({
      movieUpgrades: [{ id: 1, title: 'Test Movie', quality_tier: 'SD', tier_quality: 'LOW', overall_score: 50 }],
      tvUpgrades: [],
      musicUpgrades: [],
      collections: [],
      series: [],
      artists: [],
      isLoading: false,
      error: null,
      upgradeSortBy: 'quality',
    })

    render(<Dashboard hasMovies={true} />)
    
    expect(screen.getByText('Test Movie')).toBeTruthy()
    expect(screen.getByText(/SD/)).toBeTruthy()
  })

  it('should show error state', () => {
    ;(useDashboardData as any).mockReturnValue({
      movieUpgrades: [],
      tvUpgrades: [],
      musicUpgrades: [],
      collections: [],
      series: [],
      artists: [],
      isLoading: false,
      error: 'Failed to load dashboard',
    })

    render(<Dashboard />)
    
    expect(screen.getByText('Failed to load dashboard')).toBeTruthy()
    expect(screen.getByText('Try Again')).toBeTruthy()
  })
})
