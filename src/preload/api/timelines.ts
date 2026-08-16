import { ipcRenderer } from 'electron'
import { IPC_CHANNELS } from '@main/constants/ipcChannels'
import type { TimelineRecipeSummary, TimelineDefinition } from '@main/services/timelines/ITimelineRecipeProvider'
import type { ResolvedTimelineResult } from '@main/services/timelines/TimelineResolutionEngine'
import type { PlexPlaylistSyncResult, PlexPlaylistSummary } from '@main/services/timelines/PlexPlaylistSyncService'

export const timelinesApi = {
  timelinesListRecipes: (): Promise<TimelineRecipeSummary[]> =>
    ipcRenderer.invoke(IPC_CHANNELS.TIMELINES.LIST_RECIPES),

  timelinesGetRecipe: (recipeId: string): Promise<TimelineDefinition> =>
    ipcRenderer.invoke(IPC_CHANNELS.TIMELINES.GET_RECIPE, recipeId),

  timelinesResolveTimeline: (recipeId: string, sourceId?: string): Promise<ResolvedTimelineResult> =>
    ipcRenderer.invoke(IPC_CHANNELS.TIMELINES.RESOLVE_TIMELINE, recipeId, sourceId),

  timelinesSyncPlexPlaylist: (payload: { sourceId: string; recipeId: string; playlistTitle: string }): Promise<PlexPlaylistSyncResult> =>
    ipcRenderer.invoke(IPC_CHANNELS.TIMELINES.SYNC_PLEX_PLAYLIST, payload),

  timelinesGetPlexPlaylists: (sourceId: string): Promise<PlexPlaylistSummary[]> =>
    ipcRenderer.invoke(IPC_CHANNELS.TIMELINES.GET_PLEX_PLAYLISTS, sourceId),
}

export type TimelinesAPI = typeof timelinesApi
