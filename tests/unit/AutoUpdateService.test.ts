import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getAutoUpdateService } from '../../src/main/services/AutoUpdateService'
import * as dbModule from '../../src/main/database/BetterSQLiteService'

// Mock dependencies
vi.mock('../../src/main/database/BetterSQLiteService', () => ({
  getDatabase: vi.fn(),
}))

vi.mock('../../src/main/services/LoggingService', () => ({
  getLoggingService: vi.fn().mockReturnValue({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
}))

vi.mock('electron', () => ({
  app: {
    isPackaged: true,
  },
}))

describe('AutoUpdateService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('autoCheckIfEnabled', () => {
    it('throws error when database access fails', async () => {
      const mockError = new Error('Database access error')

      // Setup mock to throw when getting setting
      vi.mocked(dbModule.getDatabase).mockReturnValue({
        config: {
          getSetting: vi.fn().mockImplementation(() => {
            throw mockError
          }),
        },
      } as any)

      const service = getAutoUpdateService()

      // autoCheckIfEnabled is private, so we access it via bracket notation
      await expect(service['autoCheckIfEnabled']()).rejects.toThrow('Database access error')
    })
  })
})
