/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, waitFor, act, fireEvent, within } from '@testing-library/react'
import { MediaDetails } from '@/components/library/MediaDetails'
import { WishlistView } from '@/components/library/WishlistView'
import { DuplicatesView } from '@/components/library/DuplicatesView'
import { setupTestDb, cleanupTestDb, setupRealIntegratedBridge } from '@tests/TestUtils'
import { ToastProvider } from '@/contexts/ToastContext'
import { SourceProvider } from '@/contexts/SourceContext'
import { registerDatabaseHandlers } from '@main/ipc/database'
import { registerSourceHandlers } from '@main/ipc/sources'
import { registerTranscodingHandlers } from '@main/ipc/transcoding'
import { registerSeriesHandlers } from '@main/ipc/series'
import { registerDuplicateHandlers } from '@main/ipc/duplicates'
import { registerMusicHandlers } from '@main/ipc/music'
import { registerWishlistHandlers } from '@main/ipc/wishlist'
import { registerGeminiHandlers } from '@main/ipc/gemini'
import { sql } from 'drizzle-orm'
import React from 'react'

describe('Renderer UI Deep Dive (Integrated Stack)', () => {
  let db: any

  beforeEach(async () => {
    if (typeof window === 'undefined') {
        (global as any).window = (global as any)
    }

    db = await setupTestDb()
    const bridge = setupRealIntegratedBridge()
    
    ;(window as any).electronAPI = bridge.api
    ;(globalThis as any).electronAPI = bridge.api

    registerDatabaseHandlers()
    registerSourceHandlers()
    registerTranscodingHandlers()
    registerSeriesHandlers()
    registerDuplicateHandlers()
    registerMusicHandlers()
    registerWishlistHandlers()
    registerGeminiHandlers()
  })

  afterEach(async () => {
    vi.clearAllTimers()
    await cleanupTestDb()
  })

  const renderWithProviders = (ui: React.ReactElement) => {
    return render(
      <ToastProvider>
        <SourceProvider>
            {ui}
        </SourceProvider>
      </ToastProvider>
    )
  }

  describe('MediaDetails', () => {
    it('should render media details and versions', async () => {
      await db.sources.upsertSource({ 
        source_id: 's1', source_type: 'local', display_name: 'Local', is_enabled: 1, connection_config: '{}' 
      })
      const now = new Date().toISOString()
      await db.drizzle.run(sql`INSERT INTO library_scans (source_id, library_id, library_name, library_type, is_enabled, is_protected, created_at, updated_at) VALUES ('s1', 'lib1', 'Library 1', 'movie', 1, 0, ${now}, ${now})`)
      
      const mediaId = await db.media.upsertItem({
        source_id: 's1', library_id: 'lib1', plex_id: 'm1', title: 'Details Movie', type: 'movie', file_path: 'movie.mkv',
        resolution: '4K', video_codec: 'hevc', video_bitrate: 50000
      } as any)

      await db.media.upsertQualityScore({
        media_item_id: mediaId, quality_tier: '4K', tier_quality: 'HIGH', overall_score: 95
      })

      await act(async () => {
        renderWithProviders(<MediaDetails mediaId={mediaId} onClose={() => {}} />)
      })

      await waitFor(() => {
        expect(screen.getByText('Details Movie')).toBeTruthy()
        expect(screen.getByText('4K')).toBeTruthy()
      })
    })
  })

  describe('WishlistView', () => {
    it('should render upgrades and missing items', async () => {
      await db.sources.upsertSource({ 
        source_id: 's1', source_type: 'local', display_name: 'Local', is_enabled: 1, connection_config: '{}' 
      })
      const now = new Date().toISOString()
      await db.drizzle.run(sql`INSERT INTO library_scans (source_id, library_id, library_name, library_type, is_enabled, is_protected, created_at, updated_at) VALUES ('s1', 'lib1', 'Library 1', 'movie', 1, 0, ${now}, ${now})`)

      const mediaId = await db.media.upsertItem({
        source_id: 's1', library_id: 'lib1', plex_id: 'u1', title: 'Bad Quality Movie', type: 'movie', file_path: 'bad.mkv'
      } as any)

      await db.media.upsertQualityScore({
        media_item_id: mediaId, quality_tier: 'SD', tier_quality: 'LOW', needs_upgrade: 1
      })

      await act(async () => {
        renderWithProviders(<WishlistView />)
      })

      await waitFor(() => {
        expect(screen.getByText('Bad Quality Movie')).toBeTruthy()
      })

      const missingTab = screen.getByText(/Missing/i)
      await act(async () => {
        fireEvent.click(missingTab)
      })

      await waitFor(() => {
        expect(screen.getByText(/No missing items found/i)).toBeTruthy()
      })
    })
  })

  describe('DuplicatesView', () => {
    it('should render empty state and handle scan', async () => {
      await act(async () => {
        renderWithProviders(<DuplicatesView />)
      })

      await waitFor(() => {
        expect(screen.getByText(/No Duplicates Found/i)).toBeTruthy()
      })

      const scanBtn = screen.getByText(/Scan for Duplicates/i)
      await act(async () => {
        fireEvent.click(scanBtn)
      })

      await waitFor(() => {
        expect(screen.getByText(/Run a manual scan/i)).toBeTruthy()
      })
    })
    
    it('should render real duplicate groups', async () => {
        // Setup source
        await db.sources.upsertSource({ 
            source_id: 's1', source_type: 'local', display_name: 'Local', is_enabled: 1, connection_config: '{}' 
        })

        // Insert items
        const id1 = await db.media.upsertItem({
            source_id: 's1', plex_id: 'm1-f1', title: 'Duplicate Movie', type: 'movie', file_path: 'file1.mkv'
        } as any)
        const id2 = await db.media.upsertItem({
            source_id: 's1', plex_id: 'm1-f2', title: 'Duplicate Movie', type: 'movie', file_path: 'file2.mkv'
        } as any)

        // Insert duplicate group
        await db.duplicates.upsertDuplicate({
            source_id: 's1',
            external_id: 'tmdb-1',
            external_type: 'tmdb_movie',
            media_item_ids: JSON.stringify([id1, id2]),
            status: 'pending'
        })

        await act(async () => {
            renderWithProviders(<DuplicatesView />)
        })

        await waitFor(() => {
            expect(screen.getByText('Duplicate Movie')).toBeTruthy()
            expect(screen.getByText(/2 versions/i)).toBeTruthy()
        })
    })
  })
})
