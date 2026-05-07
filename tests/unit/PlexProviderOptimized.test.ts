import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setupTestDb, cleanupTestDb } from '@tests/TestUtils'
import { PlexProvider } from '@main/providers/plex/PlexProvider'
import { TVShowRepository } from '@main/database/repositories/TVShowRepository'

describe('PlexProvider Optimized Scan', () => {
  let db: any

  beforeEach(async () => {
    db = await setupTestDb()
  })

  afterEach(() => {
    cleanupTestDb()
  })

  it('should create TV show stubs with real local counts during scan', async () => {
    const provider = new PlexProvider({
      sourceId: 'p1',
      name: 'Plex',
      sourceType: 'plex',
      connectionConfig: { uri: 'http://localhost:32400', accessToken: 'token' }
    } as any)

    // @ts-ignore
    provider.selectedServer = { uri: 'http://localhost:32400', accessToken: 'token' }

    const mockItems = [
      { ratingKey: '1', type: 'show', title: 'Test Show', Guid: [{ id: 'tmdb://123' }] }
    ]
    const mockEpisodes = [
      { ratingKey: '101', parentIndex: 1, index: 1, title: 'Ep 1', Media: [{ id: 'm1', Part: [{ file: 's1e1.mkv', size: 1000 }] }] },
      { ratingKey: '102', parentIndex: 1, index: 2, title: 'Ep 2', Media: [{ id: 'm2', Part: [{ file: 's1e2.mkv', size: 1000 }] }] },
      { ratingKey: '201', parentIndex: 2, index: 1, title: 'Ep 3', Media: [{ id: 'm3', Part: [{ file: 's2e1.mkv', size: 1000 }] }] }
    ]

    // Patch the instance directly
    ;(provider as any).paginatedPlexFetch = vi.fn().mockResolvedValue(mockItems)
    ;(provider as any).getShowEpisodes = vi.fn().mockResolvedValue(mockEpisodes)
    ;(provider as any).getItemMetadataDetailed = vi.fn().mockImplementation(async (rk: string) => {
      const ep = mockEpisodes.find(e => e.ratingKey === rk)
      if (!ep) return null
      return {
        ...ep,
        type: 'episode',
        grandparentTitle: 'Test Show',
        Media: [{ 
          id: `media_${rk}`,
          videoCodec: 'h264',
          audioCodec: 'aac',
          audioChannels: 2,
          width: 1920,
          height: 1080,
          Part: [{ id: `part_${rk}`, file: `file_${rk}.mkv`, size: 1000, Stream: [
            { streamType: 1, codec: 'h264', width: 1920, height: 1080 },
            { streamType: 2, codec: 'aac', channels: 2, bitrate: 128 }
          ] }] 
        }]
      }
    })

    await provider.scanLibrary('1')

    const tvRepo = db.tvShows
    const show = await tvRepo.getCompletenessByTitle('Test Show', 'p1', '1')
    
    expect(show).not.toBeNull()
    expect(show?.owned_episodes).toBe(3)
    expect(show?.owned_seasons).toBe(2)
    expect(show?.completeness_percentage).toBe(100)
  })

  it('should yield the event loop during large scans', async () => {
    const provider = new PlexProvider({
      sourceId: 'p1',
      name: 'Plex',
      sourceType: 'plex',
      connectionConfig: { uri: 'http://localhost:32400', accessToken: 'token' }
    } as any)

    // @ts-ignore
    provider.selectedServer = { uri: 'http://localhost:32400', accessToken: 'token' }

    // Create 100 mock items to trigger yields (BATCH_SIZE is 15)
    const mockItems = Array.from({ length: 100 }, (_, i) => ({
      ratingKey: `${i}`,
      type: 'movie',
      title: `Movie ${i}`
    }))

    vi.spyOn(provider as any, 'paginatedPlexFetch').mockResolvedValue(mockItems)
    vi.spyOn(provider as any, 'getItemMetadataDetailed').mockImplementation(async () => ({
       Media: [{ Part: [{ size: 1000 }] }],
       Video: [{ codec: 'h264' }]
    }))

    const setTimeoutSpy = vi.spyOn(global, 'setTimeout')

    await provider.scanLibrary('1')

    // BATCH_SIZE is 15, so 100 items should result in ceil(100/15) = 7 batches
    // Each batch should yield once.
    expect(setTimeoutSpy).toHaveBeenCalled()
  })
})
