import { describe, expect, it } from 'vitest'
import { TIMELINE_CHANNELS } from '../../src/shared/timelineChannels'
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
      timelinesGetPlexPlaylists: TIMELINE_CHANNELS.timelinesGetPlexPlaylists,
      timelinesGetRecipe: TIMELINE_CHANNELS.timelinesGetRecipe,
      timelinesListParserPlugins: TIMELINE_CHANNELS.timelinesListParserPlugins,
      timelinesListRecipes: TIMELINE_CHANNELS.timelinesListRecipes,
      timelinesRemoveParserPlugin: TIMELINE_CHANNELS.timelinesRemoveParserPlugin,
      timelinesResolveTimeline: TIMELINE_CHANNELS.timelinesResolveTimeline,
      timelinesSaveParserPlugin: TIMELINE_CHANNELS.timelinesSaveParserPlugin,
      timelinesSyncPlexPlaylist: TIMELINE_CHANNELS.timelinesSyncPlexPlaylist,
    })
  })
})
