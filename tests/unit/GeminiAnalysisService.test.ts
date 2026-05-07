import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { GeminiAnalysisService } from '@main/services/GeminiAnalysisService'
import { setupTestDb, cleanupTestDb } from '@tests/TestUtils'
import { getGeminiService } from '@main/services/GeminiService'

describe('GeminiAnalysisService', () => {
  let service: GeminiAnalysisService
  let db: any

  beforeEach(async () => {
    db = await setupTestDb()
    service = new GeminiAnalysisService()
    
    // Setup a source and some media
    await db.sources.upsertSource({ source_id: 's1', source_type: 'local', display_name: 'S1', connection_config: '{}', is_enabled: 1 })
    await db.sources.updateLibraryScanTime('s1', 'movies', 1)
  })

  afterEach(() => {
    cleanupTestDb()
  })

  it('should get compression advice for a media item', async () => {
    const id = await db.media.upsertItem({
      source_id: 's1',
      plex_id: 'p1',
      title: 'Test Movie',
      type: 'movie',
      file_path: '/path/movie.mkv',
      file_size: 1000000,
      video_codec: 'h264',
      resolution: '1080p',
    } as any)

    // With no API key configured, it should return a descriptive error message
    // and skipped: true, rather than throwing or using a fake response.
    const result = await service.getCompressionAdvice(id)
    
    expect(result.text).toContain('Gemini AI is not configured')
    expect(result.skipped).toBe(true)
  })

  it('should generate a quality report with skipped status if unconfigured', async () => {
    const onDelta = vi.fn()

    const result = await service.generateQualityReport(onDelta)
    
    expect(result.text).toContain('Gemini AI is not configured')
    expect(result.skipped).toBe(true)
  })
})



