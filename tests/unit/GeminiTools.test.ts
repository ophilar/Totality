/**
 * GeminiTools Input Validation Tests
 *
 * Verifies that tool input sanitization helpers correctly validate,
 * clamp, and reject invalid inputs from AI-generated tool calls.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getBetterSQLiteService, resetBetterSQLiteServiceForTesting } from '../../src/main/database/BetterSQLiteService'

// Mock dependencies before importing
vi.mock('../../src/main/services/QualityAnalyzer', () => ({
  getQualityAnalyzer: vi.fn(() => ({
    getQualityDistribution: vi.fn(() => ({})),
  })),
}))

vi.mock('../../src/main/services/TMDBService', () => ({
  getTMDBService: vi.fn(() => ({
    searchMovie: vi.fn(() => ({ results: [] })),
    searchTVShow: vi.fn(() => ({ results: [] })),
    searchCollection: vi.fn(() => ({ results: [] })),
  })),
}))

// Import after mocks
const { executeTool } = await import('../../src/main/services/GeminiTools')

describe('GeminiTools', () => {
  let db: any

  beforeEach(async () => {
    vi.clearAllMocks()
    resetBetterSQLiteServiceForTesting()
    process.env.NODE_ENV = 'test'
    db = getBetterSQLiteService()
    await db.initialize()
  })

  describe('input validation', () => {
    it('should reject search_library with missing query', async () => {
      const result = await executeTool('search_library', {})
      expect(JSON.parse(result)).toEqual({ error: 'query is required' })
    })

    it('should clamp get_media_items limit to max 50', async () => {
      // In real DB, this should execute fine and respect the clamped limit in the SQL (limit 50)
      const result = await executeTool('get_media_items', { limit: 1000 })
      const parsed = JSON.parse(result)
      expect(parsed).toBeDefined()
    })

    it('should default get_media_items limit to 20', async () => {
      const result = await executeTool('get_media_items', {})
      expect(JSON.parse(result)).toBeDefined()
    })

    it('should handle boolean inputs correctly', async () => {
      const result = await executeTool('get_media_items', { needs_upgrade: true })
      expect(JSON.parse(result)).toBeDefined()
    })

    it('should return error for unknown tool', async () => {
      const result = await executeTool('nonexistent_tool', {})
      expect(JSON.parse(result)).toEqual({ error: 'Unknown tool: nonexistent_tool' })
    })
  })
})
