import { describe, expect, it } from 'vitest'
import { IPC_CHANNELS } from '../../src/shared/ipcChannels'
import { RPC_CHANNEL_MAP } from '../../src/shared/ipcChannelMap'

describe('timeline web RPC channels', () => {
  it('exposes every timeline API through the web transport', () => {
    expect({
      timelinesGetPlexPlaylists: RPC_CHANNEL_MAP.timelinesGetPlexPlaylists,
      timelinesGetRecipe: RPC_CHANNEL_MAP.timelinesGetRecipe,
      timelinesListParserPlugins: RPC_CHANNEL_MAP.timelinesListParserPlugins,
      timelinesListRecipes: RPC_CHANNEL_MAP.timelinesListRecipes,
      timelinesRemoveParserPlugin: RPC_CHANNEL_MAP.timelinesRemoveParserPlugin,
      timelinesResolveTimeline: RPC_CHANNEL_MAP.timelinesResolveTimeline,
      timelinesSaveParserPlugin: RPC_CHANNEL_MAP.timelinesSaveParserPlugin,
      timelinesSyncPlexPlaylist: RPC_CHANNEL_MAP.timelinesSyncPlexPlaylist,
    }).toEqual({
      timelinesGetPlexPlaylists: IPC_CHANNELS.timelinesGetPlexPlaylists,
      timelinesGetRecipe: IPC_CHANNELS.timelinesGetRecipe,
      timelinesListParserPlugins: IPC_CHANNELS.timelinesListParserPlugins,
      timelinesListRecipes: IPC_CHANNELS.timelinesListRecipes,
      timelinesRemoveParserPlugin: IPC_CHANNELS.timelinesRemoveParserPlugin,
      timelinesResolveTimeline: IPC_CHANNELS.timelinesResolveTimeline,
      timelinesSaveParserPlugin: IPC_CHANNELS.timelinesSaveParserPlugin,
      timelinesSyncPlexPlaylist: IPC_CHANNELS.timelinesSyncPlexPlaylist,
    })
  })
})
