import { z } from 'zod'
import { IPC_CHANNELS } from '@main/constants/ipcChannels'
import { createIpcHandler, createValidatedIpcHandler } from '@main/ipc/utils/createHandler'
import { getDatabase } from '@main/database/BetterSQLiteService'
import { getSourceManager } from '@main/services/SourceManager'
import { getLoggingService } from '@main/services/LoggingService'
import { RemoteRegistryRecipeProvider } from '@main/services/timelines/RemoteRegistryRecipeProvider'
import { TraktRecipeProvider } from '@main/services/timelines/TraktRecipeProvider'
import { TimelineResolutionEngine } from '@main/services/timelines/TimelineResolutionEngine'
import { PlexPlaylistSyncService } from '@main/services/timelines/PlexPlaylistSyncService'
import { PlexProvider } from '@main/providers/plex/PlexProvider'

const registryProvider = new RemoteRegistryRecipeProvider()
const traktProvider = new TraktRecipeProvider()
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
    return await registryProvider.listAvailableRecipes()
  })

  createValidatedIpcHandler(IPC_CHANNELS.TIMELINES.GET_RECIPE, z.tuple([z.string().min(1)]), async (recipeId) => {
    if (recipeId.startsWith('trakt-') || recipeId.includes('/')) {
      return await traktProvider.fetchTimeline(recipeId)
    }
    return await registryProvider.fetchTimeline(recipeId)
  })

  createValidatedIpcHandler(IPC_CHANNELS.TIMELINES.RESOLVE_TIMELINE, ResolveTimelineSchema, async (recipeId, sourceId) => {
    const timeline = recipeId.startsWith('trakt-') || recipeId.includes('/')
      ? await traktProvider.fetchTimeline(recipeId)
      : await registryProvider.fetchTimeline(recipeId)

    const db = getDatabase().drizzle
    const engine = new TimelineResolutionEngine(db)
    return await engine.resolveTimeline(timeline, sourceId)
  })

  createValidatedIpcHandler(IPC_CHANNELS.TIMELINES.SYNC_PLEX_PLAYLIST, SyncPlexPlaylistSchema, async (payload) => {
    const { sourceId, recipeId, playlistTitle } = payload

    const timeline = recipeId.startsWith('trakt-') || recipeId.includes('/')
      ? await traktProvider.fetchTimeline(recipeId)
      : await registryProvider.fetchTimeline(recipeId)

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

  getLoggingService().info('[timelines]', 'Franchise Timelines and Plex Playlist IPC handlers registered')
}
