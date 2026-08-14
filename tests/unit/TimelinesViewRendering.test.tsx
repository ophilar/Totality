/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { TimelinesView } from '@/components/timelines/TimelinesView'
import { setupRealIntegratedBridge, setupTestDb, cleanupTestDb } from '@tests/TestUtils'
import { TestProviders } from '@tests/TestProviders'
import { ToastContainer } from '@/components/ui/Toast'
import React from 'react'

describe('TimelinesView Rendering & Interactions', () => {
  let db: Awaited<ReturnType<typeof setupTestDb>>

  beforeEach(async () => {
    db = await setupTestDb()
    const { api } = setupRealIntegratedBridge(db)

    api.sourcesList = vi.fn().mockResolvedValue([
      {
        source_id: 'plex-1',
        display_name: 'Main Plex Server',
        source_type: 'plex',
        base_url: 'http://localhost:32400',
        api_key: 'token',
        is_enabled: true,
      },
    ])

    api.timelinesListRecipes = vi.fn().mockResolvedValue([
      {
        id: 'star-trek-chronological',
        name: 'Star Trek (The Chronology Project Order)',
        franchise: 'Star Trek',
        description: 'In-universe narrative chronological viewing order',
        totalItems: 18,
        sourceType: 'preset',
      },
      {
        id: 'star-trek-airdate',
        name: 'Star Trek (Air-Date / Release Order)',
        franchise: 'Star Trek',
        description: 'Star Trek TV episodes and movies in the order they originally aired',
        totalItems: 18,
        sourceType: 'preset',
      },
    ])

    api.timelinesResolveTimeline = vi.fn().mockResolvedValue({
      timeline: {
        id: 'star-trek-chronological',
        name: 'Star Trek (The Chronology Project Order)',
        franchise: 'Star Trek',
        description: 'In-universe narrative chronological viewing order',
        version: 1,
        items: [
          {
            order: 1,
            type: 'episode',
            title: 'Broken Bow',
            seriesTitle: 'Star Trek: Enterprise',
            seasonNumber: 1,
            episodeNumber: 1,
            timelineEra: '2151 (22nd Century)',
            identifiers: { tmdbId: 1478, tvdbId: 75711 },
          },
          {
            order: 2,
            type: 'episode',
            title: 'The Vulcan Hello',
            seriesTitle: 'Star Trek: Discovery',
            seasonNumber: 1,
            episodeNumber: 1,
            timelineEra: '2256',
            identifiers: { tmdbId: 67198, tvdbId: 328711 },
          },
        ],
      },
      totalCount: 2,
      matchedCount: 1,
      missingCount: 1,
      completionPercentage: 50,
      items: [
        {
          order: 1,
          type: 'episode',
          title: 'Broken Bow',
          seriesTitle: 'Star Trek: Enterprise',
          seasonNumber: 1,
          episodeNumber: 1,
          timelineEra: '2151 (22nd Century)',
          identifiers: { tmdbId: 1478, tvdbId: 75711 },
          status: 'matched',
          matchedMediaItem: {
            id: 1,
            plexId: '1001',
            sourceId: 'plex-1',
            sourceType: 'plex',
            title: 'Broken Bow',
            filePath: '/media/tv/Enterprise/S01E01.mkv',
            resolution: '1080p',
            videoCodec: 'hevc',
            duration: 2700,
          },
        },
        {
          order: 2,
          type: 'episode',
          title: 'The Vulcan Hello',
          seriesTitle: 'Star Trek: Discovery',
          seasonNumber: 1,
          episodeNumber: 1,
          timelineEra: '2256',
          identifiers: { tmdbId: 67198, tvdbId: 328711 },
          status: 'missing',
        },
      ],
    })

    api.timelinesSyncPlexPlaylist = vi.fn().mockResolvedValue({
      success: true,
      playlistTitle: 'Star Trek (The Chronology Project Order)',
      playlistRatingKey: '9999',
      totalItemsInTimeline: 2,
      matchedItemsSynced: 1,
      missingItemsCount: 1,
    })
  })

  afterEach(() => {
    cleanupTestDb()
  })

  it('renders franchise timelines header and recipes list', async () => {
    render(
      <TestProviders>
        <TimelinesView />
      </TestProviders>
    )

    await waitFor(() => {
      expect(screen.getByText('Franchise Timelines & Playlists')).toBeTruthy()
      expect(screen.getAllByText(/Chronology Project Order/i).length).toBeGreaterThan(0)
    }, { timeout: 4000 })
  })


  it('resolves timeline items against test database and displays matched items', async () => {
    render(
      <TestProviders>
        <TimelinesView />
      </TestProviders>
    )

    await waitFor(() => {
      expect(screen.getByText('Broken Bow')).toBeTruthy()
    })

    // Check matched status and badges
    const matchedBadges = screen.getAllByText(/Matched/i)
    expect(matchedBadges.length).toBeGreaterThan(0)
  })

  it('supports filtering by matched and missing items', async () => {
    render(
      <TestProviders>
        <TimelinesView />
      </TestProviders>
    )

    await waitFor(() => {
      expect(screen.getByText('Broken Bow')).toBeTruthy()
    })

    // Click Missing filter
    const missingFilterBtn = screen.getByRole('button', { name: /Missing/i })
    fireEvent.click(missingFilterBtn)

    await waitFor(() => {
      // Missing items like "The Vulcan Hello" should be shown
      expect(screen.getByText('The Vulcan Hello')).toBeTruthy()
      // Matched item "Broken Bow" should not be in the filtered table
      expect(screen.queryByText('Broken Bow')).toBeNull()
    })
  })

  it('supports syncing to Plex playlist', async () => {
    render(
      <TestProviders>
        <TimelinesView />
        <ToastContainer />
      </TestProviders>
    )

    await waitFor(() => {
      expect(screen.getByText('Broken Bow')).toBeTruthy()
    })

    const syncButton = screen.getByRole('button', { name: /Sync to Plex Playlist/i })
    expect(syncButton).toBeTruthy()
    fireEvent.click(syncButton)

    await waitFor(() => {
      expect(screen.getByText(/Successfully synced playlist/i)).toBeTruthy()
    })
  })
})
