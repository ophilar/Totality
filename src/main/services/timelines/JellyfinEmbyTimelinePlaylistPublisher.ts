import type { JellyfinEmbyBase } from '../../providers/jellyfin-emby/JellyfinEmbyBase'
import type {
  TimelinePlaylistPublishOptions,
  TimelinePlaylistPublishResult,
  TimelinePlaylistPublisher,
  TimelinePlaylistSummary,
} from './TimelinePlaylistPublisher'

export class JellyfinEmbyTimelinePlaylistPublisher implements TimelinePlaylistPublisher {
  constructor(private readonly provider: JellyfinEmbyBase) {}

  async listPlaylists(): Promise<readonly TimelinePlaylistSummary[]> {
    return this.provider.listPlaylists()
  }

  async publish(options: TimelinePlaylistPublishOptions): Promise<TimelinePlaylistPublishResult> {
    if (options.signal.aborted) throw new Error('Playlist publication was cancelled.')
    if (options.existingPlaylistId) {
      throw new Error(`${this.provider.providerType} playlist replacement is not supported by the provider API.`)
    }
    const providerItemIds = options.items.flatMap(item => item.matchedMediaItem ? [item.matchedMediaItem.providerItemId] : [])
    options.onCommitBeginning()
    options.onPhase(`Creating ${this.provider.providerType} playlist`)
    const playlistId = await this.provider.createPlaylist(options.title, providerItemIds)
    if (options.signal.aborted) throw new Error('Playlist publication was cancelled.')
    options.onPhase('Verifying playlist order')
    const actual = await this.provider.getPlaylistItems(playlistId)
    if (actual.length !== providerItemIds.length || actual.some((item, index) => item.providerItemId !== providerItemIds[index])) {
      throw new Error(`${this.provider.providerType} playlist order verification failed`)
    }
    return { sourceId: options.sourceId, title: options.title, playlistId, matchedItems: providerItemIds.length }
  }
}
