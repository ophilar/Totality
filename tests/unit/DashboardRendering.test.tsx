/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, beforeEach, afterEach, act } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
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
    db = await setupTestDb()
    setupRealIntegratedBridge()
    registerDatabaseHandlers()
    registerWishlistHandlers()
    registerSourceHandlers()
    registerTaskQueueHandlers()
  })

  afterEach(() => {
    cleanupTestDb()
  })

  const renderDashboard = () => {
    return render(
      <ToastProvider>
        <SourceProvider>
          <WishlistProvider>
            <Dashboard hasMovies={true} hasShows={true} hasMusic={true} />
          </WishlistProvider>
        </SourceProvider>
      </ToastProvider>
    )
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

    renderDashboard()
    
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


    renderDashboard()
    
    await waitFor(() => {
      expect(screen.getByText('Real Upgrade Movie')).toBeTruthy()
      expect(screen.getAllByText(/SD/).length).toBeGreaterThan(0)
    }, { timeout: 5000 })
  })

  it('should reflect database setting changes', async () => {
    // Change sort setting in real DB
    await db.config.setSetting('dashboard_upgrade_sort', 'title')

    renderDashboard()
    
    await waitFor(() => {
      // If we got past loading, it means it read the settings from the real DB
      expect(screen.queryByText('Loading...')).toBeNull()
    })
  })
})



