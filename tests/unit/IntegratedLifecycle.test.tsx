/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, act, waitFor } from '@testing-library/react'
import { MediaBrowser } from '@/components/library/MediaBrowser'
import { setupRealIntegratedBridge, setupTestDb, cleanupTestDb } from '@tests/TestUtils'
import { TVShowRepository } from '@main/database/repositories/TVShowRepository'
import { MediaRepository } from '@main/database/repositories/MediaRepository'
import { TestProviders } from '@tests/TestProviders'
import React from 'react'

// Mock the heavy event listener hook to prevent background noise during tests
vi.mock('@/components/library/hooks/useLibraryEventListeners', () => ({
  useLibraryEventListeners: () => {}
}))

describe('MediaBrowser Lifecycle Integration', () => {
  let db: any

  beforeEach(async () => {
    db = await setupTestDb()
    setupRealIntegratedBridge()
  }, 60000)

  afterEach(() => {
    cleanupTestDb()
  })

  it('should display TV shows with 100% completeness when unmatched but local episodes exist', async () => {
    const { api } = setupRealIntegratedBridge()
    const tvRepo = db.tvShows
    const mediaRepo = db.media

    // 1. Simulate a scan result
    const seriesTitle = 'Local Show'
    
    // Ensure source and library are enabled in DB so stats/visibility logic works
    await db.sources.upsertSource({
      source_id: 'src-1',
      source_type: 'local',
      display_name: 'Test Source',
      connection_config: '{}',
      is_enabled: 1
    } as any)
    await db.sources.setLibrariesEnabled('src-1', [{ id: 'lib-1', name: 'TV', type: 'show', enabled: true }])

    await mediaRepo.upsertItem({
      plex_id: 'local_s1e1',
      series_title: seriesTitle,
      title: 'Episode 1',
      season_number: 1,
      episode_number: 1,
      type: 'episode',
      source_id: 'src-1',
      library_id: 'lib-1',
      file_path: '/path/s1e1.mkv',
      resolution: '1080p',
      file_size: 1000000,
      duration: 3600000,
      video_codec: 'h264',
      video_bitrate: 5000,
      audio_codec: 'aac',
      audio_channels: 2,
      audio_bitrate: 128,
      width: 1920,
      height: 1080,
    } as any)

    await tvRepo.upsertCompleteness({
      series_title: seriesTitle,
      source_id: 'src-1',
      library_id: 'lib-1',
      total_seasons: 1,
      total_episodes: 1,
      owned_seasons: 1,
      owned_episodes: 1,
      completeness_percentage: 100,
      status: 'Continuing'
    } as any)

    // Ensure source context has a source so the tab appears
    api.sourcesList = vi.fn().mockResolvedValue([{
      source_id: 'src-1',
      display_name: 'Test Source',
      source_type: 'local',
      is_enabled: 1
    }])

    // 2. Render UI
    render(<MediaBrowser />, { wrapper: TestProviders })

    // 3. Wait for the TV Shows button and click it
    const tvTab = await screen.findByRole('button', { name: /TV Shows/i }, { timeout: 30000 })
    expect((tvTab as HTMLButtonElement).disabled).toBe(false)
    await act(async () => {
      tvTab.click()
    })

    // 4. Verify show is visible
    await waitFor(() => {
      expect(screen.queryByText(seriesTitle)).not.toBeNull()
      expect(screen.queryByText('100%')).not.toBeNull()
    }, { timeout: 30000 })
  }, 120000)

  it('should show loading spinner when entering show details', async () => {
    const { api } = setupRealIntegratedBridge()
    const tvRepo = db.tvShows

    // Ensure source and library are enabled and has at least one episode for stats
    await db.sources.upsertSource({
      source_id: 'src-1',
      source_type: 'local',
      display_name: 'Test Source',
      connection_config: '{}',
      is_enabled: 1
    } as any)
    await db.sources.setLibrariesEnabled('src-1', [{ id: 'lib-1', name: 'TV', type: 'show', enabled: true }])
    
    await db.media.upsertItem({
      plex_id: 'local_s2e1',
      series_title: 'Slow Show',
      title: 'Episode 1',
      type: 'episode',
      source_id: 'src-1',
      library_id: 'lib-1',
      file_path: '/path/slow_s2e1.mkv',
    } as any)
    
    await tvRepo.upsertCompleteness({
      series_title: 'Slow Show',
      source_id: 'src-1',
      library_id: 'lib-1',
      total_seasons: 1,
      total_episodes: 10,
      owned_seasons: 1,
      owned_episodes: 10,
      completeness_percentage: 100,
    } as any)

    // Delay the episode fetching to see the loading state
    let resolveEpisodes: any
    const delayedGetEpisodes = vi.fn().mockImplementation(() => new Promise(resolve => {
      resolveEpisodes = resolve
    }))

    // Patch the bridge
    api.seriesGetEpisodes = delayedGetEpisodes

    render(<MediaBrowser />, { wrapper: TestProviders })

    // Switch to TV
    const tvTab = await screen.findByRole('button', { name: /TV Shows/i }, { timeout: 30000 })
    await act(async () => {
      tvTab.click()
    })

    // Click the show
    const showCard = await screen.findByText('Slow Show', {}, { timeout: 20000 })
    await act(async () => {
      showCard.click()
    })

    // Verify loading state is visible
    expect(screen.getByText(/Loading episodes/i)).toBeTruthy()

    // Resolve the promise
    await act(async () => {
      resolveEpisodes([])
    })

    // Verify loading state is gone
    await waitFor(() => {
      expect(screen.queryByText(/Loading episodes/i)).toBeNull()
    }, { timeout: 20000 })
  }, 120000)
})

