import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { PlexPlaylistSyncService } from '@main/services/timelines/PlexPlaylistSyncService'
import type { ResolvedTimelineItem } from '@main/services/timelines/TimelineResolutionEngine'

interface PlexResponse {
  method: string
  path: string
  body: unknown
  headers: IncomingMessage['headers']
}

describe('PlexPlaylistSyncService', () => {
  let service: PlexPlaylistSyncService
  let server: Server
  let serverUri: string
  let responses: Array<{ method: string; path: string; body: unknown }>
  let requests: PlexResponse[]

  beforeEach(async () => {
    responses = []
    requests = []
    server = createServer((request, response) => {
      void captureRequest(request, response)
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    serverUri = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    service = new PlexPlaylistSyncService()
  })

  afterEach(async () => {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  })

  async function captureRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
    for await (const _chunk of request) { /* Plex endpoints in these cases do not consume request bodies. */ }
    const url = new URL(request.url || '/', serverUri)
    requests.push({
      method: request.method || '',
      path: url.pathname,
      body: Object.fromEntries(url.searchParams),
      headers: request.headers,
    })
    const next = responses.shift()
    if (!next || next.method !== request.method || next.path !== url.pathname) {
      response.writeHead(500).end(JSON.stringify({ error: `Unexpected request ${request.method} ${url.pathname}` }))
      return
    }
    response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(next.body))
  }

  function respond(method: string, path: string, body: unknown): void {
    responses.push({ method, path, body })
  }

  function matchedItem(order: number, plexId: string): ResolvedTimelineItem {
    return {
      order,
      type: 'movie',
      title: `Example Saga ${order}`,
      identifiers: { tmdbId: 152 + order },
      status: 'matched',
      matchedMediaItem: {
        id: order,
        plexId,
        sourceId: 'src-1',
        sourceType: 'plex',
        title: `Example Saga ${order}`,
        filePath: `/movies/st${order}.mkv`,
        resolution: '1080p',
        videoCodec: 'h264',
        duration: 7200,
      },
    }
  }

  const playlistResponse = (ratingKey: string, title: string) => ({
    MediaContainer: { Metadata: [{ ratingKey, title }] },
  })

  it('throws error when no matched items exist in the list', async () => {
    const items: ResolvedTimelineItem[] = [{
      order: 1,
      type: 'movie',
      title: 'Example Saga I',
      identifiers: { tmdbId: 152 },
      status: 'missing',
    }]

    await expect(service.syncPlaylist({
      serverUri,
      accessToken: 'plex-token',
      machineIdentifier: 'mach-123',
      playlistTitle: 'Example Saga Complete',
      items,
    })).rejects.toThrow(/No matched items found/)
    expect(requests).toHaveLength(0)
  })

  it('creates and populates a new playlist with matched items in sequence', async () => {
    respond('GET', '/playlists', { MediaContainer: { Metadata: [] } })
    respond('POST', '/playlists', playlistResponse('playlist-999', 'Example Saga Complete'))
    respond('PUT', '/playlists/playlist-999/items', {})
    const items = [matchedItem(1, '1001'), {
      order: 2,
      type: 'movie' as const,
      title: 'Example Saga II',
      identifiers: { tmdbId: 154 },
      status: 'missing' as const,
    }, matchedItem(3, '1003')]

    const result = await service.syncPlaylist({
      serverUri,
      accessToken: 'plex-token',
      machineIdentifier: 'mach-123',
      playlistTitle: 'Example Saga Complete',
      items,
    })

    expect(result).toMatchObject({
      success: true,
      playlistRatingKey: 'playlist-999',
      matchedItemsSynced: 2,
      missingItemsCount: 1,
    })
    expect(requests.map(({ method, path }) => `${method} ${path}`)).toEqual([
      'GET /playlists',
      'POST /playlists',
      'PUT /playlists/playlist-999/items',
    ])
    expect(requests[0].body).toEqual({})
    expect(requests[1].body).toEqual({
      type: 'video',
      title: 'Example Saga Complete',
      smart: '0',
      uri: 'server://mach-123/com.plexapp.plugins.library/library/metadata/1001',
    })
    expect(requests[2].body).toEqual({
      uri: 'server://mach-123/com.plexapp.plugins.library/library/metadata/1003',
    })
    expect(responses).toHaveLength(0)
  })

  it('deletes an existing playlist with the same title before recreating it', async () => {
    respond('GET', '/playlists', playlistResponse('old-playlist-123', 'Example Saga Complete'))
    respond('DELETE', '/playlists/old-playlist-123', {})
    respond('POST', '/playlists', playlistResponse('playlist-1000', 'Example Saga Complete'))

    const result = await service.syncPlaylist({
      serverUri,
      accessToken: 'plex-token',
      machineIdentifier: 'mach-123',
      playlistTitle: 'Example Saga Complete',
      items: [matchedItem(1, '1001')],
    })

    expect(result.playlistRatingKey).toBe('playlist-1000')
    expect(requests.map(({ method, path }) => `${method} ${path}`)).toEqual([
      'GET /playlists',
      'DELETE /playlists/old-playlist-123',
      'POST /playlists',
    ])
    expect(requests[0].headers['x-plex-token']).toBe('plex-token')
    expect(requests[1].headers['x-plex-token']).toBe('plex-token')
  })

  it('retrieves existing playlists from Plex', async () => {
    respond('GET', '/playlists', {
      MediaContainer: {
        Metadata: [
          { ratingKey: 'p-1', title: 'MCU Chronological', playlistType: 'video', leafCount: 32, duration: 250000, composite: '/thumb.jpg' },
          { ratingKey: 'p-2', title: 'Example Galaxy Complete', playlistType: 'video', leafCount: 11, duration: 90000 },
        ],
      },
    })

    const playlists = await service.getExistingPlaylists(serverUri, 'plex-token')
    expect(playlists).toHaveLength(2)
    expect(playlists[0]).toEqual({
      ratingKey: 'p-1',
      title: 'MCU Chronological',
      playlistType: 'video',
      leafCount: 32,
      duration: 250000,
      composite: '/thumb.jpg',
      updatedAt: undefined,
    })
    expect(playlists[1].title).toBe('Example Galaxy Complete')
  })
})
