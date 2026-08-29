import { describe, expect, it } from 'vitest'
import { resolveDatabasePath } from '../../src/main/database/DatabasePath'
import path from 'node:path'

describe('resolveDatabasePath', () => {
  it('uses one stable database filename under the application user-data directory', () => {
    const basePath = process.platform === 'win32'
      ? 'C:\\Users\\user\\AppData\\Roaming\\Totality'
      : '/home/user/.config/Totality';
    const expected = path.join(basePath, 'totality.db');
    expect(resolveDatabasePath(basePath)).toBe(expected);
  })
})
