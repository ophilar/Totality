import { IPC_CHANNELS } from '../../shared/ipcChannels'
import { app } from 'electron'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { z } from 'zod'
import { getDatabase } from '../database/getDatabase'
import { getSourceManager } from '../services/SourceManager'
import { PlexProvider } from '../providers/plex/PlexProvider'
import { LocalTimelineRecipeProvider } from '../services/timelines/LocalTimelineRecipeProvider'
import { TimelineParserPluginProvider } from '../services/timelines/TimelineParserPluginProvider'
import { TMDBRecipeProvider } from '../services/timelines/TMDBRecipeProvider'
import { TraktRecipeProvider } from '../services/timelines/TraktRecipeProvider'
import { WebGuideRecipeProvider } from '../services/timelines/WebGuideRecipeProvider'
import { RemoteRegistryRecipeProvider } from '../services/timelines/RemoteRegistryRecipeProvider'
import { TimelineRecipeProviderFactory } from '../services/timelines/TimelineRecipeProviderFactory'
import { TimelineResolutionEngine, type ResolvedTimelineResult } from '../services/timelines/TimelineResolutionEngine'
import { PlexPlaylistCleanupError, PlexPlaylistSyncService } from '../services/timelines/PlexPlaylistSyncService'
import { getErrorMessage } from '../services/utils/errorUtils'
import { getLoggingService } from '../services/LoggingService'
import type { ITimelineRecipeProvider } from '../services/timelines/ITimelineRecipeProvider'
import { operationRequestRegistry } from './utils/OperationRequestRegistry'
import { createIpcHandler, createValidatedIpcHandler, createValidatedIpcHandlerWithEvent } from './utils/createHandler'

