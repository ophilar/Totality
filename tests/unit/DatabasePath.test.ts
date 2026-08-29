import { describe, expect, it } from 'vitest'
import { resolveDatabasePath } from '../../src/main/database/DatabasePath'

describe('resolveDatabasePath', () => {
  it('uses one stable database filename under the application user-data directory', () => {
    expect(resolveDatabasePath('C:\\Users\\user\\AppData\\Roaming\\Totality').replace(/\\/g, '/')).toBe('C:/Users/user/AppData/Roaming/Totality/totality.db')
  })
})
