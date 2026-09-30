import { z } from 'zod'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { IPC_CHANNELS } from '@main/constants/ipcChannels'
import { createIpcHandler, createValidatedIpcHandler } from '@main/ipc/utils/createHandler'
import { getDatabase } from '@main/database/BetterSQLiteService'
import { getSourceManager } from '@main/services/SourceManager'
import { getLoggingService } from '@main/services/LoggingService'
import { RemoteRegistryRecipeProvider } from '@main/services/timelines/RemoteRegistryRecipeProvider'
import { LocalTimelineRecipeProvider } from '@main/services/timelines/LocalTimelineRecipeProvider'
import { TraktRecipeProvider } from '@main/services/timelines/TraktRecipeProvider'
import { TMDBRecipeProvider } from '@main/services/timelines/TMDBRecipeProvider'
import { WebGuideRecipeProvider } from '@main/services/timelines/WebGuideRecipeProvider'
import { TimelineRecipeProviderFactory } from '@main/services/timelines/TimelineRecipeProviderFactory'
import { TimelineParserPluginProvider } from '@main/services/timelines/TimelineParserPluginProvider'
import type { ITimelineRecipeProvider } from '@main/services/timelines/ITimelineRecipeProvider'
import { TimelineResolutionEngine } from '@main/services/timelines/TimelineResolutionEngine'
import { PlexPlaylistSyncService } from '@main/services/timelines/PlexPlaylistSyncService'
import { PlexProvider } from '@main/providers/plex/PlexProvider'

const parserPluginProvider = new TimelineParserPluginProvider()
const recipeProvider = new TimelineRecipeProviderFactory(
  [
    new LocalTimelineRecipeProvider(path.resolve(process.cwd(), 'data/timelines')),
    new TMDBRecipeProvider(),
    new RemoteRegistryRecipeProvider(),
    new TraktRecipeProvider(),
    parserPluginProvider,
    new WebGuideRecipeProvider(),
  ]
)
const syncService = new PlexPlaylistSyncService()

const ResolveTimelineSchema = z.tuple([
  z.string().min(1),
  z.string().optional(),
  z.object({ refresh: z.boolean().optional(), snapshotId: z.string().min(1).optional() }).optional(),
])

const SyncPlexPlaylistSchema = z.tuple([
  z.object({
    sourceId: z.string().min(1),
    recipeId: z.string().min(1),
    playlistTitle: z.string().min(1),
    snapshotId: z.string().min(1),
    playlistRatingKey: z.string().optional(),
    allowStale: z.boolean().optional(),
  }),
])

