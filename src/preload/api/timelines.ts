import { ipcRenderer } from 'electron'
import { IPC_CHANNELS } from '@main/constants/ipcChannels'
import type { TimelineRecipeSummary, TimelineDefinition, TimelineFetchOptions } from '@main/services/timelines/ITimelineRecipeProvider'
import type { ResolvedTimelineResult } from '@main/services/timelines/TimelineResolutionEngine'
import type { PlexPlaylistSyncResult, PlexPlaylistSummary } from '@main/services/timelines/PlexPlaylistSyncService'
import type { TimelineParserPlugin, TimelineParserPluginInput } from '@main/services/timelines/TimelineParserPlugin'

export const timelinesApi = {
  timelinesListRecipes: (): Promise<TimelineRecipeSummary[]> =>
    ipcRenderer.invoke(IPC_CHANNELS.TIMELINES.LIST_RECIPES),

  timelinesListParserPlugins: (): Promise<TimelineParserPlugin[]> =>
    ipcRenderer.invoke(IPC_CHANNELS.TIMELINES.LIST_PARSER_PLUGINS),

  timelinesSaveParserPlugin: (plugin: TimelineParserPluginInput): Promise<TimelineParserPlugin[]> =>
    ipcRenderer.invoke(IPC_CHANNELS.TIMELINES.SAVE_PARSER_PLUGIN, plugin),

  timelinesRemoveParserPlugin: (id: string): Promise<TimelineParserPlugin[]> =>
    ipcRenderer.invoke(IPC_CHANNELS.TIMELINES.REMOVE_PARSER_PLUGIN, id),

  timelinesGetRecipe: (recipeId: string, options?: TimelineFetchOptions): Promise<TimelineDefinition> =>
    ipcRenderer.invoke(IPC_CHANNELS.TIMELINES.GET_RECIPE, recipeId, options),

  timelinesResolveTimeline: (recipeId: string, sourceId?: string, options?: TimelineFetchOptions): Promise<ResolvedTimelineResult> =>
    ipcRenderer.invoke(IPC_CHANNELS.TIMELINES.RESOLVE_TIMELINE, recipeId, sourceId, options),

  timelinesSyncPlexPlaylist: (payload: { sourceId: string; recipeId: string; playlistTitle: string; snapshotId: string; playlistRatingKey?: string; allowStale?: boolean }): Promise<PlexPlaylistSyncResult> =>
    ipcRenderer.invoke(IPC_CHANNELS.TIMELINES.SYNC_PLEX_PLAYLIST, payload),

  timelinesGetPlexPlaylists: (sourceId: string): Promise<PlexPlaylistSummary[]> =>
    ipcRenderer.invoke(IPC_CHANNELS.TIMELINES.GET_PLEX_PLAYLISTS, sourceId),
}

export type TimelinesAPI = typeof timelinesApi
