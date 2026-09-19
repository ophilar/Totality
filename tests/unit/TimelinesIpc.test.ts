import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setupTestDb, cleanupTestDb, setupRealIntegratedBridge, createAuthorizedIpcEvent } from '@tests/TestUtils'
import { IPC_CHANNELS } from '@main/constants/ipcChannels'
import type { TimelineRecipeSummary, TimelineDefinition } from '@main/services/timelines/ITimelineRecipeProvider'
import type { ResolvedTimelineResult } from '@main/services/timelines/TimelineResolutionEngine'

describe('Timelines IPC Handlers (Real Integrated Bridge)', () => {
  let db: Awaited<ReturnType<typeof setupTestDb>>
  let handlers: ReturnType<typeof setupRealIntegratedBridge>['handlers']

  beforeEach(async () => {
    db = await setupTestDb()
    const bridge = setupRealIntegratedBridge()
    handlers = bridge.handlers

    await db.sources.upsertSource({
      source_id: 'src-plex',
      source_type: 'plex',
      display_name: 'Plex Home',
      connection_config: JSON.stringify({ token: 'secret-token', serverId: 'mach-1' }),
      is_enabled: 1,
    })

    const mockRecipe: TimelineDefinition = {
      id: 'star-trek-chronological',
      franchise: 'Example Saga',
      name: 'Example Saga: Chronological Order',
      description: 'Complete universe chronological order',
      version: 1,
      items: [
        {
          order: 1,
          type: 'episode',
          title: 'Broken Bow',
          seriesTitle: 'Example Saga: Enterprise',
          seasonNumber: 1,
          episodeNumber: 1,
          timelineEra: '2151',
          identifiers: { tmdbId: 1478, tvdbId: 75711 },
        },
        {
          order: 2,
          type: 'show',
          title: 'Example Saga: The Original Series',
          seriesTitle: 'Example Saga: The Original Series',
          timelineEra: '2265-2269',
          identifiers: { tmdbId: 253, tvdbId: 77271 },
        },
        {
          order: 3,
          type: 'movie',
          title: 'Example Saga II: The Wrath of Khan',
          timelineEra: '2285',
          identifiers: { tmdbId: 154, imdbId: 'tt0084726' },
        },
      ],
    }

    const mockManifest: TimelineRecipeSummary[] = [
      {
        id: 'star-trek-chronological',
        name: 'Example Saga: Chronological Order',
        franchise: 'Example Saga',
        description: 'Complete chronological order',
        totalItems: 3,
        sourceType: 'remote',
      },
    ]

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const urlStr = String(url)
      if (urlStr.includes('manifest.json')) {
        return {
          ok: true,
          status: 200,
          json: async () => mockManifest,
        } as Response
      }
      return {
        ok: true,
        status: 200,
        json: async () => mockRecipe,
      } as Response
    })
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    await cleanupTestDb()
  })

  it('lists preset timeline recipes via IPC', async () => {
    const listHandler = handlers.get(IPC_CHANNELS.TIMELINES.LIST_RECIPES)!
    expect(listHandler).toBeDefined()

    const recipes = (await listHandler(createAuthorizedIpcEvent())) as TimelineRecipeSummary[]
    expect(recipes).toBeDefined()
    expect(recipes.length).toBeGreaterThanOrEqual(1)

    const starTrekChrono = recipes.find((r) => r.id === 'star-trek-chronological')
    expect(starTrekChrono).toBeDefined()
    expect(starTrekChrono?.franchise).toBe('Example Saga')
  })

  it('retrieves a timeline recipe definition via IPC', async () => {
    const getRecipeHandler = handlers.get(IPC_CHANNELS.TIMELINES.GET_RECIPE)!
    expect(getRecipeHandler).toBeDefined()

    const timeline = (await getRecipeHandler(createAuthorizedIpcEvent(), 'star-trek-chronological')) as TimelineDefinition
    expect(timeline).toBeDefined()
    expect(timeline.id).toBe('star-trek-chronological')
    expect(timeline.items.length).toBeGreaterThan(0)
  })

  it('resolves a timeline against local media items via IPC', async () => {
    await db.media.upsertItem({
      source_id: 'src-plex',
      source_type: 'plex',
      plex_id: '1001',
      title: 'Broken Bow',
      series_title: 'Example Saga: Enterprise',
      type: 'episode',
      season_number: 1,
      episode_number: 1,
      series_identity_key: 'tmdb:1478',
      file_path: 'D:/TV/Example Saga Enterprise/S01E01.mkv',
      resolution: '1080p',
      video_codec: 'h264',
      duration: 5400,
    } as never)

    const resolveHandler = handlers.get(IPC_CHANNELS.TIMELINES.RESOLVE_TIMELINE)!
    expect(resolveHandler).toBeDefined()

    const result = (await resolveHandler(createAuthorizedIpcEvent(), 'star-trek-chronological', 'src-plex')) as ResolvedTimelineResult
    expect(result).toBeDefined()
    expect(result.totalCount).toBeGreaterThan(0)
    expect(result.matchedCount).toBeGreaterThanOrEqual(1)

    const firstItem = result.items[0]
    expect(firstItem.status).toBe('matched')
    expect(firstItem.matchedMediaItem?.plexId).toBe('1001')
  })

  it('matches Example Saga movies by title variations without explicit tmdb/imdb IDs', async () => {
    await db.media.upsertItem({
      source_id: 'src-plex',
      source_type: 'plex',
      plex_id: '1002',
      title: 'Example Saga II - The Wrath of Khan',
      type: 'movie',
      year: 1982,
      file_path: 'D:/Movies/Example Saga II The Wrath of Khan (1982)/movie.mkv',
      resolution: '4K',
      video_codec: 'hevc',
      duration: 6800,
    } as never)

    const resolveHandler = handlers.get(IPC_CHANNELS.TIMELINES.RESOLVE_TIMELINE)!
    const result = (await resolveHandler(createAuthorizedIpcEvent(), 'star-trek-chronological', 'src-plex')) as ResolvedTimelineResult

    const khanItem = result.items.find((i) => i.title.includes('Wrath of Khan'))
    expect(khanItem).toBeDefined()
    expect(khanItem?.status).toBe('matched')
    expect(khanItem?.matchedMediaItem?.plexId).toBe('1002')
  })

  it('matches Example Saga episodes by series alias without external IDs', async () => {
    await db.media.upsertItem({
      source_id: 'src-plex',
      source_type: 'plex',
      plex_id: '1003',
      title: 'The Man Trap',
      series_title: 'Example Saga', // Alias for 'Example Saga: The Original Series'
      type: 'episode',
      season_number: 1,
      episode_number: 1,
      file_path: 'D:/TV/Example Saga/S01E01.mkv',
      resolution: '1080p',
      video_codec: 'h264',
      duration: 3000,
    } as never)

    const resolveHandler = handlers.get(IPC_CHANNELS.TIMELINES.RESOLVE_TIMELINE)!
    const result = (await resolveHandler(createAuthorizedIpcEvent(), 'star-trek-chronological', 'src-plex')) as ResolvedTimelineResult

    const tosItem = result.items.find((i) => i.title === 'Example Saga: The Original Series' || i.seriesTitle === 'Example Saga: The Original Series')
    expect(tosItem).toBeDefined()
    expect(tosItem?.status).toBe('matched')
    expect(tosItem?.matchedMediaItem?.plexId).toBe('1003')
  })
})
