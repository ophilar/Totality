import axios, { type AxiosInstance } from 'axios'
import type { ResolvedTimelineItem } from './TimelineResolutionEngine'
import { randomUUID } from 'node:crypto'
import { getDatabase } from '@main/database/BetterSQLiteService'
import { getLoggingService } from '@main/services/LoggingService'

export interface PlexPlaylistSyncOptions {
  serverUri: string
  accessToken: string
  machineIdentifier: string
  playlistTitle: string
  items: ResolvedTimelineItem[]
  sourceId: string
  playlistRatingKey?: string
}

export interface PlexPlaylistSyncResult {
  success: boolean
  playlistTitle: string
  playlistRatingKey?: string
  totalItemsInTimeline: number
  matchedItemsSynced: number
  missingItemsCount: number
}

export interface PlexPlaylistSummary {
  ratingKey: string
  title: string
  playlistType: string
  duration?: number
  leafCount?: number
  composite?: string
  updatedAt?: number
}

interface PlexPlaylistsResponse {
  MediaContainer?: {
    totalSize?: number
    Metadata?: Array<{
      ratingKey: string
      title: string
      playlistType: string
      duration?: number
      leafCount?: number
      composite?: string
      updatedAt?: number
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

  async getExistingPlaylists(serverUri: string, accessToken: string): Promise<PlexPlaylistSummary[]> {
    const cleanBaseUri = serverUri.replace(/\/+$/, '')
    try {
      const response = await this.client.get<PlexPlaylistsResponse>(`${cleanBaseUri}/playlists`, {
        headers: { 'X-Plex-Token': accessToken },
      })
      const list = response.data?.MediaContainer?.Metadata || []
      return list.map((p) => ({
        ratingKey: p.ratingKey,
        title: p.title,
        playlistType: p.playlistType,
        duration: p.duration,
        leafCount: p.leafCount,
        composite: p.composite,
        updatedAt: p.updatedAt,
      }))
    } catch (error) {
      getLoggingService().warn('[PlexPlaylistSyncService]', 'Failed to list playlists:', error)
      throw error
    }
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

    if (matchedItems.some(item => item.matchedMediaItem.sourceId !== options.sourceId || item.matchedMediaItem.sourceType !== 'plex')) throw new Error('Playlist matches must belong to the selected Plex source.')
    await this.recoverPublications(cleanBaseUri, accessToken, machineIdentifier)
    const existing = await this.getExistingPlaylists(cleanBaseUri, accessToken)
    const existingPlaylist = options.playlistRatingKey ? existing.find(playlist => playlist.ratingKey === options.playlistRatingKey) : undefined
    if (options.playlistRatingKey && (!existingPlaylist || existingPlaylist.playlistType !== 'video')) throw new Error('The selected video playlist no longer exists.')
    if (!existingPlaylist && existing.some(playlist => playlist.title.toLowerCase() === playlistTitle.toLowerCase())) throw new Error('Select the existing playlist by its rating key before replacing it.')
    const key = `timeline_publication:${machineIdentifier}:${randomUUID()}`
    const state: PublicationState = { phase: 'building', title: playlistTitle, stagedTitle: `${playlistTitle} — Totality staging ${randomUUID()}`, oldKey: existingPlaylist?.ratingKey, expected: matchedItems.map(item => item.matchedMediaItem.plexId) }
    await getDatabase().config.setSetting(key, JSON.stringify(state))
    const firstItemUri = this.buildItemUri(machineIdentifier, state.expected[0])
    const newPlaylistRatingKey = await this.createPlaylist(cleanBaseUri, accessToken, state.stagedTitle, firstItemUri)
    state.newKey = newPlaylistRatingKey
    await getDatabase().config.setSetting(key, JSON.stringify(state))
    for (const ratingKey of state.expected.slice(1)) await this.addItemToPlaylist(cleanBaseUri, accessToken, newPlaylistRatingKey, this.buildItemUri(machineIdentifier, ratingKey))
    await this.verifySequence(cleanBaseUri, accessToken, newPlaylistRatingKey, state.expected)
    state.phase = 'verified'
    await getDatabase().config.setSetting(key, JSON.stringify(state))
    await this.publish(cleanBaseUri, accessToken, key, state)

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

  private async verifySequence(serverUri: string, accessToken: string, ratingKey: string, expected: string[]): Promise<void> {
    const actual: string[] = []
    let total: number | undefined
    do {
      const response = await this.client.get<PlexPlaylistsResponse>(`${serverUri}/playlists/${ratingKey}/items`, { headers: { 'X-Plex-Token': accessToken }, params: { 'X-Plex-Container-Start': actual.length, 'X-Plex-Container-Size': expected.length + 1 - actual.length } })
      const container = response.data.MediaContainer
      if (!container?.Metadata) throw new Error('Plex did not return the staged playlist sequence')
      total = container.totalSize ?? container.Metadata.length
      if (!container.Metadata.length && actual.length < total) throw new Error('Plex returned an incomplete playlist page')
      actual.push(...container.Metadata.map(item => String(item.ratingKey)))
      if (total !== expected.length || actual.length > expected.length || actual.some((id, index) => id !== expected[index])) throw new Error('Plex playlist sequence does not match the reviewed timeline.')
    } while (actual.length < total)

  }

  private async publish(serverUri: string, accessToken: string, key: string, state: PublicationState): Promise<void> {
    await this.client.put(`${serverUri}/playlists/${state.newKey}`, null, { headers: { 'X-Plex-Token': accessToken }, params: { title: state.title } })
    state.phase = 'published'
    await getDatabase().config.setSetting(key, JSON.stringify(state))
    if (state.oldKey) await this.deletePlaylist(serverUri, accessToken, state.oldKey)
    await getDatabase().config.deleteSetting(key)
  }

  private async recoverPublications(serverUri: string, accessToken: string, machineIdentifier: string): Promise<void> {
    const entries = await getDatabase().config.getSettingsByPrefix(`timeline_publication:${machineIdentifier}:`)
    for (const [key, raw] of Object.entries(entries)) {
      const state = JSON.parse(raw) as PublicationState
      const playlists = await this.getExistingPlaylists(serverUri, accessToken)
      if (state.phase === 'building') {
        const staged = playlists.find(playlist => playlist.ratingKey === state.newKey || playlist.title === state.stagedTitle)
        if (staged) await this.deletePlaylist(serverUri, accessToken, staged.ratingKey)
        await getDatabase().config.deleteSetting(key)
      } else if (state.phase === 'published') {
        await this.verifySequence(serverUri, accessToken, state.newKey!, state.expected)
        if (state.oldKey && playlists.some(playlist => playlist.ratingKey === state.oldKey)) await this.deletePlaylist(serverUri, accessToken, state.oldKey)
        await getDatabase().config.deleteSetting(key)
      } else {
        await this.verifySequence(serverUri, accessToken, state.newKey!, state.expected)
        await this.publish(serverUri, accessToken, key, state)
      }
    }
  }

  private async deletePlaylist(serverUri: string, accessToken: string, playlistRatingKey: string): Promise<void> {
    await this.client.delete(`${serverUri}/playlists/${playlistRatingKey}`, { headers: { 'X-Plex-Token': accessToken } })
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

interface PublicationState { phase: 'building' | 'verified' | 'published'; title: string; stagedTitle: string; oldKey?: string; newKey?: string; expected: string[] }
