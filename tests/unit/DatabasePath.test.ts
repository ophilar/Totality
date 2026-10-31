import { describe, expect, it } from 'vitest'
import * as path from 'path'
import { resolveDatabasePath } from '../../src/main/database/DatabasePath'

describe('resolveDatabasePath', () => {
  it('uses one stable database filename under the application user-data directory', () => {
    const userDataDir = path.join('mock', 'appdata', 'Totality')
    expect(resolveDatabasePath(userDataDir)).toBe(path.join(userDataDir, 'totality.db'))
  })
})
