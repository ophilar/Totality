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

  it('correctly handles empty string check with single quotes in upsertSeriesCompleteness query', () => {
    // Insert a legacy record with empty series_identity_key
    db.exec(`
      INSERT INTO series_completeness (series_identity_key, series_title, source_id, library_id)
      VALUES ('', 'Lupin the Third: The Woman Called Fujiko Mine', 'src-1', 'lib-1');
    `)

    const querySql =
      'SELECT id FROM series_completeness WHERE (series_identity_key = ? OR (series_title = ? AND (series_identity_key IS NULL OR series_identity_key = \'\'))) AND source_id = ? AND library_id = ?'

    const stmt = db.prepare(querySql)
    stmt.bind(['tmdb:43924', 'Lupin the Third: The Woman Called Fujiko Mine', 'src-1', 'lib-1'])
    expect(stmt.step()).toBe(true)
    const row = stmt.getAsObject()
    expect(row.id).toBe(1)
    stmt.free()
  })

  it('succeeds when using single quotes \'\' for empty string literal in upsertSeriesCompleteness query', () => {
    const validSql =
      'SELECT id FROM series_completeness WHERE (series_identity_key = ? OR (series_title = ? AND (series_identity_key IS NULL OR series_identity_key = \'\'))) AND source_id = ? AND library_id = ?'

    // With single quotes, SQLite correctly treats '' as empty string literal
    const stmt = db.prepare(validSql)
    expect(stmt).toBeDefined()

    // Test execution with parameters
    stmt.bind(['tmdb:43924', 'Lupin the Third: The Woman Called Fujiko Mine', 'src-1', 'lib-1'])
    expect(stmt.step()).toBe(false)
    stmt.free()
  })

  it('succeeds when using single quotes \'\' in getEpisodesForSeries query', () => {
    const validSql =
      "SELECT series_identity_key FROM media_items WHERE type = 'episode' AND series_title = ? AND source_id = ? AND library_id = ? AND series_identity_key IS NOT NULL AND series_identity_key != '' LIMIT 1"

    const stmt = db.prepare(validSql)
    expect(stmt).toBeDefined()

    stmt.bind(['Lupin the Third: The Woman Called Fujiko Mine', 'src-1', 'lib-1'])
    expect(stmt.step()).toBe(false)
    stmt.free()
  })
})
