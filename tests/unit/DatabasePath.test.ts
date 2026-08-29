import { describe, expect, it } from 'vitest'
import { resolveDatabasePath } from '../../src/main/database/DatabasePath'
import path from 'path'

describe('resolveDatabasePath', () => {
  it('uses one stable database filename under the application user-data directory', () => {
    // Determine the expected separator so it passes on linux CI runners
    const expected = path.join('C:\\Users\\user\\AppData\\Roaming\\Totality', 'totality.db')
    expect(resolveDatabasePath('C:\\Users\\user\\AppData\\Roaming\\Totality')).toBe(expected)
  })
})
