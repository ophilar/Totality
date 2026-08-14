import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setupTestDb, cleanupTestDb, setupRealIntegratedBridge } from '@tests/TestUtils'
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
  })

  afterEach(async () => {
    await cleanupTestDb()
  })

  it('lists preset timeline recipes via IPC', async () => {
    const listHandler = handlers.get(IPC_CHANNELS.TIMELINES.LIST_RECIPES)!
    expect(listHandler).toBeDefined()

    const recipes = (await listHandler({})) as TimelineRecipeSummary[]
    expect(recipes).toBeDefined()
    expect(recipes.length).toBeGreaterThanOrEqual(4)

    const starTrekChrono = recipes.find((r) => r.id === 'star-trek-chronological')
    expect(starTrekChrono).toBeDefined()
    expect(starTrekChrono?.franchise).toBe('Star Trek')
  })

  it('retrieves a timeline recipe definition via IPC', async () => {
    const getRecipeHandler = handlers.get(IPC_CHANNELS.TIMELINES.GET_RECIPE)!
    expect(getRecipeHandler).toBeDefined()

    const timeline = (await getRecipeHandler({}, 'star-trek-chronological')) as TimelineDefinition
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
      series_title: 'Star Trek: Enterprise',
      type: 'episode',
      season_number: 1,
      episode_number: 1,
      series_identity_key: 'tmdb:1478',
      file_path: 'D:/TV/Star Trek Enterprise/S01E01.mkv',
      resolution: '1080p',
      video_codec: 'h264',
      duration: 5400,
    } as never)

    const resolveHandler = handlers.get(IPC_CHANNELS.TIMELINES.RESOLVE_TIMELINE)!
    expect(resolveHandler).toBeDefined()

    const result = (await resolveHandler({}, 'star-trek-chronological', 'src-plex')) as ResolvedTimelineResult
    expect(result).toBeDefined()
    expect(result.totalCount).toBeGreaterThan(0)
    expect(result.matchedCount).toBeGreaterThanOrEqual(1)

    const firstItem = result.items[0]
    expect(firstItem.status).toBe('matched')
    expect(firstItem.matchedMediaItem?.plexId).toBe('1001')
  })
})
