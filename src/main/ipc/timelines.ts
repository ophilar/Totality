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
import { TimelineResolutionEngine } from '@main/services/timelines/TimelineResolutionEngine'
import { PlexPlaylistSyncService } from '@main/services/timelines/PlexPlaylistSyncService'
import { PlexProvider } from '@main/providers/plex/PlexProvider'
import type { TimelineDefinition, TimelineRecipeSummary } from '@main/services/timelines/ITimelineRecipeProvider'

const webGuideProvider = new WebGuideRecipeProvider()
const registryProvider = new RemoteRegistryRecipeProvider()
const localProvider = new LocalTimelineRecipeProvider(path.resolve(process.cwd(), 'data/timelines'))
const traktProvider = new TraktRecipeProvider()
const tmdbProvider = new TMDBRecipeProvider()
const syncService = new PlexPlaylistSyncService()

async function fetchTimelineRecipe(recipeId: string): Promise<TimelineDefinition> {
  const trimmed = recipeId.trim()
  if (trimmed.startsWith('tmdb-') || trimmed.startsWith('tmdb-collection-')) {
    return await tmdbProvider.fetchTimeline(trimmed)
  }
  if (trimmed.startsWith('trakt-') || (trimmed.includes('/') && !trimmed.startsWith('http') && trimmed.split('/').length === 2)) {
    return await traktProvider.fetchTimeline(trimmed)
  }
  if (/^https?:\/\//i.test(trimmed)) {
    return await webGuideProvider.fetchTimeline(trimmed)
  }

  try { return await localProvider.fetchTimeline(trimmed) } catch { return await registryProvider.fetchTimeline(trimmed) }
}

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
    const [localRecipes, tmdbRecipes, registryRecipes] = await Promise.all([
      localProvider.listAvailableRecipes(),
      tmdbProvider.listAvailableRecipes(),
      registryProvider.listAvailableRecipes(),
    ])
    const combined = [...localRecipes, ...tmdbRecipes, ...registryRecipes]
    const unique = new Map<string, TimelineRecipeSummary>()
    for (const r of combined) {
      if (!unique.has(r.id)) {
        unique.set(r.id, r)
      }
    }
    return Array.from(unique.values())
  })

  createValidatedIpcHandler(IPC_CHANNELS.TIMELINES.GET_RECIPE, z.tuple([z.string().min(1)]), async (recipeId) => {
    return await fetchTimelineRecipe(recipeId)
  })

  createValidatedIpcHandler(IPC_CHANNELS.TIMELINES.RESOLVE_TIMELINE, ResolveTimelineSchema, async (recipeId, sourceId) => {
    const timeline = await fetchTimelineRecipe(recipeId)

    const db = getDatabase().drizzle
    const engine = new TimelineResolutionEngine(db)
    return await engine.resolveTimeline(timeline, sourceId)
  })

  createValidatedIpcHandler(IPC_CHANNELS.TIMELINES.SYNC_PLEX_PLAYLIST, SyncPlexPlaylistSchema, async (payload) => {
    const { sourceId, recipeId, playlistTitle } = payload

    const timeline = await fetchTimelineRecipe(recipeId)

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
