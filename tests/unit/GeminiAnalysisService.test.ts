import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { GeminiAnalysisService } from '../../src/main/services/GeminiAnalysisService'
import { setupTestDb, cleanupTestDb } from '../TestUtils'
import { getGeminiService } from '../../src/main/services/GeminiService'

// Create a consistent mock object
const mockGeminiInstance = {
  sendMessage: vi.fn(),
  streamMessage: vi.fn(),
  isConfigured: vi.fn().mockReturnValue(true),
}

// Mock GeminiService
vi.mock('../../src/main/services/GeminiService', () => ({
  getGeminiService: () => mockGeminiInstance,
}))

describe('GeminiAnalysisService', () => {
  let service: GeminiAnalysisService
  let db: any

  beforeEach(async () => {
    db = await setupTestDb()
    service = new GeminiAnalysisService()
    
    // Setup a source and some media
    db.sources.upsertSource({ source_id: 's1', source_type: 'local', display_name: 'S1', connection_config: '{}', is_enabled: 1 })
    db.sources.updateLibraryScanTime('s1', 'movies', 1)
    
    // Reset mock instance
    mockGeminiInstance.sendMessage.mockReset()
    mockGeminiInstance.streamMessage.mockReset()
  })

  afterEach(() => {
    cleanupTestDb()
  })

  it('should get compression advice for a media item', async () => {
    const id = db.media.upsertItem({
      source_id: 's1',
      plex_id: 'p1',
      title: 'Test Movie',
      type: 'movie',
      file_path: '/path/movie.mkv',
      file_size: 1000000,
      video_codec: 'h264',
      resolution: '1080p',
    } as any)

    mockGeminiInstance.sendMessage.mockResolvedValue({ text: 'Use HEVC with CRF 20' })

    const result = await service.getCompressionAdvice(id)
    
    expect(result.text).toBe('Use HEVC with CRF 20')
    expect(mockGeminiInstance.sendMessage).toHaveBeenCalled()
  })

  it('should generate a quality report', async () => {
    mockGeminiInstance.streamMessage.mockResolvedValue({ text: 'Report text' })
    const onDelta = vi.fn()

    const result = await service.generateQualityReport(onDelta)
    
    expect(result.text).toBe('Report text')
    expect(mockGeminiInstance.streamMessage).toHaveBeenCalled()
  })

  it('should generate upgrade priorities', async () => {
    mockGeminiInstance.streamMessage.mockResolvedValue({ text: 'Priority list' })
    const onDelta = vi.fn()

    const result = await service.generateUpgradePriorities(onDelta)
    
    expect(result.text).toBe('Priority list')
    expect(mockGeminiInstance.streamMessage).toHaveBeenCalled()
  })

  it('should generate completeness insights', async () => {
    mockGeminiInstance.streamMessage.mockResolvedValue({ text: 'Insights' })
    const onDelta = vi.fn()

    const result = await service.generateCompletenessInsights(onDelta)
    
    expect(result.text).toBe('Insights')
    expect(mockGeminiInstance.streamMessage).toHaveBeenCalled()
  })

  it('should generate wishlist advice', async () => {
    mockGeminiInstance.streamMessage.mockResolvedValue({ text: 'Shopping advice' })
    const onDelta = vi.fn()

    const result = await service.generateWishlistAdvice(onDelta)
    
    expect(result.text).toBe('Shopping advice')
    expect(mockGeminiInstance.streamMessage).toHaveBeenCalled()
  })
})
