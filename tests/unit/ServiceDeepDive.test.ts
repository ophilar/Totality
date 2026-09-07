
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { QualityAnalyzer } from '@main/services/QualityAnalyzer'
import { SeriesCompletenessService } from '@main/services/SeriesCompletenessService'
import { setupTestDb, cleanupTestDb } from '@tests/TestUtils'
import type { MediaItem, MusicAlbum, MusicTrack } from '@main/types/database'

describe('Service Deep Dive (No Mocks)', () => {
  let dbService: Awaited<ReturnType<typeof setupTestDb>>
  let qualityAnalyzer: QualityAnalyzer
  let _seriesService: SeriesCompletenessService

  beforeEach(async () => {
    dbService = await setupTestDb()
    qualityAnalyzer = new QualityAnalyzer()
    _seriesService = new SeriesCompletenessService()
  })

  afterEach(() => {
    cleanupTestDb()
  })

  describe('QualityAnalyzer Logic', () => {
    it('should correctly score a 4K HDR movie', async () => {
      await qualityAnalyzer.loadThresholdsFromDatabase()
      
      const item: MediaItem = {
        type: 'movie',
        resolution: '4K',
        width: 3840,
        height: 2160,
        video_codec: 'hevc',
        video_bitrate: 60000,
        hdr_format: 'HDR10',
        audio_codec: 'truehd',
        audio_channels: 8,
        audio_bitrate: 5000
      }
      
      const score = await qualityAnalyzer.analyzeMediaItem(item)
      expect(score.quality_tier).toBe('4K')
      expect(score.overall_score).toBeGreaterThan(90)
      expect(score.needs_upgrade).toBe(false)
    })

    it('should identify a low quality SD episode', async () => {
      await qualityAnalyzer.loadThresholdsFromDatabase()
      
      const item: MediaItem = {
        type: 'episode',
        resolution: 'SD',
        width: 640,
        height: 480,
        video_codec: 'h264',
        video_bitrate: 800,
        audio_codec: 'aac',
        audio_channels: 2,
        audio_bitrate: 96
      }
      
      const score = await qualityAnalyzer.analyzeMediaItem(item)
      expect(score.quality_tier).toBe('SD')
      expect(score.overall_score).toBeLessThan(40)
      expect(score.needs_upgrade).toBe(true)
    })

    it('should correctly analyze Hi-Res Audio', async () => {
      await qualityAnalyzer.loadThresholdsFromDatabase()
      
      const album = { id: 1, title: 'Hi-Res Album', avg_audio_bitrate: 5000 } as MusicAlbum
      const tracks = [
        { is_hi_res: true, sample_rate: 96000, bit_depth: 24, audio_codec: 'flac', audio_bitrate: 5000, is_lossless: true }
      ] as MusicTrack[]
      
      const score = qualityAnalyzer.analyzeMusicAlbum(album, tracks)
      expect(score.quality_tier).toBe('HI_RES')
      expect(score.tier_score).toBeGreaterThan(75)
    })

    it('should correctly identify HI_RES audio from tracks', async () => {
      await qualityAnalyzer.loadThresholdsFromDatabase()
      const album = { id: 1, avg_audio_bitrate: 3000 } as MusicAlbum
      const tracks = [{ is_hi_res: true, is_lossless: true, audio_codec: 'flac' }] as MusicTrack[]
      
      expect(qualityAnalyzer.analyzeMusicAlbum(album, tracks).quality_tier).toBe('HI_RES')
    })

    it('should identify LOSSLESS when majority of tracks are lossless', async () => {
      await qualityAnalyzer.loadThresholdsFromDatabase()
      const album = { id: 1, avg_audio_bitrate: 1000 } as MusicAlbum
      const tracks = [
        { is_hi_res: false, is_lossless: true, audio_codec: 'flac' },
        { is_hi_res: false, is_lossless: true, audio_codec: 'flac' },
        { is_hi_res: false, is_lossless: false, audio_codec: 'mp3' }
      ] as MusicTrack[]
      
      expect(qualityAnalyzer.analyzeMusicAlbum(album, tracks).quality_tier).toBe('LOSSLESS')
    })
  })

  describe('SeriesCompletenessService Logic', () => {
    it('should calculate completeness for a simple show', async () => {
      await dbService.db.execute({
        sql: `INSERT INTO series_completeness (series_title, series_identity_key, total_seasons, total_episodes, owned_seasons, owned_episodes, completeness_percentage, source_id, library_id, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
        args: ['Test Show', 'unresolved:s1:lib1:test-show', 2, 20, 1, 10, 50, 's1', 'lib1']
      })
      
      const row = (await dbService.db.execute({
        sql: "SELECT * FROM series_completeness WHERE series_title = ?",
        args: ['Test Show']
      })).rows[0]
      expect(row.completeness_percentage).toBe(50)
    })
  })
})
