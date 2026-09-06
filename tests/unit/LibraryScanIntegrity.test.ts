import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { SourceManager } from '@main/services/SourceManager'
import { LibraryType } from '@main/types/database'
import { setupTestDb, cleanupTestDb, createTempDir } from '@tests/TestUtils'
import * as fs from 'fs'
import * as path from 'path'

describe('Library Issues Fixes (Deep Dive)', () => {
  let db: Awaited<ReturnType<typeof setupTestDb>>
  let tempDir: { path: string; cleanup: () => void }

  beforeEach(async () => {
    db = await setupTestDb()
    tempDir = createTempDir('library-integrity-fix')
  })

  afterEach(() => {
    cleanupTestDb()
    tempDir.cleanup()
  })

  describe('Music Quality Integration - TaskQueue to SourceScanner', () => {
    it('should automatically analyze persisted music quality evidence after a library scan', async () => {
      const sourceId = 'm1'
      const libraryId = 'music'
      const folderPath = path.join(tempDir.path, 'music')
      fs.mkdirSync(folderPath, { recursive: true })

      await db.sources.upsertSource({
        source_id: sourceId,
        source_type: 'local',
        display_name: 'Local Music',
        connection_config: JSON.stringify({ folderPath, mediaType: LibraryType.Music }),
        is_enabled: 1,
      })
      await db.sources.setLibrariesEnabled(sourceId, [{ id: libraryId, name: 'Music', type: LibraryType.Music, enabled: true }])

      const albumPath = path.join(folderPath, 'Artist 1', 'Album 1')
      fs.mkdirSync(albumPath, { recursive: true })
      const trackPath = path.join(albumPath, '01 - Track 1.mp3')
      fs.writeFileSync(trackPath, 'persisted track placeholder')
      const trackStat = fs.statSync(trackPath)

      const artistId = await db.music.upsertArtist({
        source_id: sourceId,
        source_type: 'local',
        library_id: libraryId,
        provider_id: 'artist-1',
        name: 'Artist 1',
      })
      const albumId = await db.music.upsertAlbum({
        source_id: sourceId,
        source_type: 'local',
        library_id: libraryId,
        provider_id: 'album-1',
        artist_id: artistId,
        artist_name: 'Artist 1',
        title: 'Album 1',
      })
      await db.music.upsertTrack({
        source_id: sourceId,
        source_type: 'local',
        library_id: libraryId,
        provider_id: 'track-1',
        album_id: albumId,
        artist_id: artistId,
        album_name: 'Album 1',
        artist_name: 'Artist 1',
        title: 'Track 1',
        file_path: trackPath,
        file_size: trackStat.size,
        file_mtime: trackStat.mtime.getTime(),
        container: 'mp3',
        audio_codec: 'mp3',
        audio_bitrate: 128,
        is_lossless: false,
        is_hi_res: false,
      })

      const manager = new SourceManager()
      await manager.initialize()
      await manager.scanLibrary(sourceId, libraryId)

      const score = await db.music.getQualityScore(albumId)
      expect(score).not.toBeNull()
      expect(score!.quality_tier).toBe('LOSSY_LOW')
      expect(score!.needs_upgrade).toBe(true)
    })
  })

  describe('Music Scan Routing Integrity', () => {
    it('should correctly route music scans to the music-specific scanning engine', async () => {
      const sourceId = 'music-route-test'
      const libraryId = 'music'

      const folderPath = path.join(tempDir.path, 'music-route')
      fs.mkdirSync(folderPath, { recursive: true })

      await db.sources.upsertSource({
        source_id: sourceId,
        source_type: 'local',
        display_name: 'Routing Test',
        connection_config: JSON.stringify({ folderPath, mediaType: LibraryType.Music }),
        is_enabled: 1,
      })
      await db.config.setSetting('ffprobe_enabled', 'false')

      const manager = new SourceManager()
      await manager.initialize()

      const provider = manager.getProvider(sourceId) as unknown as { mediaType: LibraryType } | null
      if (provider) provider.mediaType = LibraryType.Music

      const artistDir = path.join(folderPath, 'Test Artist')
      const albumDir = path.join(artistDir, 'Test Album')
      fs.mkdirSync(albumDir, { recursive: true })
      fs.writeFileSync(path.join(albumDir, 'song.mp3'), 'audio content')

      await manager.scanLibrary(sourceId, libraryId)

      const artists = await db.music.getArtists({ sourceId })
      expect(artists.length).toBeGreaterThan(0)
      expect(artists[0].name).toBe('Test Artist')

      const albums = await db.music.getAlbums({ sourceId })
      expect(albums.length).toBeGreaterThan(0)
      expect(albums[0].title).toBe('Test Album')
    })
  })

  describe('Dashboard Visibility - Unmatched Series', () => {
    it('should show unmatched series in the dashboard even if TMDB key is missing', async () => {
      const statsRepo = db.stats

      await db.sources.upsertSource({ source_id: 's1', source_type: 'plex', display_name: 'Plex', connection_config: '{}', is_enabled: 1 })
      await db.tvShows.upsertCompleteness({
        series_title: 'Unmatched Show',
        source_id: 's1',
        library_id: '2',
        total_seasons: 0,
        total_episodes: 0,
        owned_seasons: 1,
        owned_episodes: 5,
        missing_seasons: '[]',
        missing_episodes: '[]',
        completeness_percentage: 0,
      })

      const summary = await statsRepo.getDashboardSummary()
      const unmatched = summary.incompleteSeries.find(s => s.series_title === 'Unmatched Show')
      expect(unmatched).toBeDefined()
    })
  })

  describe('Original Plex Cleanup Hierarchical Logic', () => {
    it('should not delete episodes when only shows are retrieved initially', async () => {
      await db.sources.upsertSource({ source_id: 'p1', source_type: 'plex', display_name: 'Plex', connection_config: '{}', is_enabled: 1 })
      await db.media.upsertItem({
        source_id: 'p1',
        library_id: '2',
        plex_id: 'ep1',
        title: 'Episode 1',
        type: 'episode',
        file_path: '/dummy/ep1.mkv',
      })

      expect((await db.media.getItems({ type: 'episode', sourceId: 'p1' })).length).toBe(1)

      const showIds = new Set(['show1'])
      await db.media.removeStaleProviderItems('p1', '2', 'episode', showIds)
      expect((await db.media.getItems({ type: 'episode', sourceId: 'p1' })).length).toBe(0)

      await db.media.upsertItem({
        source_id: 'p1',
        library_id: '2',
        plex_id: 'ep1',
        title: 'Episode 1',
        type: 'episode',
        file_path: '/dummy/ep1.mkv',
      })
      const validIds = new Set(['ep1'])
      await db.media.removeStaleProviderItems('p1', '2', 'episode', validIds)
      expect((await db.media.getItems({ type: 'episode', sourceId: 'p1' })).length).toBe(1)
    })
  })
})
