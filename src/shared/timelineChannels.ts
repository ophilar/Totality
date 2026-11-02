import { IPC_CHANNELS } from './ipcChannels'

/** Backward-compatible timeline channel names; IPC_CHANNELS is canonical for shared endpoints. */
export const TIMELINE_CHANNELS = {
  timelinesGetPlexPlaylists: IPC_CHANNELS.timelinesGetPlexPlaylists,
  timelinesGetRecipe: IPC_CHANNELS.timelinesGetRecipe,
  timelinesListParserPlugins: IPC_CHANNELS.timelinesListParserPlugins,
  timelinesListRecipes: IPC_CHANNELS.timelinesListRecipes,
  timelinesRemoveParserPlugin: IPC_CHANNELS.timelinesRemoveParserPlugin,
  timelinesResolveTimeline: IPC_CHANNELS.timelinesResolveTimeline,
  timelinesSaveParserPlugin: IPC_CHANNELS.timelinesSaveParserPlugin,
  timelinesSyncPlexPlaylist: IPC_CHANNELS.timelinesSyncPlexPlaylist,
  timelinesCancel: 'timelines:cancel',
  operationsUpdated: IPC_CHANNELS.operationsUpdated,
} as const
