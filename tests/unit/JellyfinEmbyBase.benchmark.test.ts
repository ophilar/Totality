import { describe, it, expect, vi, beforeEach } from 'vitest'
import { JellyfinEmbyBase } from '../../src/main/providers/jellyfin-emby/JellyfinEmbyBase'
import { ProviderType } from '../../src/main/types/database'

vi.mock('@main/database/BetterSQLiteService', () => ({
  getDatabase: () => ({
    beginBatch: vi.fn(),
    endBatch: vi.fn(),
    music: {
      upsertAlbum: vi.fn().mockResolvedValue(1),
      upsertTrack: vi.fn().mockResolvedValue(1),
      upsertArtist: vi.fn().mockResolvedValue(1),
      updateMusicArtistCounts: vi.fn().mockResolvedValue(true)
    }
  })
}))

vi.mock('@main/services/utils/PathUtils', () => ({
  PathUtils: { toDatabasePath: vi.fn(p => p) }
}))

class TestProvider extends JellyfinEmbyBase {
  public sourceId = 'test'
  public sourceType = ProviderType.Jellyfin
  protected mapper = {
    convertToMusicArtist: () => ({}),
    convertToMusicAlbum: () => ({}),
    convertToMusicTrack: () => ({})
  } as any

  protected client = {
    buildImageUrl: () => 'url'
  } as any

  async getMusicArtists() {
    return Array.from({ length: 50 }).map((_, i) => ({ Id: `artist_${i}`, Name: `Artist ${i}` }))
  }

  async getMusicAlbums(libraryId: string, artistId?: string) {
    if (artistId) {
      return Array.from({ length: 10 }).map((_, i) => ({ Id: `album_${artistId}_${i}`, Name: `Album ${i}`, ChildCount: 10 }))
    }
    return []
  }

  async getMusicTracks(albumId: string) {
    await new Promise(resolve => setTimeout(resolve, 5)) // Simulate small delay for processing/fetch
    return Array.from({ length: 10 }).map((_, i) => ({ Id: `track_${albumId}_${i}`, Name: `Track ${i}` }))
  }
}

describe('JellyfinEmbyBase benchmark', () => {
  it('benchmark scanMusicLibrary with more artists', async () => {
    const provider = new TestProvider('test', 'test', 'http://test', 'test', ProviderType.Jellyfin)
    const start = Date.now()
    await provider.scanMusicLibrary('lib1')
    const end = Date.now()
    console.log(`Scan completed in ${end - start} ms`)
  })
})
