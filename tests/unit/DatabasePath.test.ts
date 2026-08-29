import { describe, expect, it } from 'vitest'
import { resolveDatabasePath } from '../../src/main/database/DatabasePath'
import path from 'node:path'

describe('resolveDatabasePath', () => {
  it('uses one stable database filename under the application user-data directory', () => {
    const basePath = 'C:\\Users\\user\\AppData\\Roaming\\Totality'
    expect(resolveDatabasePath(basePath)).toBe(path.join(basePath, 'totality.db'))
  })
})
