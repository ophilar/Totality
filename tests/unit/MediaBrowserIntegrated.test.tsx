/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react'
import { MediaBrowser } from '@/components/library/MediaBrowser'
import { SourceProvider } from '@/contexts/SourceContext'
import { LibraryProvider } from '@/contexts/LibraryContext'
import { WishlistProvider } from '@/contexts/WishlistContext'
import { ToastProvider } from '@/contexts/ToastContext'
import { ScrollMemoryProvider } from '@/contexts/ScrollMemoryContext'
import { setupTestDb, cleanupTestDb, setupRealIntegratedBridge } from '@tests/TestUtils'
import { registerDatabaseHandlers } from '@main/ipc/database'
import { registerSourceHandlers } from '@main/ipc/sources'
import { registerTaskQueueHandlers } from '@main/ipc/taskQueue'
import { registerWishlistHandlers } from '@main/ipc/wishlist'
import { registerCollectionHandlers } from '@main/ipc/collections'
import { registerSeriesHandlers } from '@main/ipc/series'
import { registerMusicHandlers } from '@main/ipc/music'
import { registerLoggingHandlers } from '@main/ipc/logging'
import { registerMonitoringHandlers } from '@main/ipc/monitoring'
import { ProviderType, LibraryType } from '@main/types/database'
import React from 'react'

describe('MediaBrowser (Integrated Stack)', () => {
  let db: any

  beforeEach(async () => {
    // Explicitly define window on global if missing
    if (typeof window === 'undefined') {
        (global as any).window = (global as any)
    }

    db = await setupTestDb()
    const bridge = setupRealIntegratedBridge()
    
    ;(window as any).electronAPI = bridge.api
    ;(globalThis as any).electronAPI = bridge.api

    registerDatabaseHandlers()
    registerSourceHandlers()
    registerTaskQueueHandlers()
    registerWishlistHandlers()
    registerCollectionHandlers()
    registerSeriesHandlers()
    registerMusicHandlers()
    registerLoggingHandlers()
    registerMonitoringHandlers()
  })

  afterEach(async () => {
    // Ensure all timers are cleared to avoid async ReferenceErrors
    vi.clearAllTimers()
    await cleanupTestDb()
  })

  const renderBrowser = async () => {
    let result: any
    await act(async () => {
        result = render(
            <ToastProvider>
                <SourceProvider>
                <LibraryProvider>
                    <WishlistProvider>
                        <ScrollMemoryProvider>
                            <MediaBrowser onOpenSettings={() => {}} onNavigateHome={() => {}} />
                        </ScrollMemoryProvider>
                    </WishlistProvider>
                </LibraryProvider>
                </SourceProvider>
            </ToastProvider>
        )
    })
    return result
  }

  it('should render the library browser with all filters', async () => {
    await renderBrowser()
    
    expect(screen.getByPlaceholderText(/Search all libraries/i)).toBeTruthy()
    expect(screen.getAllByText(/Movies/i).length).toBeGreaterThan(0)
  })

  it('should display real movies from the database', async () => {
    // Add a source and a movie
    await db.sources.upsertSource({ 
        source_id: 's1', source_type: 'local', display_name: 'Local', is_enabled: 1, connection_config: JSON.stringify({ folderPath: '/data' })
    })
    
    await db.sources.setLibrariesEnabled('s1', [
        { id: '1', name: 'Movies', type: 'movie', enabled: true }
    ])

    await db.media.upsertItem({
        source_id: 's1',
        library_id: '1',
        plex_id: 'm1',
        title: 'Integrated Test Movie',
        type: 'movie',
        file_path: 'test.mkv'
    } as any)

    await renderBrowser()

    // Dashboard bootstrap sets total movie count
    await waitFor(() => {
        expect(screen.getByText('Integrated Test Movie')).toBeTruthy()
    }, { timeout: 5000 })
  })

  it('should switch to TV Shows view when clicked', async () => {
    // Setup source with TV library and an episode
    await db.sources.upsertSource({ 
        source_id: 's1', source_type: 'local', display_name: 'Local', is_enabled: 1, connection_config: JSON.stringify({ folderPath: '/data' })
    })
    
    await db.sources.setLibrariesEnabled('s1', [
        { id: '2', name: 'TV', type: 'show', enabled: true }
    ])

    // Important: we need a summary record for the count to be > 0 and the tab enabled
    await db.tvShows.upsertCompleteness({
        series_title: 'Test Show',
        source_id: 's1',
        library_id: '2',
        plex_id: 's1-show',
        total_seasons: 1,
        total_episodes: 1,
        owned_seasons: 1,
        owned_episodes: 1,
        completeness_percentage: 100
    } as any)

    await db.media.upsertItem({
        source_id: 's1', library_id: '2', plex_id: 'ep1', title: 'Ep 1', type: 'episode', series_title: 'Test Show', file_path: 'e1.mkv'
    } as any)

    await renderBrowser()
    
    await waitFor(() => {
        const tvButton = screen.getByRole('button', { name: /TV Shows/i })
        expect(tvButton.hasAttribute('disabled')).toBe(false)
    }, { timeout: 5000 })

    const tvButton = screen.getByRole('button', { name: /TV Shows/i })
    await act(async () => {
        fireEvent.click(tvButton)
    })

    await waitFor(() => {
        // Look for the show count span in the TV shows view header
        expect(screen.getByText(/1 shows/i)).toBeTruthy()
        expect(screen.getByText('Test Show')).toBeTruthy()
    })
  })
})
