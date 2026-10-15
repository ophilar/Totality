import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest'
import initSqlJs, { type Database } from 'sql.js'

vi.unmock('sql.js')

describe('BetterSQLiteService SQL Queries - SQLite Identifier vs String Literal Verification', () => {
  let SQL: Awaited<ReturnType<typeof initSqlJs>>
  let db: Database

  beforeAll(async () => {
    SQL = await initSqlJs()
  })

  beforeEach(() => {
    db = new SQL.Database()
    db.exec(`
      CREATE TABLE series_completeness (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        series_identity_key TEXT,
        series_title TEXT NOT NULL,
        source_id TEXT NOT NULL DEFAULT '',
        library_id TEXT NOT NULL DEFAULT ''
      );
      CREATE TABLE media_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL,
        series_title TEXT,
        series_identity_key TEXT,
        source_id TEXT,
        library_id TEXT
      );
      PRAGMA dqs = 0;
    `)
  })

  afterEach(() => {
    db.close()
  })

  it('correctly queries series_completeness by canonical identity key under PRAGMA dqs = 0', () => {
    db.exec(`
      INSERT INTO series_completeness (series_identity_key, series_title, source_id, library_id)
      VALUES ('tmdb:43924', 'Lupin the Third: The Woman Called Fujiko Mine', 'src-1', 'lib-1');
    `)

    const querySql =
      'SELECT id FROM series_completeness WHERE series_identity_key = ? AND source_id = ? AND library_id = ?'

    const stmt = db.prepare(querySql)
    stmt.bind(['tmdb:43924', 'src-1', 'lib-1'])
    expect(stmt.step()).toBe(true)
    const row = stmt.getAsObject()
    expect(row.id).toBe(1)
    stmt.free()
  })

  it('succeeds when using single quotes for string literals in getEpisodes query under PRAGMA dqs = 0', () => {
    const validSql =
      "SELECT m.* FROM media_items m WHERE m.type = 'episode' AND m.series_identity_key = ? AND m.source_id = ? AND m.library_id = ?"

    const stmt = db.prepare(validSql)
    expect(stmt).toBeDefined()

    stmt.bind(['tmdb:43924', 'src-1', 'lib-1'])
    expect(stmt.step()).toBe(false)
    stmt.free()
  })
})
