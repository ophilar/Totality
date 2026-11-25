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
    const providerItemIds = options.items.flatMap(item => item.matchedMediaItem ? [item.matchedMediaItem.providerItemId] : [])
    options.onCommitBeginning()
    options.onPhase(`Creating ${this.provider.providerType} playlist`)
    const playlistId = options.existingPlaylistId ?? await this.provider.createPlaylist(options.title, providerItemIds)
    if (options.signal.aborted) throw new Error('Playlist publication was cancelled.')
    const previousItems = options.existingPlaylistId ? await this.provider.getPlaylistItems(playlistId) : []
    if (options.existingPlaylistId) {
      options.onPhase(`Replacing ${this.provider.providerType} playlist items`)
      try {
        await this.provider.replacePlaylistItems(playlistId, providerItemIds, options.signal)
      } catch (error) {
        await this.provider.replacePlaylistItems(playlistId, previousItems.map(item => item.providerItemId))
        throw error
      }
    }
    options.onPhase('Verifying playlist order')
    const actual = await this.provider.getPlaylistItems(playlistId)
    if (actual.length !== providerItemIds.length || actual.some((item, index) => item.providerItemId !== providerItemIds[index])) {
      throw new Error(`${this.provider.providerType} playlist order verification failed`)
    }
    return { sourceId: options.sourceId, title: options.title, playlistId, matchedItems: providerItemIds.length }
  }
}
