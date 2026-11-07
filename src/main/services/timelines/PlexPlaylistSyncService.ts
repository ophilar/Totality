
import type { ResolvedTimelineItem } from './TimelineResolutionEngine'
import { randomUUID } from 'node:crypto'
import { getDatabase } from '../../database/getDatabase'
import { fetchJSON, fetchResponse } from '../utils/httpClient'

export interface PlexPlaylistSyncOptions {
  serverUri: string
  accessToken: string
  machineIdentifier: string
  playlistTitle: string
  items: ResolvedTimelineItem[]
  sourceId: string
  playlistRatingKey?: string
  signal: AbortSignal
  onCommitBeginning: () => void
  onPhase: (phase: string) => void
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

export class PlexPlaylistCleanupError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PlexPlaylistCleanupError'
  }
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
  constructor(private readonly timeoutMs = 15000) {}

  async getExistingPlaylists(serverUri: string, accessToken: string, signal?: AbortSignal): Promise<PlexPlaylistSummary[]> {
    const cleanBaseUri = serverUri.replace(/\/+$/, '')
    try {
      const response = await fetchJSON<PlexPlaylistsResponse>(`${cleanBaseUri}/playlists`, {
        headers: { Accept: 'application/json', 'X-Plex-Token': accessToken },
        signal,
        timeoutMs: this.timeoutMs,
      })
      const list = response.MediaContainer?.Metadata || []
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
      console.warn('[PlexPlaylistSyncService] Failed to list playlists:', error)
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
    const { signal } = options
    signal.throwIfAborted()
    options.onPhase('Checking existing Plex playlists')
    await this.recoverPublications(cleanBaseUri, accessToken, machineIdentifier, signal)
    signal.throwIfAborted()
    const existing = await this.getExistingPlaylists(cleanBaseUri, accessToken, signal)
    signal.throwIfAborted()
    const existingPlaylist = options.playlistRatingKey ? existing.find(playlist => playlist.ratingKey === options.playlistRatingKey) : undefined
    if (options.playlistRatingKey && (!existingPlaylist || existingPlaylist.playlistType !== 'video')) throw new Error('The selected video playlist no longer exists.')
    if (!existingPlaylist && existing.some(playlist => playlist.title.toLowerCase() === playlistTitle.toLowerCase())) throw new Error('Select the existing playlist by its rating key before replacing it.')
    const key = `timeline_publication:${machineIdentifier}:${randomUUID()}`
    const state: PublicationState = { phase: 'building', title: playlistTitle, stagedTitle: `${playlistTitle} — Totality staging ${randomUUID()}`, oldKey: existingPlaylist?.ratingKey, expected: matchedItems.map(item => item.matchedMediaItem.plexId) }
    await getDatabase().setSetting(key, JSON.stringify(state))
    const firstItemUri = this.buildItemUri(machineIdentifier, state.expected[0])
    try {
      options.onPhase('Building a staged Plex playlist')
      const newPlaylistRatingKey = await this.createPlaylist(cleanBaseUri, accessToken, state.stagedTitle, firstItemUri, signal)
      state.newKey = newPlaylistRatingKey
      signal.throwIfAborted()
      await getDatabase().setSetting(key, JSON.stringify(state))
      for (const ratingKey of state.expected.slice(1)) {
        signal.throwIfAborted()
        await this.addItemToPlaylist(cleanBaseUri, accessToken, newPlaylistRatingKey, this.buildItemUri(machineIdentifier, ratingKey), signal)
      }
      signal.throwIfAborted()
      options.onPhase('Verifying staged playlist order')
      await this.verifySequence(cleanBaseUri, accessToken, newPlaylistRatingKey, state.expected, signal)
      signal.throwIfAborted()
      state.phase = 'verified'
      await getDatabase().setSetting(key, JSON.stringify(state))
      signal.throwIfAborted()
      options.onCommitBeginning()
      options.onPhase('Publishing the verified playlist')
      await this.publish(cleanBaseUri, accessToken, key, state)
    } catch (error) {
      if (!signal.aborted) throw error
      try {
        const playlists = await this.getExistingPlaylists(cleanBaseUri, accessToken)
        const staged = playlists.find(playlist => playlist.ratingKey === state.newKey || playlist.title === state.stagedTitle)
        if (!staged && !state.newKey) throw new Error('Plex has not confirmed whether playlist creation finished')
        if (staged) await this.deletePlaylist(cleanBaseUri, accessToken, staged.ratingKey)
        await getDatabase().deleteSetting(key)
      } catch (cleanupError) {
        throw new PlexPlaylistCleanupError(`Cancellation requested, but Plex staging cleanup is unresolved. The saved publication record will be recovered on the next sync. ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`)
      }
      throw error
    }

    console.info('[PlexPlaylistSyncService]', `Successfully synced playlist '${playlistTitle}' with ${matchedItems.length} items (RatingKey: ${state.newKey}).`)

    return {
      success: true,
      playlistTitle,
      playlistRatingKey: state.newKey,
      totalItemsInTimeline: items.length,
      matchedItemsSynced: matchedItems.length,
      missingItemsCount: items.length - matchedItems.length,
    }
  }

  private buildItemUri(machineIdentifier: string, ratingKey: string): string {
    return `server://${machineIdentifier}/com.plexapp.plugins.library/library/metadata/${ratingKey}`
  }

  private async verifySequence(serverUri: string, accessToken: string, ratingKey: string, expected: string[], signal?: AbortSignal): Promise<void> {
    const actual: string[] = []
    let total = 0
    do {
      const response = await fetchJSON<PlexPlaylistsResponse>(`${serverUri}/playlists/${ratingKey}/items`, {
        headers: { Accept: 'application/json', 'X-Plex-Token': accessToken },
        params: { 'X-Plex-Container-Start': actual.length, 'X-Plex-Container-Size': expected.length + 1 - actual.length },
        signal,
        timeoutMs: this.timeoutMs,
      })
      signal?.throwIfAborted()
      const container = response.MediaContainer
      if (!container?.Metadata) throw new Error('Plex did not return the staged playlist sequence')
      total = container.totalSize ?? container.Metadata.length
      if (!container.Metadata.length && actual.length < total) throw new Error('Plex returned an incomplete playlist page')
      actual.push(...container.Metadata.map(item => String(item.ratingKey)))
      if (total !== expected.length || actual.length > expected.length || actual.some((id, index) => id !== expected[index])) throw new Error('Plex playlist sequence does not match the reviewed timeline.')
    } while (actual.length < total)

  }

  private async publish(serverUri: string, accessToken: string, key: string, state: PublicationState): Promise<void> {
    await fetchResponse(`${serverUri}/playlists/${state.newKey}`, {
      method: 'PUT',
      headers: { Accept: 'application/json', 'X-Plex-Token': accessToken },
      params: { title: state.title },
      timeoutMs: this.timeoutMs,
    })
    state.phase = 'published'
    await getDatabase().setSetting(key, JSON.stringify(state))
    if (state.oldKey) await this.deletePlaylist(serverUri, accessToken, state.oldKey)
    await getDatabase().deleteSetting(key)
  }

  private async recoverPublications(serverUri: string, accessToken: string, machineIdentifier: string, signal: AbortSignal): Promise<void> {
    const entries = getDatabase().getSettingsByPrefix(`timeline_publication:${machineIdentifier}:`)
    for (const [key, raw] of Object.entries(entries)) {
      signal.throwIfAborted()
      if (typeof raw !== 'string') throw new Error(`Timeline publication record '${key}' is not valid text.`)
      const state = JSON.parse(raw) as PublicationState
      const playlists = await this.getExistingPlaylists(serverUri, accessToken)
      if (state.phase === 'building') {
        const staged = playlists.find(playlist => playlist.ratingKey === state.newKey || playlist.title === state.stagedTitle)
        if (!staged && !state.newKey) continue
        if (staged) await this.deletePlaylist(serverUri, accessToken, staged.ratingKey)
        await getDatabase().deleteSetting(key)
      } else if (state.phase === 'published') {
        await this.verifySequence(serverUri, accessToken, state.newKey!, state.expected, signal)
        if (state.oldKey && playlists.some(playlist => playlist.ratingKey === state.oldKey)) await this.deletePlaylist(serverUri, accessToken, state.oldKey)
        await getDatabase().deleteSetting(key)
      } else {
        await this.verifySequence(serverUri, accessToken, state.newKey!, state.expected, signal)
        await this.publish(serverUri, accessToken, key, state)
      }
    }
  }

  private async deletePlaylist(serverUri: string, accessToken: string, playlistRatingKey: string): Promise<void> {
    await fetchResponse(`${serverUri}/playlists/${playlistRatingKey}`, {
      method: 'DELETE',
      headers: { Accept: 'application/json', 'X-Plex-Token': accessToken },
      timeoutMs: this.timeoutMs,
    })
  }

  private async createPlaylist(
    serverUri: string,
    accessToken: string,
    title: string,
    firstItemUri: string,
    signal: AbortSignal
  ): Promise<string> {
    const response = await fetchJSON<PlexCreatePlaylistResponse>(`${serverUri}/playlists`, {
      method: 'POST',
      headers: { Accept: 'application/json', 'X-Plex-Token': accessToken },
      signal,
      params: {
        type: 'video',
        title,
        smart: 0,
        uri: firstItemUri,
      },
      timeoutMs: this.timeoutMs,
    })

    const createdRatingKey = response.MediaContainer?.Metadata?.[0]?.ratingKey
    if (!createdRatingKey) {
      throw new Error(`Plex returned empty metadata when creating playlist '${title}'.`)
    }

    return createdRatingKey
  }

  private async addItemToPlaylist(
    serverUri: string,
    accessToken: string,
    playlistRatingKey: string,
    itemUri: string,
    signal: AbortSignal
  ): Promise<void> {
    await fetchResponse(`${serverUri}/playlists/${playlistRatingKey}/items`, {
      method: 'PUT',
      headers: { Accept: 'application/json', 'X-Plex-Token': accessToken },
      signal,
      params: { uri: itemUri },
      timeoutMs: this.timeoutMs,
    })
  }
}

interface PublicationState { phase: 'building' | 'verified' | 'published'; title: string; stagedTitle: string; oldKey?: string; newKey?: string; expected: string[] }
