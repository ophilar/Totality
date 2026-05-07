import { describe, it, expect, vi } from 'vitest'
import { getDatabase } from '@main/database/BetterSQLiteService'
import { getLoggingService } from '@main/services/LoggingService'
import { getSourceManager } from '@main/services/SourceManager'
import { getTaskQueueService } from '@main/services/TaskQueueService'

// We use relative imports to check if they resolve to the SAME singleton instance
// This simulates the "Split-Brain" issue where different import paths could
// create multiple instances of a singleton.
// @ts-ignore - Vitest will resolve these
import { getDatabase as getDatabaseRel } from '../../src/main/database/BetterSQLiteService'
// @ts-ignore
import { getLoggingService as getLoggingServiceRel } from '../../src/main/services/LoggingService'
// @ts-ignore
import { getSourceManager as getSourceManagerRel } from '../../src/main/services/SourceManager'
// @ts-ignore
import { getTaskQueueService as getTaskQueueServiceRel } from '../../src/main/services/TaskQueueService'

describe('Singleton Integrity', () => {
  it('should maintain Database identity across aliased and relative imports', () => {
    const aliased = getDatabase()
    const relative = getDatabaseRel()
    expect(aliased).toBe(relative)
  })

  it('should maintain LoggingService identity across aliased and relative imports', () => {
    const aliased = getLoggingService()
    const relative = getLoggingServiceRel()
    expect(aliased).toBe(relative)
  })

  it('should maintain SourceManager identity across aliased and relative imports', () => {
    const aliased = getSourceManager()
    const relative = getSourceManagerRel()
    expect(aliased).toBe(relative)
  })

  it('should maintain TaskQueueService identity across aliased and relative imports', () => {
    const aliased = getTaskQueueService()
    const relative = getTaskQueueServiceRel()
    expect(aliased).toBe(relative)
  })

  it('should share state between "different" import paths', () => {
    const db1 = getDatabase()
    // Set some state on one instance
    // @ts-ignore
    db1._testState = 'shared'
    
    const db2 = getDatabaseRel()
    // @ts-ignore
    expect(db2._testState).toBe('shared')
  })
})



