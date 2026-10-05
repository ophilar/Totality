import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { setupTestDb, cleanupTestDb, setupRealIntegratedBridge, createAuthorizedIpcEvent } from '@tests/TestUtils'
import { IPC_CHANNELS } from '@main/constants/ipcChannels'
import type { TimelineRecipeSummary, TimelineDefinition } from '@main/services/timelines/ITimelineRecipeProvider'
import type { ResolvedTimelineResult } from '@main/services/timelines/TimelineResolutionEngine'
import { LocalTimelineRecipeProvider } from '@main/services/timelines/LocalTimelineRecipeProvider'
import { TimelineRecipeProviderFactory } from '@main/services/timelines/TimelineRecipeProviderFactory'

const exampleSagaFixture = new URL('../fixtures/timeline-ipc/example-saga.json', import.meta.url)

describe('Timelines IPC Handlers (Real Integrated Bridge)', () => {
  let db: Awaited<ReturnType<typeof setupTestDb>>
  let handlers: ReturnType<typeof setupRealIntegratedBridge>['handlers']
  let timelineDirectory: string

  beforeEach(async () => {
    db = await setupTestDb()
    timelineDirectory = await mkdtemp(path.join(os.tmpdir(), 'totality-timeline-ipc-'))
    await writeFile(
      path.join(timelineDirectory, 'example-saga-viewing-order.json'),
      await readFile(exampleSagaFixture, 'utf8'),
    )
    const timelineProvider = new TimelineRecipeProviderFactory([
      new LocalTimelineRecipeProvider(timelineDirectory),
    ])
    const bridge = setupRealIntegratedBridge(timelineProvider)
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
    await rm(timelineDirectory, { recursive: true, force: true })
    await cleanupTestDb()
  })

  it('requires explicit authorization for the exact stale snapshot and rejects another source', async () => {
    const resolved = await handlers.get(IPC_CHANNELS.TIMELINES.RESOLVE_TIMELINE)!(createAuthorizedIpcEvent(), 'example-saga-viewing-order', 'src-plex', { refresh: true }, randomUUID(), false) as ResolvedTimelineResult
    resolved.timeline.refreshError = 'Publisher unavailable'
    await db.config.setSetting(`timeline_snapshot:${resolved.snapshotId}`, JSON.stringify(resolved))
    const sync = handlers.get(IPC_CHANNELS.TIMELINES.SYNC_PLEX_PLAYLIST)!
    const payload = { sourceId: 'src-plex', recipeId: resolved.timeline.id, playlistTitle: 'Acceptance', snapshotId: resolved.snapshotId }
    await expect(sync(createAuthorizedIpcEvent(), payload, randomUUID())).rejects.toThrow('Explicit authorization')
    await expect(sync(createAuthorizedIpcEvent(), { ...payload, sourceId: 'other', allowStale: true }, randomUUID())).rejects.toThrow('another source')
    await expect(sync(createAuthorizedIpcEvent(), { ...payload, allowStale: true }, randomUUID())).rejects.toThrow('connected Plex server')
  })

  it('resolves a different source from the opened snapshot without fetching the guide again', async () => {
    const resolve = handlers.get(IPC_CHANNELS.TIMELINES.RESOLVE_TIMELINE)!
    const opened = await resolve(createAuthorizedIpcEvent(), 'example-saga-viewing-order', 'src-plex', { refresh: true }, randomUUID(), false) as ResolvedTimelineResult
    await rm(path.join(timelineDirectory, 'example-saga-viewing-order.json'))
    await db.sources.upsertSource({ source_id: 'src-other', source_type: 'plex', display_name: 'Other acceptance server', connection_config: '{}', is_enabled: 1 })
    const switched = await resolve(createAuthorizedIpcEvent(), opened.timeline.id, 'src-other', { snapshotId: opened.snapshotId }, randomUUID(), false) as ResolvedTimelineResult
    expect(switched.sourceId).toBe('src-other')
    expect(switched.timeline).toEqual(opened.timeline)
    expect(switched.snapshotId).not.toBe(opened.snapshotId)
  })

  it('lists local timeline recipes via IPC', async () => {
    const listHandler = handlers.get(IPC_CHANNELS.TIMELINES.LIST_RECIPES)!
    expect(listHandler).toBeDefined()

    const recipes = (await listHandler(createAuthorizedIpcEvent())) as TimelineRecipeSummary[]
    expect(recipes).toBeDefined()
    expect(recipes.length).toBeGreaterThanOrEqual(1)

    const localRecipe = recipes.find((r) => r.id === 'example-saga-viewing-order')
    expect(localRecipe).toMatchObject({
      franchise: 'Example Saga',
      sourceType: 'preset',
    })
  })

  it('retrieves a timeline recipe definition via IPC', async () => {
    const getRecipeHandler = handlers.get(IPC_CHANNELS.TIMELINES.GET_RECIPE)!
    expect(getRecipeHandler).toBeDefined()

    const timeline = (await getRecipeHandler(createAuthorizedIpcEvent(), 'example-saga-viewing-order')) as TimelineDefinition
    expect(timeline).toBeDefined()
    expect(timeline.id).toBe('example-saga-viewing-order')
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

    const result = (await resolveHandler(createAuthorizedIpcEvent(), 'example-saga-viewing-order', 'src-plex', undefined, randomUUID(), false)) as ResolvedTimelineResult
    expect(result).toBeDefined()
    expect(result.totalCount).toBeGreaterThan(0)
    expect(result.matchedCount).toBeGreaterThanOrEqual(1)

    const firstItem = result.items[0]
    expect(firstItem.status).toBe('matched')
    expect(firstItem.matchedMediaItem?.plexId).toBe('1001')
  })

  it('leaves title variations unresolved without canonical identifiers', async () => {
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
    const result = (await resolveHandler(createAuthorizedIpcEvent(), 'example-saga-viewing-order', 'src-plex', undefined, randomUUID(), false)) as ResolvedTimelineResult

    const khanItem = result.items.find((i) => i.title.includes('Wrath of Khan'))
    expect(khanItem).toBeDefined()
    expect(khanItem?.status).toBe('missing')
    expect(khanItem?.matchedMediaItem).toBeUndefined()
  })

  it('leaves series aliases unresolved without canonical identifiers', async () => {
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
    const result = (await resolveHandler(createAuthorizedIpcEvent(), 'example-saga-viewing-order', 'src-plex', undefined, randomUUID(), false)) as ResolvedTimelineResult

    const tosItem = result.items.find((i) => i.title === 'Example Saga: The Original Series' || i.seriesTitle === 'Example Saga: The Original Series')
    expect(tosItem).toBeDefined()
    expect(tosItem?.status).toBe('missing')
    expect(tosItem?.matchedMediaItem).toBeUndefined()
  })
})
