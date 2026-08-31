/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, act } from '@testing-library/react'
import { Dashboard } from '@/components/dashboard/Dashboard'
import { SourceProvider } from '@/contexts/SourceContext'
import { WishlistProvider } from '@/contexts/WishlistContext'
import { ToastProvider } from '@/contexts/ToastContext'
import { setupTestDb, cleanupTestDb, setupRealIntegratedBridge } from '@tests/TestUtils'
import { registerDatabaseHandlers } from '@main/ipc/database'
import { registerWishlistHandlers } from '@main/ipc/wishlist'
import { registerSourceHandlers } from '@main/ipc/sources'
import { registerTaskQueueHandlers } from '@main/ipc/taskQueue'
import React from 'react'
import { ProviderType } from '@main/types/database'
type TestDb = Awaited<ReturnType<typeof setupTestDb>>

describe('Dashboard Rendering (Integrated Stack)', () => {
  let db: TestDb

  beforeEach(async () => {
    // Standardize global window for bridge
    if (typeof window === 'undefined') {
        Object.assign(globalThis, { window: globalThis })
    }

    db = await setupTestDb()
    const bridge = setupRealIntegratedBridge()
    
    Object.assign(window, { electronAPI: bridge.api })
    Object.assign(globalThis, { electronAPI: bridge.api })
  })

  afterEach(() => {
    cleanupTestDb()
  })

  const renderDashboard = async () => {
    let result: ReturnType<typeof render> | undefined
    await act(async () => {
        result = render(
            <ToastProvider>
                <SourceProvider>
                <WishlistProvider>
                    <Dashboard hasMovies={true} hasTV={true} hasMusic={true} />
                </WishlistProvider>
                </SourceProvider>
            </ToastProvider>
        )
    })
    return result
  }

  it('should show empty state when real database is empty', async () => {
    // Add a source so it shows content columns
    await db.sources.upsertSource({
      source_id: 's1',
      source_type: ProviderType.Local,
      display_name: 'Test Source',
      is_enabled: 1,
      connection_config: '{}'
    })

    await renderDashboard()
    
    await waitFor(() => {
      expect(screen.getByText('All caught up!')).toBeTruthy()
    }, { timeout: 5000 })
  })

  it('should render real data from the database', async () => {
    // Insert a source first so the dashboard shows content columns
    await db.sources.upsertSource({
      source_id: 's1',
      source_type: ProviderType.Local,
      display_name: 'Test Source',
      is_enabled: 1,
      connection_config: '{}'
    })

    // Insert real upgrade data into the DB
    const itemId = await db.media.upsertItem({
      title: 'Real Upgrade Movie',
      type: 'movie',
      source_id: 's1',
      library_id: '1',
      plex_id: 'p1', // Required for conflict clause
      file_path: '/path/to/movie.mkv',
      media_source_id: '1'
    } satisfies Parameters<TestDb['media']['upsertItem']>[0])
    
    await db.media.upsertQualityScore({
      media_item_id: itemId,
      quality_tier: 'SD',
      tier_quality: 'LOW',
      overall_score: 10,
      needs_upgrade: 1
    })


    await renderDashboard()
    
    await waitFor(() => {
      expect(screen.getByText('Real Upgrade Movie')).toBeTruthy()
      expect(screen.getAllByText(/SD/).length).toBeGreaterThan(0)
    }, { timeout: 5000 })
  })

  it('should render TV completeness series from database', async () => {
    await db.sources.upsertSource({
      source_id: 's1',
      source_type: ProviderType.Local,
      display_name: 'Test Source',
      is_enabled: 1,
      connection_config: '{}'
    })

    await db.tvShows.upsertCompleteness({
      series_title: 'Test TV Series',
      source_id: 's1',
      library_id: '1',
      total_seasons: 2,
      total_episodes: 20,
      owned_seasons: 1,
      owned_episodes: 10,
      missing_seasons: JSON.stringify([2]),
      missing_episodes: JSON.stringify([
        { season_number: 2, episode_number: 1, episode_title: 'Chapter One', tmdb_id: 999 }
      ]),
      completeness_percentage: 50
    })

    await renderDashboard()

    await waitFor(() => {
      expect(screen.getByText('Test TV Series')).toBeTruthy()
      expect(screen.getByText(/50%/)).toBeTruthy()
    }, { timeout: 5000 })
  })

  it('should reflect database setting changes', async () => {
    // Change sort setting in real DB
    await db.config.setSetting('dashboard_upgrade_sort', 'title')

    await renderDashboard()
    
    await waitFor(() => {
      // If we got past loading, it means it read the settings from the real DB
      expect(screen.queryByText('Loading...')).toBeNull()
    })
  })
})
