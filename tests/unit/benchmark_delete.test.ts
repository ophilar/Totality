import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { setupTestDb } from '@tests/TestUtils'
import { getDatabase } from '@main/database/BetterSQLiteService'
import { ProviderType } from '@main/types/database'
import { LocalFolderProvider } from '@main/providers/local/LocalFolderProvider'

describe('LocalFolderProvider - Benchmark deletedFiles', () => {
  let cleanup: () => Promise<void>
  let provider: LocalFolderProvider

  beforeAll(async () => {
    await setupTestDb()
    const db = getDatabase()

    await db.sources.upsertSource({
      source_id: 'source-1', source_type: ProviderType.Local,
      display_name: 'Test Source', source_type: ProviderType.Local,
      type: ProviderType.Local,
      url_not_used: 'file:///tmp/test',
      connection_config: "{}"
    })

    // Create 100 media items
    for (let i = 0; i < 100; i++) {
      const id = await db.media.upsertItem({
        source_id: 'source-1', provider_id: `provider-${i}`, source_type: ProviderType.Local,
        plex_id: `plex-id-${i}`,
        type: 'movie',
        file_path: `/tmp/test/movie${i}.mp4`, plex_id: `plex-id-${i}`,
        title: `Movie ${i}`,
      })
    }

    // Create 100 music tracks
    for (let i = 0; i < 100; i++) {
      const trackId = await db.music.upsertTrack({
        source_id: 'source-1', provider_id: `provider-${i}`, source_type: ProviderType.Local,
        artist_name: 'Test Artist', title: `Track ${i}`, audio_codec: 'mp3',
        file_path: `/tmp/test/track${i}.mp3`,
      })
    }

    provider = new LocalFolderProvider('source-1', '/tmp/test')
  })

  afterAll(async () => {

  })

  it('benchmark deleting media items (media items and music tracks)', async () => {
    // Generate the same 100 paths
    const deletedFiles = []
    for (let i = 0; i < 100; i++) {
      deletedFiles.push(`/tmp/test/movie${i}.mp4`)
    }

    // We will simulate running lines 490-496 (media items delete loop)
    const db = getDatabase()

    const startTimeMedia = performance.now()
    let itemsRemovedMedia = 0
    if (deletedFiles.length > 0) {
      const existingItems = await db.media.getItemsByPaths(deletedFiles)
      const idsToDelete = existingItems.map(item => item.id).filter((id): id is number => id !== undefined)
      if (idsToDelete.length > 0) {
        await db.media.deleteItems(idsToDelete)
        itemsRemovedMedia += idsToDelete.length
      }
    }
    const durationMedia = performance.now() - startTimeMedia

    const deletedTracksFiles = []
    for (let i = 0; i < 100; i++) {
      deletedTracksFiles.push(`/tmp/test/track${i}.mp3`)
    }

    const startTimeMusic = performance.now()
    let itemsRemovedMusic = 0
    if (deletedTracksFiles.length > 0) {
      const existingTracks = await db.music.getTracksByPaths(deletedTracksFiles)
      const trackIdsToDelete = existingTracks.map(track => track.id).filter((id): id is number => id !== undefined)
      if (trackIdsToDelete.length > 0) {
        await db.music.deleteMusicTracks(trackIdsToDelete)
        itemsRemovedMusic += trackIdsToDelete.length
      }
    }
    const durationMusic = performance.now() - startTimeMusic

    console.log(`OPTIMIZED - Deleting 100 media items took ${durationMedia.toFixed(2)}ms`)
    console.log(`OPTIMIZED - Deleting 100 music tracks took ${durationMusic.toFixed(2)}ms`)
    expect(itemsRemovedMedia).toBe(100)
    expect(itemsRemovedMusic).toBe(100)
  })
})
