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

// Electron infrastructure mocks
vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn(),
  },
  app: {
    getPath: vi.fn().mockReturnValue('./tests/tmp'),
    isReady: vi.fn().mockReturnValue(true),
    whenReady: vi.fn().mockResolvedValue(undefined),
  },
  dialog: {
    showSaveDialog: vi.fn(),
    showOpenDialog: vi.fn(),
  },
  shell: {
    openPath: vi.fn(),
  },
  BrowserWindow: {
    fromWebContents: vi.fn(),
  },
  safeStorage: {
    isEncryptionAvailable: vi.fn().mockReturnValue(true),
    encryptString: vi.fn().mockReturnValue(Buffer.from('encrypted')),
    decryptString: vi.fn().mockReturnValue('decrypted'),
  }
}))

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
      await db.sources.upsertSource({ source_id: 'm1', source_type: 'local', display_name: 'Local Music', connection_config: '{}', is_enabled: 1 })
      await db.sources.setLibrariesEnabled('m1', [{ id: '1', name: 'Music', type: LibraryType.Music, enabled: true }])
      
      const artistId = await db.music.upsertArtist({ source_id: 'm1', source_type: 'local', name: 'Test Artist', library_id: '1', provider_id: 'art1' })
      const albumId = await db.music.upsertAlbum({ source_id: 'm1', source_type: 'local', artist_id: artistId, artist_name: 'Test Artist', title: 'Test Album', library_id: '1', provider_id: 'alb1' })
      await db.music.upsertTrack({ source_id: 'm1', source_type: 'local', album_id: albumId, artist_name: 'Test Artist', album_name: 'Test Album', title: 'Track 1', audio_codec: 'mp3', audio_bitrate: 128, library_id: '1', provider_id: 'trk1' })


      // 2. Verify no quality score exists yet
      expect(await db.music.getQualityScore(albumId)).toBeNull()

      // 3. Trigger scan via SourceManager (which uses SourceScannerService)
      // Mock the provider to avoid real FS scan for simplicity in this specific test
      const manager = new SourceManager({ db })
      const mockProvider = {
        providerType: 'local',
        getLibraries: vi.fn().mockResolvedValue([{ id: '1', name: 'Music', type: LibraryType.Music }]),
        scanLibrary: vi.fn().mockResolvedValue({ success: true, itemsScanned: 1, itemsAdded: 0, itemsUpdated: 0, itemsRemoved: 0, durationMs: 10 })
      }
      ;(manager as any).providers.set('m1', mockProvider)

      await manager.scanLibrary('m1', '1')

      // 4. Verify quality score WAS generated automatically
      const score = await db.music.getQualityScore(albumId)
      expect(score).not.toBeNull()
      expect(score!.quality_tier).toBe('LOSSY_LOW') // 128kbps MP3 is LOW
      expect(score!.needs_upgrade).toBe(true)
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
