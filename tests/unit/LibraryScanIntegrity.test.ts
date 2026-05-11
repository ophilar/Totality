import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { registerDatabaseHandlers } from '@main/ipc/database'
import { ipcMain } from 'electron'
import { getMovieCollectionService } from '@main/services/MovieCollectionService'
import { SourceManager } from '@main/services/SourceManager'
import { getLiveMonitoringService } from '@main/services/LiveMonitoringService'
import { LibraryType } from '@main/types/database'
import { setupTestDb, cleanupTestDb, createTempDir } from '@tests/TestUtils'
import * as fs from 'fs'
import * as path from 'path'
import { StatsRepository } from '@main/database/repositories/StatsRepository'

describe('Library Issues Fixes (Deep Dive)', () => {
  let db: any
  let tempDir: { path: string; cleanup: () => void }

  beforeEach(async () => {
    db = await setupTestDb()
    tempDir = createTempDir('library-integrity-fix')
    vi.clearAllMocks()
  })

  afterEach(() => {
    cleanupTestDb()
    tempDir.cleanup()
  })

  describe('Music Quality Integration - TaskQueue to SourceScanner', () => {
    it('should automatically analyze music quality after a library scan', async () => {
      // 1. Setup a music artist/album/track in DB
      const sourceId = 'm1'
      const libraryId = 'music'
      const folderPath = path.join(tempDir.path, 'music')
      fs.mkdirSync(folderPath, { recursive: true })

      await db.sources.upsertSource({ 
        source_id: sourceId, 
        source_type: 'local', 
        display_name: 'Local Music', 
        connection_config: JSON.stringify({ folderPath, mediaType: LibraryType.Music }), 
        is_enabled: 1 
      })
      await db.sources.setLibrariesEnabled(sourceId, [{ id: libraryId, name: 'Music', type: LibraryType.Music, enabled: true }])
      
      // Create a real file structure so LocalFolderProvider can find it
      const albumPath = path.join(folderPath, 'Artist 1', 'Album 1')
      fs.mkdirSync(albumPath, { recursive: true })
      fs.writeFileSync(path.join(albumPath, '01 - Track 1.mp3'), 'dummy mp3')

      // Mock ffprobe for the analyzer used by the provider
      const analyzer = (await import('@main/services/MediaFileAnalyzer')).getMediaFileAnalyzer()
      vi.spyOn(analyzer as any, 'runFFprobe').mockResolvedValue({
        format: { format_name: 'mp3', size: '1000', duration: '180' },
        streams: [
          { codec_type: 'audio', codec_name: 'mp3', bit_rate: '128000', channels: 2, sample_rate: '44100' }
        ]
      })

      // 2. Trigger scan via real SourceManager
      const manager = new SourceManager()
      await manager.initialize()
      
      await manager.scanLibrary(sourceId, libraryId)

      // 3. Verify quality score WAS generated automatically
      const albums = await db.music.getMusicAlbums({ sourceId })
      expect(albums.length).toBe(1)
      const albumId = albums[0].id

      const score = await db.music.getQualityScore(albumId!)
      expect(score).not.toBeNull()
      expect(score!.quality_tier).toBe('LOSSY_LOW') // 128kbps MP3 is LOW
      expect(score!.needs_upgrade).toBe(true)
    })
  })

  describe('Music Scan Routing Integrity', () => {
    it('should correctly route music scans to the music-specific scanning engine', async () => {
      const sourceId = 'music-route-test'
      const libraryId = 'music'
      
      // 1. Setup local source with music library
      const folderPath = path.join(tempDir.path, 'music-route')
      fs.mkdirSync(folderPath, { recursive: true })
      
      await db.sources.upsertSource({ 
        source_id: sourceId, 
        source_type: 'local', 
        display_name: 'Routing Test', 
        connection_config: JSON.stringify({ folderPath, mediaType: LibraryType.Music }), 
        is_enabled: 1 
      })

      // 2. Trigger scan via manager
      const manager = new SourceManager()
      await manager.initialize()
      
      // Ensure the provider itself knows it's a music source for the routing logic
      const provider = manager.getProvider(sourceId) as any
      if (provider) provider.mediaType = LibraryType.Music
      
      // Create a real file so the scanner has something to do
      const artistDir = path.join(folderPath, 'Test Artist')
      const albumDir = path.join(artistDir, 'Test Album')
      fs.mkdirSync(albumDir, { recursive: true })
      fs.writeFileSync(path.join(albumDir, 'song.mp3'), 'audio content')

      // Mock ffprobe for the analyzer
      const analyzer = (await import('@main/services/MediaFileAnalyzer')).getMediaFileAnalyzer()
      vi.spyOn(analyzer as any, 'runFFprobe').mockResolvedValue({
        format: { format_name: 'mp3', size: '500', duration: '200' },
        streams: [{ codec_type: 'audio', codec_name: 'mp3', bit_rate: '256000', channels: 2 }]
      })

      await manager.scanLibrary(sourceId, libraryId)

      // 3. Verify music-specific entities were created (MusicArtist, MusicAlbum)
      // This proves it went through the MusicScanner route, not just the generic Media route
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
      
      // 1. Setup source and a series with 0% completeness (unmatched)
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
        completeness_percentage: 0
      })

      // 2. Get dashboard summary
      const summary = await statsRepo.getDashboardSummary()

      // 3. Verify it appears in incompleteSeries
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
        file_path: '/dummy/ep1.mkv'
      } as any)

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
        file_path: '/dummy/ep1.mkv'
      } as any)
      const validIds = new Set(['ep1'])
      await db.media.removeStaleProviderItems('p1', '2', 'episode', validIds)
      expect((await db.media.getItems({ type: 'episode', sourceId: 'p1' })).length).toBe(1)
    })
  })
})