export function registerTimelinesHandlers(timelineRecipeProvider: ITimelineRecipeProvider = recipeProvider): void {
  createIpcHandler(IPC_CHANNELS.TIMELINES.LIST_RECIPES, async () => {
    return await timelineRecipeProvider.listAvailableRecipes()
  })

  createIpcHandler(IPC_CHANNELS.TIMELINES.LIST_PARSER_PLUGINS, async () => {
    return await parserPluginProvider.listPlugins()
  })

  createValidatedIpcHandler(IPC_CHANNELS.TIMELINES.SAVE_PARSER_PLUGIN, z.tuple([z.unknown()]), async (plugin) => {
    return await parserPluginProvider.savePlugin(plugin)
  })

  createValidatedIpcHandler(IPC_CHANNELS.TIMELINES.REMOVE_PARSER_PLUGIN, z.tuple([z.string().min(1)]), async (id) => {
    return await parserPluginProvider.removePlugin(id)
  })

  createValidatedIpcHandler(IPC_CHANNELS.TIMELINES.GET_RECIPE, z.tuple([z.string().min(1), z.object({ refresh: z.boolean().optional() }).optional()]), async (recipeId, options) => {
    return await timelineRecipeProvider.fetchTimeline(recipeId, options)
  })

  createValidatedIpcHandler(IPC_CHANNELS.TIMELINES.RESOLVE_TIMELINE, ResolveTimelineSchema, async (recipeId, sourceId, options) => {
    let timeline: import('@main/services/timelines/ITimelineRecipeProvider').TimelineDefinition
    if (options?.snapshotId) {
      const raw = await getDatabase().config.getSetting(`timeline_snapshot:${options.snapshotId}`)
      if (!raw) throw new Error('The opened viewing-guide snapshot no longer exists; reopen the guide.')
      timeline = (JSON.parse(raw) as import('@main/services/timelines/TimelineResolutionEngine').ResolvedTimelineResult).timeline
      if (timeline.id !== recipeId) throw new Error('The snapshot belongs to another viewing guide.')
    } else timeline = await timelineRecipeProvider.fetchTimeline(recipeId, options)

    const db = getDatabase().drizzle
    const engine = new TimelineResolutionEngine(db)
    const resolved = { ...await engine.resolveTimeline(timeline, sourceId), snapshotId: randomUUID() }
    await getDatabase().config.setSetting(`timeline_snapshot:${resolved.snapshotId}`, JSON.stringify(resolved))
    return resolved
  })

  createValidatedIpcHandler(IPC_CHANNELS.TIMELINES.SYNC_PLEX_PLAYLIST, SyncPlexPlaylistSchema, async (payload) => {
    const { sourceId, playlistTitle, snapshotId, playlistRatingKey, allowStale } = payload
    const raw = await getDatabase().config.getSetting(`timeline_snapshot:${snapshotId}`)
    if (!raw) throw new Error('The reviewed timeline snapshot no longer exists; reopen the guide.')
    const resolved = JSON.parse(raw) as import('@main/services/timelines/TimelineResolutionEngine').ResolvedTimelineResult
    if (resolved.timeline.id !== payload.recipeId) throw new Error('The reviewed snapshot belongs to another viewing guide.')
    if (resolved.sourceId !== sourceId) throw new Error('The reviewed timeline belongs to another source; resolve it for the selected Plex server.')
    if (resolved.timeline.refreshError && !allowStale) throw new Error('Explicit authorization is required to sync this stale timeline snapshot.')
    if (resolved.items.some(item => item.status === 'ambiguous')) throw new Error('Resolve ambiguous timeline matches before syncing.')
    for (const item of resolved.items) {
      if (!item.matchedMediaItem) continue
      const current = await getDatabase().media.getItemById(item.matchedMediaItem.id)
      if (!current || current.source_id !== sourceId || current.source_type !== 'plex' || current.plex_id !== item.matchedMediaItem.plexId) throw new Error('A timeline match changed after review; refresh local matches before syncing.')
    }

    const sourceManager = getSourceManager()
    const provider = sourceManager.getProvider(sourceId)

    if (!provider || !(provider instanceof PlexProvider)) {
      throw new Error(`Source '${sourceId}' is not a valid or connected Plex server.`)
    }

    const selectedServer = provider.getSelectedServer()
    if (!selectedServer || !selectedServer.uri || !selectedServer.accessToken || !selectedServer.machineIdentifier) {
      throw new Error(`Plex server '${sourceId}' is missing connection metadata (URI, accessToken, or machineIdentifier).`)
    }

    return await syncService.syncPlaylist({
      serverUri: selectedServer.uri,
      accessToken: selectedServer.accessToken,
      machineIdentifier: selectedServer.machineIdentifier,
      playlistTitle,
      items: resolved.items,
      playlistRatingKey,
      sourceId,
    })
  })

  createValidatedIpcHandler(IPC_CHANNELS.TIMELINES.GET_PLEX_PLAYLISTS, z.tuple([z.string().min(1)]), async (sourceId) => {
    const sourceManager = getSourceManager()
    const provider = sourceManager.getProvider(sourceId)

    if (!provider || !(provider instanceof PlexProvider)) {
      throw new Error(`Source '${sourceId}' is not a valid or connected Plex server.`)
    }

    const selectedServer = provider.getSelectedServer()
    if (!selectedServer || !selectedServer.uri || !selectedServer.accessToken) {
      throw new Error(`Plex server '${sourceId}' is missing connection metadata (URI or accessToken).`)
    }

    return await syncService.getExistingPlaylists(selectedServer.uri, selectedServer.accessToken)
  })

  getLoggingService().info('[timelines]', 'Franchise Timelines and Plex Playlist IPC handlers registered')
}
