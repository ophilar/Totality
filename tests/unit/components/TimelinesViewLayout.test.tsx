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

describe('TimelinesView Master-Detail Layout', () => {
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
        id: 'star-wars-canon',
        name: 'Star Wars Canon Timeline',
        franchise: 'Star Wars',
        description: 'Complete canon viewing order',
        totalItems: 25,
        sourceType: 'web',
      },
    ])

    api.timelinesResolveTimeline = vi.fn().mockImplementation(async (recipeId: string) => {
      if (recipeId === 'star-wars-canon') {
        return {
          timeline: {
            id: 'star-wars-canon',
            name: 'Star Wars Canon Timeline',
            franchise: 'Star Wars',
            description: 'Complete canon viewing order',
            version: 1,
            sourceUrl: 'https://starwars.example.com/canon',
            items: [
              {
                order: 1,
                type: 'movie',
                title: 'The Phantom Menace',
                timelineEra: '32 BBY',
                identifiers: { tmdbId: 1893 },
              },
            ],
          },
          totalCount: 1,
          matchedCount: 1,
          missingCount: 0,
          completionPercentage: 100,
          items: [
            {
              order: 1,
              type: 'movie',
              title: 'The Phantom Menace',
              timelineEra: '32 BBY',
              identifiers: { tmdbId: 1893 },
              status: 'matched',
              matchedMediaItem: {
                id: 2,
                plexId: '2001',
                sourceId: 'plex-1',
                sourceType: 'plex',
                title: 'The Phantom Menace',
                filePath: '/media/movies/Star Wars TPM.mkv',
                resolution: '4k',
                videoCodec: 'hevc',
                duration: 8100,
              },
            },
          ],
        }
      }

      return {
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
      }
    })
  })

  afterEach(() => {
    cleanupTestDb()
  })

  it('renders master list with recipe search and allows recipe selection', async () => {
    const { container } = render(
      <TestProviders>
        <TimelinesView />
      </TestProviders>
    )

    // Verify root layout structure
    const root = container.firstElementChild
    expect(root?.className).toContain('flex flex-row')
    expect(root?.className).toContain('h-full')
    expect(root?.className).toContain('overflow-hidden')

    // Wait for recipes to load in master pane
    await waitFor(() => {
      expect(screen.getByText('Star Trek (The Chronology Project Order)')).toBeTruthy()
      expect(screen.getByText('Star Wars Canon Timeline')).toBeTruthy()
    })

    // Verify master search input
    const recipeSearchInput = screen.getByPlaceholderText(/search recipes|search franchise/i)
    expect(recipeSearchInput).toBeTruthy()

    // Filter master recipes
    fireEvent.change(recipeSearchInput, { target: { value: 'Star Wars' } })
    expect(screen.queryByText('Star Trek (The Chronology Project Order)')).toBeNull()
    expect(screen.getByText('Star Wars Canon Timeline')).toBeTruthy()

    // Clear search and select Star Wars
    fireEvent.change(recipeSearchInput, { target: { value: '' } })
    const starWarsBtn = screen.getByText('Star Wars Canon Timeline')
    fireEvent.click(starWarsBtn)

    // Verify detail view updates with Star Wars timeline details
    await waitFor(() => {
      expect(screen.getByText('The Phantom Menace')).toBeTruthy()
      expect(screen.getByText(/32 BBY/i)).toBeTruthy()
    })
  })

  it('renders detail view with stats, filters, and items table', async () => {
    render(
      <TestProviders>
        <TimelinesView />
        <ToastContainer />
      </TestProviders>
    )

    await waitFor(() => {
      expect(screen.getByText('Broken Bow')).toBeTruthy()
    })

    // Verify detail pane header and stats
    expect(screen.getByText(/Local Library Completeness/i)).toBeTruthy()
    expect(screen.getByText(/50%/i)).toBeTruthy()

    // Test filter pills
    const matchedPill = screen.getByRole('button', { name: /Matched \(1\)/i })
    fireEvent.click(matchedPill)
    expect(screen.getByText('Broken Bow')).toBeTruthy()
    expect(screen.queryByText('The Vulcan Hello')).toBeNull()

    const missingPill = screen.getByRole('button', { name: /Missing \(1\)/i })
    fireEvent.click(missingPill)
    expect(screen.getByText('The Vulcan Hello')).toBeTruthy()
    expect(screen.queryByText('Broken Bow')).toBeNull()
  })
})
