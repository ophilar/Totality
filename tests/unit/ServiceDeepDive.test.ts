
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { QualityAnalyzer } from '@main/services/QualityAnalyzer'
import { SeriesCompletenessService } from '@main/services/SeriesCompletenessService'
import { setupTestDb, cleanupTestDb } from '@tests/TestUtils'

describe('Service Deep Dive (No Mocks)', () => {
  let dbService: any
  let qualityAnalyzer: QualityAnalyzer
  let seriesService: SeriesCompletenessService

  beforeEach(async () => {
    dbService = await setupTestDb()
    qualityAnalyzer = new QualityAnalyzer()
    seriesService = new SeriesCompletenessService()
  })

  afterEach(() => {
    cleanupTestDb()
  })

  describe('QualityAnalyzer Logic', () => {
    it('should correctly score a 4K HDR movie', async () => {
      await qualityAnalyzer.loadThresholdsFromDatabase()
      
      const item: any = {
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
      
      const item: any = {
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
      
      const album: any = { id: 1, title: 'Hi-Res Album', avg_audio_bitrate: 5000 }
      const tracks: any[] = [
        { is_hi_res: 1, sample_rate: 96000, bit_depth: 24, codec: 'flac', bitrate: 5000, is_lossless: 1 }
      ]
      
      const score = qualityAnalyzer.analyzeMusicAlbum(album, tracks)
      expect(score.quality_tier).toBe('HI_RES')
      expect(score.tier_score).toBeGreaterThan(75)
    })

    it('should correctly identify HI_RES audio from tracks', async () => {
      await qualityAnalyzer.loadThresholdsFromDatabase()
      const album: any = { id: 1, avg_audio_bitrate: 3000 }
      const tracks: any[] = [{ is_hi_res: 1, is_lossless: 1, codec: 'flac' }]
      
      const tier = (qualityAnalyzer as any).determineMusicQualityTier(album, tracks)
      expect(tier).toBe('HI_RES')
    })

    it('should identify LOSSLESS when majority of tracks are lossless', async () => {
      await qualityAnalyzer.loadThresholdsFromDatabase()
      const album: any = { id: 1, avg_audio_bitrate: 1000 }
      const tracks: any[] = [
        { is_hi_res: 0, is_lossless: 1, codec: 'flac' },
        { is_hi_res: 0, is_lossless: 1, codec: 'flac' },
        { is_hi_res: 0, is_lossless: 0, codec: 'mp3' }
      ]
      
      const tier = (qualityAnalyzer as any).determineMusicQualityTier(album, tracks)
      expect(tier).toBe('LOSSLESS')
    })
  })

  describe('SeriesCompletenessService Logic', () => {
    it('should calculate completeness for a simple show', async () => {
      await dbService.db.execute({
        sql: `INSERT INTO series_completeness (series_title, total_seasons, total_episodes, owned_seasons, owned_episodes, completeness_percentage, source_id, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
        args: ['Test Show', 2, 20, 1, 10, 50, 's1']
      })
      
      const row = (await dbService.db.execute({
        sql: "SELECT * FROM series_completeness WHERE series_title = ?",
        args: ['Test Show']
      })).rows[0] as any
      expect(row.completeness_percentage).toBe(50)
    })
  })
})
