import { app, ipcMain } from 'electron'
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
import { PlexPlaylistSyncService } from '../services/timelines/PlexPlaylistSyncService'
import type { ITimelineRecipeProvider } from '../services/timelines/ITimelineRecipeProvider'

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
const activeTimelineRequests = new Map<string, AbortController>()

export function registerTimelinesHandlers(timelineProvider: ITimelineRecipeProvider = provider): void {
  ipcMain.handle('timelines:listRecipes', () => timelineProvider.listAvailableRecipes())
  ipcMain.handle('timelines:listParserPlugins', () => parserProvider.listPlugins())
  ipcMain.handle('timelines:saveParserPlugin', (_event, input: unknown) => parserProvider.savePlugin(input))
  ipcMain.handle('timelines:removeParserPlugin', (_event, id: unknown) => parserProvider.removePlugin(z.string().min(1).parse(id)))
  ipcMain.handle('timelines:getRecipe', async (_event, id: unknown, options: unknown) => {
    const args = z.tuple([z.string().min(1), z.object({ refresh: z.boolean().optional() }).optional()]).parse([id, options])
    return timelineProvider.fetchTimeline(args[0], args[1])
  })
  ipcMain.handle('timelines:cancel', (_event, requestId: unknown) => {
    const id = z.string().min(1).max(100).parse(requestId)
    activeTimelineRequests.get(id)?.abort()
  })
  ipcMain.handle('timelines:resolveTimeline', async (_event, id: unknown, sourceId: unknown, options: unknown, requestId: unknown, showInActivity: unknown) => {
    const args = z.tuple([z.string().min(1), z.string().optional(), z.object({ refresh: z.boolean().optional(), snapshotId: z.string().min(1).optional() }).optional(), z.string().min(1).max(100), z.boolean()]).parse([id, sourceId, options, requestId, showInActivity])
    const controller = new AbortController()
    activeTimelineRequests.set(args[3], controller)
    try {
    if (args[2]?.snapshotId) {
      const raw = getDatabase().getSetting(snapshotKey(args[2].snapshotId))
      if (!raw) throw new Error('The saved timeline snapshot no longer exists; reopen the guide.')
      const saved = JSON.parse(raw) as ResolvedTimelineResult
      if (saved.timeline.id !== args[0]) throw new Error('The snapshot belongs to another viewing guide.')
      return saved
    }
    const timeline = await timelineProvider.fetchTimeline(args[0], { ...args[2], signal: controller.signal })
    const resolved = await new TimelineResolutionEngine(
      sourceId => getDatabase().getMediaItems({ sourceId }),
      sourceId => getDatabase().getSeriesCompleteness(sourceId)
    ).resolveTimeline(timeline, args[1], controller.signal)
    resolved.snapshotId = randomUUID()
    await getDatabase().setSetting(snapshotKey(resolved.snapshotId), JSON.stringify(resolved))
    return resolved
    } finally {
      activeTimelineRequests.delete(args[3])
    }
  })
  ipcMain.handle('timelines:getPlexPlaylists', async (_event, sourceId: unknown) => {
    const id = z.string().min(1).parse(sourceId)
    const plex = getSourceManager().getProvider(id)
    if (!(plex instanceof PlexProvider)) throw new Error(`Source '${id}' is not a connected Plex source.`)
    const server = plex.getSelectedServer()
    if (!server?.uri || !server.accessToken) throw new Error(`Plex source '${id}' has no selected server connection.`)
    return playlistSync.getExistingPlaylists(server.uri, server.accessToken)
  })
  ipcMain.handle('timelines:syncPlexPlaylist', async (_event, payload: unknown, requestId: unknown) => {
    const args = z.tuple([z.object({ sourceId: z.string().min(1), recipeId: z.string().min(1), playlistTitle: z.string().min(1), snapshotId: z.string().min(1), playlistRatingKey: z.string().optional(), allowStale: z.boolean().optional() }), z.string().min(1).max(100)]).parse([payload, requestId])
    const input = args[0]
    const raw = getDatabase().getSetting(snapshotKey(input.snapshotId))
    if (!raw) throw new Error('The reviewed timeline snapshot no longer exists; reopen the guide.')
    const resolved = JSON.parse(raw) as ResolvedTimelineResult
    if (resolved.timeline.id !== input.recipeId || resolved.sourceId !== input.sourceId) throw new Error('The reviewed timeline does not match the selected guide and source.')
    if (resolved.timeline.refreshError && !input.allowStale) throw new Error('Explicit approval is required to sync a stale timeline snapshot.')
    if (resolved.items.some(item => item.status === 'ambiguous')) throw new Error('Resolve ambiguous timeline matches before syncing.')
    const plex = getSourceManager().getProvider(input.sourceId)
    if (!(plex instanceof PlexProvider)) throw new Error(`Source '${input.sourceId}' is not a connected Plex source.`)
    const server = plex.getSelectedServer()
    if (!server?.uri || !server.accessToken || !server.machineIdentifier) throw new Error('The selected Plex server is missing connection metadata.')
    const controller = new AbortController()
    return playlistSync.syncPlaylist({
      serverUri: server.uri, accessToken: server.accessToken, machineIdentifier: server.machineIdentifier,
      playlistTitle: input.playlistTitle, items: resolved.items, sourceId: input.sourceId,
      playlistRatingKey: input.playlistRatingKey, signal: controller.signal,
      onCommitBeginning: () => undefined, onPhase: () => undefined,
    })
  })
}
