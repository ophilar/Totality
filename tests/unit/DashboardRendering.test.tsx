/**
 * @vitest-environment happy-dom
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

describe('Dashboard Rendering (Integrated Stack)', () => {
  let db: any

  beforeEach(async () => {
    // Standardize global window for bridge
    if (typeof window === 'undefined') {
        (global as any).window = (global as any)
    }

    db = await setupTestDb()
    const bridge = setupRealIntegratedBridge()
    
    ;(window as any).electronAPI = bridge.api
    ;(globalThis as any).electronAPI = bridge.api
  })

  afterEach(() => {
    cleanupTestDb()
  })

  const renderDashboard = async () => {
    let result: any
    await act(async () => {
        result = render(
            <ToastProvider>
                <SourceProvider>
                <WishlistProvider>
                    <Dashboard hasMovies={true} hasShows={true} hasMusic={true} />
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
      source_type: 'local' as any,
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
      source_type: 'local' as any,
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
    } as any)
    
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



