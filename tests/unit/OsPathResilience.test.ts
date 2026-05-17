/**
 * @vitest-environment node
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { PathUtils } from '@main/services/utils/PathUtils'
import { getDatabase } from '@main/database/BetterSQLiteService'
import { setupTestDb, cleanupTestDb } from '@tests/TestUtils'
import { ProviderType } from '@main/types/database'
import * as path from 'node:path'

describe('OS Path Resilience (No Mocks)', () => {
  beforeEach(async () => {
    await setupTestDb()
  })

  afterEach(async () => {
    await cleanupTestDb()
  })

  describe('Normalization Logic', () => {
    it('should convert Windows backslashes to forward slashes for DB', () => {
      const input = 'C:\\Media\\Movies\\Fight Club (1999)\\Fight Club.mkv'
      const expected = 'C:/Media/Movies/Fight Club (1999)/Fight Club.mkv'
      expect(PathUtils.toDatabasePath(input)).toBe(expected)
    })

    it('should handle Windows UNC paths', () => {
      const input = '\\\\NAS\\Movies\\Matrix.mkv'
      const expected = '//NAS/Movies/Matrix.mkv'
      expect(PathUtils.toDatabasePath(input)).toBe(expected)
    })

    it('should resolve redundant segments', () => {
      const input = 'C:\\Media\\..\\Media\\Movies/./Fight Club.mkv'
      const expected = 'C:/Media/Movies/Fight Club.mkv'
      expect(PathUtils.toDatabasePath(input)).toBe(expected)
    })
    
    it('should be idempotent', () => {
        const input = 'C:/Media/Movies/Fight Club.mkv'
        expect(PathUtils.toDatabasePath(input)).toBe(input)
        expect(PathUtils.toDatabasePath(PathUtils.toDatabasePath(input))).toBe(input)
    })
  })

  describe('Database Lookup Resilience', () => {
    it('should find a record regardless of path separator used in query', async () => {
      const db = getDatabase()
      const winPath = 'C:\\Media\\Movies\\Standardized.mkv'
      const dbPath = PathUtils.toDatabasePath(winPath)

      // 1. Insert with standardized path
      await db.media.upsertItem({
        source_id: 's1',
        plex_id: 'p1',
        title: 'Resilient Path Movie',
        type: 'movie',
        file_path: dbPath
      } as any)

      // 2. Query with Windows path (should work via internal normalization)
      const foundByWin = await db.media.getItemByPath(winPath)
      expect(foundByWin).not.toBeNull()
      expect(foundByWin?.title).toBe('Resilient Path Movie')

      // 3. Query with Posix style path
      const posixPath = 'C:/Media/Movies/Standardized.mkv'
      const foundByPosix = await db.media.getItemByPath(posixPath)
      expect(foundByPosix).not.toBeNull()
      expect(foundByPosix?.title).toBe('Resilient Path Movie')
      })

      it('should handle UNC paths in database lookups', async () => {
      const db = getDatabase()
      const uncPath = '\\\\NAS\\Movies\\Matrix.mkv'

      await db.media.upsertItem({
        source_id: 's1',
        plex_id: 'p2',
        title: 'UNC Movie',
        type: 'movie',
        file_path: uncPath
      } as any)

      // Query with normalized version
      const normalizedUnc = '//NAS/Movies/Matrix.mkv'
      const foundByNormalized = await db.media.getItemByPath(normalizedUnc)
      expect(foundByNormalized).not.toBeNull()
      expect(foundByNormalized?.title).toBe('UNC Movie')

      // Query with original UNC
      const foundByOriginal = await db.media.getItemByPath(uncPath)
      expect(foundByOriginal).not.toBeNull()
      })
      })
      })
