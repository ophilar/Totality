import axios, { type AxiosInstance } from 'axios'
import type { ResolvedTimelineItem } from './TimelineResolutionEngine'
import { getLoggingService } from '@main/services/LoggingService'

export interface PlexPlaylistSyncOptions {
  serverUri: string
  accessToken: string
  machineIdentifier: string
  playlistTitle: string
  items: ResolvedTimelineItem[]
}

export interface PlexPlaylistSyncResult {
  success: boolean
  playlistTitle: string
  playlistRatingKey?: string
  totalItemsInTimeline: number
  matchedItemsSynced: number
  missingItemsCount: number
}

interface PlexPlaylistsResponse {
  MediaContainer?: {
    Metadata?: Array<{
      ratingKey: string
      title: string
      playlistType: string
    }>
  }
}

interface PlexCreatePlaylistResponse {
  MediaContainer?: {
    Metadata?: Array<{
      ratingKey: string
      title: string
    }>
  }
}

export class PlexPlaylistSyncService {
  private readonly client: AxiosInstance

  constructor(timeoutMs = 15000) {
    this.client = axios.create({
      timeout: timeoutMs,
      headers: {
        Accept: 'application/json',
      },
    })
  }

  async syncPlaylist(options: PlexPlaylistSyncOptions): Promise<PlexPlaylistSyncResult> {
    const { serverUri, accessToken, machineIdentifier, playlistTitle, items } = options

    const matchedItems = items.filter(
      (item): item is ResolvedTimelineItem & { matchedMediaItem: NonNullable<ResolvedTimelineItem['matchedMediaItem']> } =>
        item.status === 'matched' && Boolean(item.matchedMediaItem?.plexId)
    )

    if (matchedItems.length === 0) {
      throw new Error(`Cannot sync playlist '${playlistTitle}': No matched items found in local library.`)
    }

    const cleanBaseUri = serverUri.replace(/\/+$/, '')

    // Step 1: Check if an existing playlist with the same title exists
    const existingPlaylist = await this.findPlaylistByTitle(cleanBaseUri, accessToken, playlistTitle)

    if (existingPlaylist) {
      // Delete existing playlist to ensure clean, strictly ordered rebuild without orphaned leaves
      await this.deletePlaylist(cleanBaseUri, accessToken, existingPlaylist.ratingKey)
    }

    // Step 2: Create playlist with first item
    const firstItem = matchedItems[0]
    const firstItemUri = this.buildItemUri(machineIdentifier, firstItem.matchedMediaItem.plexId)
    const newPlaylistRatingKey = await this.createPlaylist(cleanBaseUri, accessToken, playlistTitle, firstItemUri)

    // Step 3: Append remaining items in strict sequential order
    for (let i = 1; i < matchedItems.length; i++) {
      const item = matchedItems[i]
      const itemUri = this.buildItemUri(machineIdentifier, item.matchedMediaItem.plexId)
      await this.addItemToPlaylist(cleanBaseUri, accessToken, newPlaylistRatingKey, itemUri)
    }

    getLoggingService().info(
      '[PlexPlaylistSyncService]',
      `Successfully synced playlist '${playlistTitle}' with ${matchedItems.length} items (RatingKey: ${newPlaylistRatingKey}).`
    )

    return {
      success: true,
      playlistTitle,
      playlistRatingKey: newPlaylistRatingKey,
      totalItemsInTimeline: items.length,
      matchedItemsSynced: matchedItems.length,
      missingItemsCount: items.length - matchedItems.length,
    }
  }

  private buildItemUri(machineIdentifier: string, ratingKey: string): string {
    return `server://${machineIdentifier}/com.plexapp.plugins.library/library/metadata/${ratingKey}`
  }

  private async findPlaylistByTitle(
    serverUri: string,
    accessToken: string,
    title: string
  ): Promise<{ ratingKey: string; title: string } | null> {
    try {
      const response = await this.client.get<PlexPlaylistsResponse>(`${serverUri}/playlists`, {
        headers: { 'X-Plex-Token': accessToken },
      })

      const list = response.data?.MediaContainer?.Metadata || []
      const found = list.find((p) => p.title.toLowerCase() === title.toLowerCase())
      return found ? { ratingKey: found.ratingKey, title: found.title } : null
    } catch (error) {
      getLoggingService().warn('[PlexPlaylistSyncService]', `Failed to query existing playlists:`, error)
      return null
    }
  }

  private async deletePlaylist(serverUri: string, accessToken: string, playlistRatingKey: string): Promise<void> {
    try {
      await this.client.delete(`${serverUri}/playlists/${playlistRatingKey}`, {
        headers: { 'X-Plex-Token': accessToken },
      })
    } catch (error) {
      getLoggingService().warn('[PlexPlaylistSyncService]', `Failed to delete playlist ${playlistRatingKey}:`, error)
    }
  }

  private async createPlaylist(
    serverUri: string,
    accessToken: string,
    title: string,
    firstItemUri: string
  ): Promise<string> {
    const response = await this.client.post<PlexCreatePlaylistResponse>(
      `${serverUri}/playlists`,
      null,
      {
        headers: { 'X-Plex-Token': accessToken },
        params: {
          type: 'video',
          title,
          smart: 0,
          uri: firstItemUri,
        },
      }
    )

    const createdRatingKey = response.data?.MediaContainer?.Metadata?.[0]?.ratingKey
    if (!createdRatingKey) {
      throw new Error(`Plex returned empty metadata when creating playlist '${title}'.`)
    }

    return createdRatingKey
  }

  private async addItemToPlaylist(
    serverUri: string,
    accessToken: string,
    playlistRatingKey: string,
    itemUri: string
  ): Promise<void> {
    await this.client.put(
      `${serverUri}/playlists/${playlistRatingKey}/items`,
      null,
      {
        headers: { 'X-Plex-Token': accessToken },
        params: {
          uri: itemUri,
        },
      }
    )
  }
}
