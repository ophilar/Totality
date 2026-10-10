import { beforeAll, describe, expect, it, vi } from 'vitest'

vi.unmock('sql.js')

import initSqlJs, { type Database } from 'sql.js'
import { runMigration } from '../../../src/main/database/migrations/002_kodi_local_support'

let SQL: Awaited<ReturnType<typeof initSqlJs>>

beforeAll(async () => {
  SQL = await initSqlJs()
})

describe('Kodi local migration', () => {
  it('repairs null media source timestamps while preserving existing timestamps', async () => {
    const db: Database = new SQL.Database()
    try {
      db.run(`
        CREATE TABLE media_sources (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          source_id TEXT NOT NULL UNIQUE,
          source_type TEXT NOT NULL CHECK(source_type IN ('plex', 'jellyfin', 'emby', 'kodi')),
          display_name TEXT NOT NULL,
          connection_config TEXT NOT NULL DEFAULT '{}',
          is_enabled INTEGER NOT NULL DEFAULT 1,
          last_connected_at TEXT,
          last_scan_at TEXT,
          created_at TEXT,
          updated_at TEXT
        )
      `)
      db.run(`
        INSERT INTO media_sources (source_id, source_type, display_name, created_at, updated_at)
        VALUES ('legacy', 'plex', 'Legacy source', NULL, NULL),
               ('current', 'jellyfin', 'Current source', '2026-01-02', '2026-01-03')
      `)
      db.run('CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)')

      await runMigration(db)

      const result = db.exec('SELECT source_id, created_at, updated_at FROM media_sources ORDER BY source_id')[0]
      expect(result.values).toHaveLength(2)
      expect(result.values[0]).toEqual(['current', '2026-01-02', '2026-01-03'])
      expect(result.values[1][1]).toEqual(expect.any(String))
      expect(result.values[1][2]).toEqual(expect.any(String))
      expect(result.values[1][1]).not.toBe('')
      expect(result.values[1][2]).not.toBe('')
    } finally {
      db.close()
    }
  })
})
