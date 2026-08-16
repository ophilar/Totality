import { describe, it, expect, vi, beforeEach } from 'vitest'
import { PlexPlaylistSyncService } from '@main/services/timelines/PlexPlaylistSyncService'
import axios from 'axios'
import type { ResolvedTimelineItem } from '@main/services/timelines/TimelineResolutionEngine'

vi.mock('axios')

describe('PlexPlaylistSyncService', () => {
  let service: PlexPlaylistSyncService
  const mockAxiosInstance = {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  }

  beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(axios.create).mockReturnValue(mockAxiosInstance as never)
    service = new PlexPlaylistSyncService()
  })

  it('throws error when no matched items exist in the list', async () => {
    const items: ResolvedTimelineItem[] = [
      {
        order: 1,
        type: 'movie',
        title: 'Star Trek I',
        identifiers: { tmdbId: 152 },
        status: 'missing',
      },
    ]

    await expect(
      service.syncPlaylist({
        serverUri: 'http://127.0.0.1:32400',
        accessToken: 'plex-token',
        machineIdentifier: 'mach-123',
        playlistTitle: 'Star Trek Complete',
        items,
      })
    ).rejects.toThrow(/No matched items found/)
  })

  it('creates and populates a new playlist with matched items in sequence', async () => {
    const items: ResolvedTimelineItem[] = [
      {
        order: 1,
        type: 'movie',
        title: 'Star Trek I',
        identifiers: { tmdbId: 152 },
        status: 'matched',
        matchedMediaItem: {
          id: 1,
          plexId: '1001',
          sourceId: 'src-1',
          sourceType: 'plex',
          title: 'Star Trek I',
          filePath: '/movies/st1.mkv',
          resolution: '1080p',
          videoCodec: 'h264',
          duration: 7200,
        },
      },
      {
        order: 2,
        type: 'movie',
        title: 'Star Trek II',
        identifiers: { tmdbId: 154 },
        status: 'missing',
      },
      {
        order: 3,
        type: 'movie',
        title: 'Star Trek III',
        identifiers: { tmdbId: 157 },
        status: 'matched',
        matchedMediaItem: {
          id: 2,
          plexId: '1003',
          sourceId: 'src-1',
          sourceType: 'plex',
          title: 'Star Trek III',
          filePath: '/movies/st3.mkv',
          resolution: '1080p',
          videoCodec: 'h264',
          duration: 6500,
        },
      },
    ]

    // No existing playlists
    mockAxiosInstance.get.mockResolvedValueOnce({
      data: {
        MediaContainer: {
          Metadata: [],
        },
      },
    })

    // Create playlist response
    mockAxiosInstance.post.mockResolvedValueOnce({
      data: {
        MediaContainer: {
          Metadata: [{ ratingKey: 'playlist-999', title: 'Star Trek Complete' }],
        },
      },
    })

    // Add item response
    mockAxiosInstance.put.mockResolvedValueOnce({ data: {} })

    const result = await service.syncPlaylist({
      serverUri: 'http://127.0.0.1:32400',
      accessToken: 'plex-token',
      machineIdentifier: 'mach-123',
      playlistTitle: 'Star Trek Complete',
      items,
    })

    expect(result.success).toBe(true)
    expect(result.playlistRatingKey).toBe('playlist-999')
    expect(result.matchedItemsSynced).toBe(2)
    expect(result.missingItemsCount).toBe(1)

    // Verify playlist creation called with first item URI
    expect(mockAxiosInstance.post).toHaveBeenCalledWith(
      'http://127.0.0.1:32400/playlists',
      null,
      expect.objectContaining({
        params: {
          type: 'video',
          title: 'Star Trek Complete',
          smart: 0,
          uri: 'server://mach-123/com.plexapp.plugins.library/library/metadata/1001',
        },
      })
    )

    // Verify 2nd matched item added via PUT
    expect(mockAxiosInstance.put).toHaveBeenCalledWith(
      'http://127.0.0.1:32400/playlists/playlist-999/items',
      null,
      expect.objectContaining({
        params: {
          uri: 'server://mach-123/com.plexapp.plugins.library/library/metadata/1003',
        },
      })
    )
  })

  it('deletes existing playlist with identical title before recreating', async () => {
    const items: ResolvedTimelineItem[] = [
      {
        order: 1,
        type: 'movie',
        title: 'Star Trek I',
        identifiers: { tmdbId: 152 },
        status: 'matched',
        matchedMediaItem: {
          id: 1,
          plexId: '1001',
          sourceId: 'src-1',
          sourceType: 'plex',
          title: 'Star Trek I',
          filePath: '/movies/st1.mkv',
          resolution: '1080p',
          videoCodec: 'h264',
          duration: 7200,
        },
      },
    ]

    // Existing playlist found
    mockAxiosInstance.get.mockResolvedValueOnce({
      data: {
        MediaContainer: {
          Metadata: [{ ratingKey: 'old-playlist-123', title: 'Star Trek Complete' }],
        },
      },
    })

    mockAxiosInstance.delete.mockResolvedValueOnce({ data: {} })
    mockAxiosInstance.post.mockResolvedValueOnce({
      data: {
        MediaContainer: {
          Metadata: [{ ratingKey: 'playlist-1000', title: 'Star Trek Complete' }],
        },
      },
    })

    const result = await service.syncPlaylist({
      serverUri: 'http://127.0.0.1:32400',
      accessToken: 'plex-token',
      machineIdentifier: 'mach-123',
      playlistTitle: 'Star Trek Complete',
      items,
    })

    expect(mockAxiosInstance.delete).toHaveBeenCalledWith(
      'http://127.0.0.1:32400/playlists/old-playlist-123',
      expect.objectContaining({
        headers: { 'X-Plex-Token': 'plex-token' },
      })
    )
    expect(result.playlistRatingKey).toBe('playlist-1000')
  })

  it('retrieves existing playlists from Plex server', async () => {
    mockAxiosInstance.get.mockResolvedValueOnce({
      data: {
        MediaContainer: {
          Metadata: [
            {
              ratingKey: 'p-1',
              title: 'MCU Chronological',
              playlistType: 'video',
              leafCount: 32,
              duration: 250000,
              composite: '/thumb.jpg',
            },
            {
              ratingKey: 'p-2',
              title: 'Star Wars Complete',
              playlistType: 'video',
              leafCount: 11,
              duration: 90000,
            },
          ],
        },
      },
    })

    const playlists = await service.getExistingPlaylists('http://127.0.0.1:32400', 'plex-token')
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
    expect(playlists[1].title).toBe('Star Wars Complete')
  })
})
