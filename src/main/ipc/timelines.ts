import { z } from 'zod'
import path from 'node:path'
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
])

const SyncPlexPlaylistSchema = z.tuple([
  z.object({
    sourceId: z.string().min(1),
    recipeId: z.string().min(1),
    playlistTitle: z.string().min(1),
  }),
])

export function registerTimelinesHandlers(): void {
  createIpcHandler(IPC_CHANNELS.TIMELINES.LIST_RECIPES, async () => {
    return await recipeProvider.listAvailableRecipes()
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

  createValidatedIpcHandler(IPC_CHANNELS.TIMELINES.GET_RECIPE, z.tuple([z.string().min(1)]), async (recipeId) => {
    return await recipeProvider.fetchTimeline(recipeId)
  })

  createValidatedIpcHandler(IPC_CHANNELS.TIMELINES.RESOLVE_TIMELINE, ResolveTimelineSchema, async (recipeId, sourceId) => {
    const timeline = await recipeProvider.fetchTimeline(recipeId)

    const db = getDatabase().drizzle
    const engine = new TimelineResolutionEngine(db)
    return await engine.resolveTimeline(timeline, sourceId)
  })

  createValidatedIpcHandler(IPC_CHANNELS.TIMELINES.SYNC_PLEX_PLAYLIST, SyncPlexPlaylistSchema, async (payload) => {
    const { sourceId, recipeId, playlistTitle } = payload

    const timeline = await recipeProvider.fetchTimeline(recipeId)

    const db = getDatabase().drizzle
    const engine = new TimelineResolutionEngine(db)
    const resolved = await engine.resolveTimeline(timeline, sourceId)

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
