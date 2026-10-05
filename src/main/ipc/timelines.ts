import { z } from 'zod'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { IPC_CHANNELS } from '@main/constants/ipcChannels'
import { createIpcHandler, createValidatedIpcHandler, createValidatedIpcHandlerWithEvent } from '@main/ipc/utils/createHandler'
import { operationRequestRegistry } from '@main/ipc/utils/OperationRequestRegistry'
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
import { PlexPlaylistCleanupError, PlexPlaylistSyncService } from '@main/services/timelines/PlexPlaylistSyncService'
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
  z.string().min(1).max(100),
  z.boolean(),
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
  z.string().min(1).max(100),
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

  createValidatedIpcHandlerWithEvent(IPC_CHANNELS.TIMELINES.RESOLVE_TIMELINE, ResolveTimelineSchema, async (event, recipeId, sourceId, options, requestId, showInActivity) => {
    const operation = operationRequestRegistry.register(event.sender, requestId, showInActivity ? {
      kind: 'timeline',
      label: options?.snapshotId ? 'Timeline resolution' : options?.refresh ? 'Timeline refresh' : 'Timeline resolution',
      context: `${recipeId}${sourceId ? ` · ${sourceId}` : ''}`,
    } : undefined)
    try {
    let timeline: import('@main/services/timelines/ITimelineRecipeProvider').TimelineDefinition
    if (options?.snapshotId) {
      operation.update({ phase: 'Loading saved timeline snapshot' })
      const raw = await getDatabase().config.getSetting(`timeline_snapshot:${options.snapshotId}`)
      operation.signal.throwIfAborted()
      if (!raw) throw new Error('The opened viewing-guide snapshot no longer exists; reopen the guide.')
      timeline = (JSON.parse(raw) as import('@main/services/timelines/TimelineResolutionEngine').ResolvedTimelineResult).timeline
      if (timeline.id !== recipeId) throw new Error('The snapshot belongs to another viewing guide.')
    } else {
      operation.update({ phase: options?.refresh ? 'Refreshing timeline source' : 'Loading timeline source' })
      timeline = await timelineRecipeProvider.fetchTimeline(recipeId, { ...options, signal: operation.signal })
    }

    const db = getDatabase().drizzle
    const engine = new TimelineResolutionEngine(db)
    operation.update({ phase: 'Matching timeline items against this library' })
    const resolved = { ...await engine.resolveTimeline(timeline, sourceId, operation.signal), snapshotId: randomUUID() }
    operation.beginCommit()
    await getDatabase().config.setSetting(`timeline_snapshot:${resolved.snapshotId}`, JSON.stringify(resolved))
    operation.complete('completed', `Resolved ${resolved.totalCount} timeline items.`, resolved)
    return resolved
    } catch (error) {
      if (operation.signal.aborted) {
        operation.complete('cancelled', 'Timeline operation cancelled before its snapshot was saved.')
      } else {
        operation.complete('failed', error instanceof Error ? error.message : 'Timeline operation failed.')
      }
      throw error
    } finally {
      operation.dispose()
    }
  })

  createValidatedIpcHandlerWithEvent(IPC_CHANNELS.TIMELINES.SYNC_PLEX_PLAYLIST, SyncPlexPlaylistSchema, async (event, payload, requestId) => {
    const { sourceId, playlistTitle, snapshotId, playlistRatingKey, allowStale } = payload
    const operation = operationRequestRegistry.register(event.sender, requestId, {
      kind: 'plex-playlist',
      label: 'Plex playlist sync',
      context: `${playlistTitle} · ${sourceId}`,
    })
    try {
    operation.update({ phase: 'Validating the reviewed timeline' })
    operation.signal.throwIfAborted()
    const raw = await getDatabase().config.getSetting(`timeline_snapshot:${snapshotId}`)
    if (!raw) throw new Error('The reviewed timeline snapshot no longer exists; reopen the guide.')
    const resolved = JSON.parse(raw) as import('@main/services/timelines/TimelineResolutionEngine').ResolvedTimelineResult
    if (resolved.timeline.id !== payload.recipeId) throw new Error('The reviewed snapshot belongs to another viewing guide.')
    if (resolved.sourceId !== sourceId) throw new Error('The reviewed timeline belongs to another source; resolve it for the selected Plex server.')
    if (resolved.timeline.refreshError && !allowStale) throw new Error('Explicit authorization is required to sync this stale timeline snapshot.')
    if (resolved.items.some(item => item.status === 'ambiguous')) throw new Error('Resolve ambiguous timeline matches before syncing.')
    for (const item of resolved.items) {
      operation.signal.throwIfAborted()
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

    const result = await syncService.syncPlaylist({
      serverUri: selectedServer.uri,
      accessToken: selectedServer.accessToken,
      machineIdentifier: selectedServer.machineIdentifier,
      playlistTitle,
      items: resolved.items,
      playlistRatingKey,
      sourceId,
      signal: operation.signal,
      onCommitBeginning: () => operation.beginCommit(),
      onPhase: phase => operation.update({ phase }),
    })
    operation.complete('completed', `Synced ${result.matchedItemsSynced} items to Plex.`, result)
    return result
    } catch (error) {
      if (error instanceof PlexPlaylistCleanupError) {
        operation.complete('partial', error.message)
        return { cancelled: true as const }
      }
      if (operation.signal.aborted) {
        operation.complete('cancelled', 'Plex playlist sync cancelled; the staged playlist was removed before publication.')
        return { cancelled: true as const }
      }
      operation.complete('failed', error instanceof Error ? error.message : 'Plex playlist sync failed.')
      throw error
    } finally {
      operation.dispose()
    }
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
