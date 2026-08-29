import { describe, expect, it } from 'vitest'
import { resolveDatabasePath } from '../../src/main/database/DatabasePath'

describe('resolveDatabasePath', () => {
  it('uses one stable database filename under the application user-data directory', () => {
    expect(resolveDatabasePath('/Users/user/AppData/Roaming/Totality')).toBe('/Users/user/AppData/Roaming/Totality\/totality.db')
  })
})
