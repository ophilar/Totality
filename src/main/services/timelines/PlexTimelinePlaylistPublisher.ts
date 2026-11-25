import type { TimelinePlaylistPublisher, TimelinePlaylistPublishOptions, TimelinePlaylistPublishResult, TimelinePlaylistSummary } from './TimelinePlaylistPublisher'
import { PlexPlaylistSyncService, type PlexPlaylistSyncOptions } from './PlexPlaylistSyncService'

export class PlexTimelinePlaylistPublisher implements TimelinePlaylistPublisher {
  constructor(private readonly service: PlexPlaylistSyncService, private readonly connection: { serverUri: string; accessToken: string; machineIdentifier: string }) {}
  async listPlaylists(signal?: AbortSignal): Promise<readonly TimelinePlaylistSummary[]> {
    const items = await this.service.getExistingPlaylists(this.connection.serverUri, this.connection.accessToken, signal)
    return items.map(item => ({ id: item.ratingKey, title: item.title, mediaType: item.playlistType }))
  }
  async publish(options: TimelinePlaylistPublishOptions): Promise<TimelinePlaylistPublishResult> {
    const input: PlexPlaylistSyncOptions = {
      serverUri: this.connection.serverUri, accessToken: this.connection.accessToken, machineIdentifier: this.connection.machineIdentifier,
      playlistTitle: options.title, items: [...options.items], sourceId: options.sourceId, playlistRatingKey: options.existingPlaylistId,
      signal: options.signal, onCommitBeginning: options.onCommitBeginning, onPhase: options.onPhase,
    }
    const result = await this.service.syncPlaylist(input)
    return { sourceId: options.sourceId, title: result.playlistTitle, playlistId: result.playlistRatingKey, matchedItems: result.matchedItemsSynced }
  }
}