const localProvider = new LocalTimelineRecipeProvider(path.join(app.getAppPath(), 'data', 'timelines'))
const parserProvider = new TimelineParserPluginProvider()
const provider = new TimelineRecipeProviderFactory([
  localProvider,
  new TMDBRecipeProvider(),
  new RemoteRegistryRecipeProvider(),
  new TraktRecipeProvider(),
  parserProvider,
  new WebGuideRecipeProvider(),
])
const playlistSync = new PlexPlaylistSyncService()
const snapshotKey = (id: string) => `timeline_snapshot:${id}`
export function registerTimelinesHandlers(timelineProvider: ITimelineRecipeProvider = provider): void {
  createIpcHandler(IPC_CHANNELS.timelinesListRecipes, async () => timelineProvider.listAvailableRecipes())
  createIpcHandler(IPC_CHANNELS.timelinesListParserPlugins, async () => parserProvider.listPlugins())
  createIpcHandler(IPC_CHANNELS.timelinesSaveParserPlugin, async (input: unknown) => parserProvider.savePlugin(input))
  createValidatedIpcHandler(IPC_CHANNELS.timelinesRemoveParserPlugin, z.string().min(1), async id => parserProvider.removePlugin(id))
  createValidatedIpcHandler(
    IPC_CHANNELS.timelinesGetRecipe,
    z.tuple([z.string().min(1), z.object({ refresh: z.boolean().optional() }).optional()]),
    async (id, options) => timelineProvider.fetchTimeline(id, options)
  )
  createValidatedIpcHandlerWithEvent(
    IPC_CHANNELS.timelinesResolveTimeline,
    z.tuple([z.string().min(1), z.string().optional(), z.object({ refresh: z.boolean().optional(), snapshotId: z.string().min(1).optional() }).optional(), z.string().min(1).max(100), z.boolean()]),
    async (event, recipeId, sourceId, options, requestId, showInActivity) => {
    let stage = 'checking cancellation'
    const operation = operationRequestRegistry.register(event.sender, requestId, showInActivity ? {
      kind: 'timeline',
      label: 'Resolve viewing timeline',
      context: recipeId,
    } : undefined)
    try {
      operation.signal.throwIfAborted()
      if (options?.snapshotId) {
        stage = 'loading saved timeline snapshot'
        const raw = getDatabase().getSetting(snapshotKey(options.snapshotId))
        if (!raw) throw new Error('The saved timeline snapshot no longer exists; reopen the guide.')
        const saved = JSON.parse(raw) as ResolvedTimelineResult
        if (saved.timeline.id !== recipeId) throw new Error('The snapshot belongs to another viewing guide.')
        operation.complete('completed', 'Loaded the saved timeline snapshot.')
        return saved
      }
      stage = 'fetching timeline source'
      operation.update({ phase: 'Loading timeline source' })
      const timeline = await timelineProvider.fetchTimeline(recipeId, { ...options, signal: operation.signal })
      operation.signal.throwIfAborted()
      stage = 'matching timeline items to the library'
      operation.update({ phase: 'Matching timeline items to the library' })
      const resolved = await new TimelineResolutionEngine(
        sourceId => getDatabase().getMediaItems({ sourceId }),
        sourceId => getDatabase().getSeriesCompleteness(sourceId)
      ).resolveTimeline(timeline, sourceId, operation.signal)
      operation.signal.throwIfAborted()
      resolved.snapshotId = randomUUID()
      stage = 'saving resolved timeline snapshot'
      operation.beginCommit()
      await getDatabase().setSetting(snapshotKey(resolved.snapshotId), JSON.stringify(resolved))
      operation.complete('completed', `Resolved ${resolved.totalCount} timeline items.`, {
        totalCount: resolved.totalCount,
        matchedCount: resolved.matchedCount,
        missingCount: resolved.missingCount,
        ambiguousCount: resolved.ambiguousCount,
      })
      return resolved
    } catch (error) {
      if (operation.signal.aborted) {
        operation.complete('cancelled', 'Timeline resolution cancelled.')
        return { cancelled: true as const }
      }
      const message = getErrorMessage(error)
      getLoggingService().error(
        '[Timelines]',
        `Timeline resolution failed: stage=${stage}, recipe=${recipeId}, source=${sourceId ?? 'all'}, request=${requestId}: ${message}`,
        error
      )
      operation.complete('failed', message)
      return { error: message }
    } finally {
      operation.dispose()
    }
  })
  createValidatedIpcHandler(IPC_CHANNELS.timelinesGetPlexPlaylists, z.string().min(1), async id => {
    const plex = getSourceManager().getProvider(id)
    if (!(plex instanceof PlexProvider)) throw new Error(`Source '${id}' is not a connected Plex source.`)
    const server = plex.getSelectedServer()
    if (!server?.uri || !server.accessToken) throw new Error(`Plex source '${id}' has no selected server connection.`)
    return playlistSync.getExistingPlaylists(server.uri, server.accessToken)
  })
  createValidatedIpcHandlerWithEvent(
    IPC_CHANNELS.timelinesSyncPlexPlaylist,
    z.tuple([z.object({ sourceId: z.string().min(1), recipeId: z.string().min(1), playlistTitle: z.string().min(1), snapshotId: z.string().min(1), playlistRatingKey: z.string().optional(), allowStale: z.boolean().optional() }), z.string().min(1).max(100)]),
    async (event, input, requestId) => {
    const operation = operationRequestRegistry.register(event.sender, requestId, {
      kind: 'plex-playlist',
      label: 'Sync Plex timeline playlist',
      context: input.playlistTitle,
    })
    try {
    const raw = getDatabase().getSetting(snapshotKey(input.snapshotId))
    if (!raw) throw new Error('The reviewed timeline snapshot no longer exists; reopen the guide.')
    const resolved = JSON.parse(raw) as ResolvedTimelineResult
    if (resolved.timeline.id !== input.recipeId || resolved.sourceId !== input.sourceId) throw new Error('The reviewed timeline does not match the selected guide and source.')
    if (resolved.timeline.refreshError && !input.allowStale) throw new Error('Explicit approval is required to sync a stale timeline snapshot.')
    if (resolved.items.some(item => item.status === 'ambiguous')) throw new Error('Resolve ambiguous timeline matches before syncing.')
    for (const item of resolved.items) {
      const match = item.matchedMediaItem
      if (!match) continue
      const current = getDatabase().getMediaItemById(match.id)
      if (!current || current.source_id !== input.sourceId || current.source_type !== 'plex' || current.plex_id !== match.plexId) {
        throw new Error('A timeline match changed after review; resolve the guide again before syncing.')
      }
    }
    const plex = getSourceManager().getProvider(input.sourceId)
    if (!(plex instanceof PlexProvider)) throw new Error(`Source '${input.sourceId}' is not a connected Plex source.`)
    const server = plex.getSelectedServer()
    if (!server?.uri || !server.accessToken || !server.machineIdentifier) throw new Error('The selected Plex server is missing connection metadata.')
    const result = await playlistSync.syncPlaylist({
      serverUri: server.uri, accessToken: server.accessToken, machineIdentifier: server.machineIdentifier,
      playlistTitle: input.playlistTitle, items: resolved.items, sourceId: input.sourceId,
      playlistRatingKey: input.playlistRatingKey, signal: operation.signal,
      onCommitBeginning: operation.beginCommit,
      onPhase: phase => operation.update({ phase }),
    })
    operation.complete('completed', `Synced ${result.matchedItemsSynced} items to Plex.`, result)
    return result
    } catch (error) {
      if (operation.signal.aborted && !(error instanceof PlexPlaylistCleanupError)) {
        operation.complete('cancelled', 'Plex playlist sync cancelled.')
        return { cancelled: true as const }
      }
      operation.complete('failed', getErrorMessage(error))
      throw error
    } finally {
      operation.dispose()
    }
  })
}
