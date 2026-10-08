/**
 * SeriesIdentityMigration Real Database Tests
 *
 * Runs SeriesIdentityMigration against a real in-memory SQLite database (sql.js)
 * to verify deterministic summary deduplication, metadata merging, cross-episode
 * key unification, unresolved record scoping, and trigger constraints.
 */

import { describe, it, expect, beforeEach, beforeAll, vi } from 'vitest'

// Unmock sql.js to use real SQLite WebAssembly engine
vi.unmock('sql.js')

import initSqlJs, { type Database } from 'sql.js'
import {
  backfillSeriesIdentityKeys,
  enforceSeriesIdentityConstraints,
} from '../../../src/main/database/SeriesIdentityMigration'

let SQL: Awaited<ReturnType<typeof initSqlJs>>

beforeAll(async () => {
  SQL = await initSqlJs()
})

function createSqlJsAdapter(db: Database) {
  return {
    exec(sql: string) {
      db.exec(sql)
    },
    prepare(sql: string) {
      return {
        all(...params: any[]) {
          const flatParams = params.length === 1 && Array.isArray(params[0]) ? params[0] : params
          const res = db.exec(sql, flatParams.map(p => (p === undefined ? null : p)))
          if (!res.length) return []
          const { columns, values } = res[0]
          return values.map(row => {
            const obj: Record<string, any> = {}
            columns.forEach((col, idx) => {
              obj[col] = row[idx]
            })
            return obj
          })
        },
        get(...params: any[]) {
          const flatParams = params.length === 1 && Array.isArray(params[0]) ? params[0] : params
          const res = db.exec(sql, flatParams.map(p => (p === undefined ? null : p)))
          if (!res.length || !res[0].values.length) return undefined
          const { columns, values } = res[0]
          const obj: Record<string, any> = {}
          columns.forEach((col, idx) => {
            obj[col] = values[0][idx]
          })
          return obj
        },
        run(...params: any[]) {
          const flatParams = params.length === 1 && Array.isArray(params[0]) ? params[0] : params
          db.run(sql, flatParams.map(p => (p === undefined ? null : p)))
          return { changes: db.getRowsModified() }
        },
      }
    },
    transaction(fn: (...args: any[]) => any) {
      return (...args: any[]) => {
        db.exec('SAVEPOINT sp_tx')
        try {
          const result = fn(...args)
          db.exec('RELEASE SAVEPOINT sp_tx')
          return result
        } catch (err) {
          db.exec('ROLLBACK TO SAVEPOINT sp_tx')
          throw err
        }
      }
    },
  }
}

describe('SeriesIdentityMigration (Real SQLite via sql.js)', () => {
  let rawDb: Database
  let db: ReturnType<typeof createSqlJsAdapter>

  beforeEach(() => {
    rawDb = new SQL.Database()
    db = createSqlJsAdapter(rawDb)

    // Setup minimal schema representing pre-migration tables
    db.exec(`
      CREATE TABLE series_completeness (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        series_title TEXT NOT NULL,
        source_id TEXT NOT NULL,
        library_id TEXT,
        total_seasons INTEGER DEFAULT 0,
        total_episodes INTEGER DEFAULT 0,
        owned_seasons INTEGER DEFAULT 0,
        owned_episodes INTEGER DEFAULT 0,
        completeness_percentage INTEGER DEFAULT 0,
        tmdb_id TEXT,
        tvdb_id TEXT,
        poster_url TEXT,
        backdrop_url TEXT,
        status TEXT,
        updated_at TEXT,
        series_identity_key TEXT
      );

      CREATE TABLE media_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL,
        title TEXT NOT NULL,
        series_title TEXT,
        source_id TEXT NOT NULL,
        library_id TEXT,
        series_tmdb_id TEXT,
        tmdb_id TEXT,
        file_path TEXT NOT NULL,
        series_identity_key TEXT
      );
    `)
  })

  it('deterministically selects richest summary as surviving winner and merges missing metadata', () => {
    // Insert duplicate records for the same series
    // Record 1: Older, partial completeness, has backdrop_url and status
    db.prepare(`
      INSERT INTO series_completeness (
        series_title, source_id, library_id, completeness_percentage, owned_episodes,
        tmdb_id, tvdb_id, poster_url, backdrop_url, status, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'Breaking Bad', 'src-1', 'lib-1', 25, 15,
      '1396', null, null, 'https://image.tmdb.org/backdrop1.jpg', 'Returning Series', '2025-01-01'
    )

    // Record 2: Newer, 100% complete, has poster_url, tvdb_id, but missing backdrop_url
    db.prepare(`
      INSERT INTO series_completeness (
        series_title, source_id, library_id, completeness_percentage, owned_episodes,
        tmdb_id, tvdb_id, poster_url, backdrop_url, status, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'Breaking Bad', 'src-1', 'lib-1', 100, 62,
      '1396', '81189', 'https://image.tmdb.org/poster2.jpg', null, 'Ended', '2026-02-01'
    )

    // Insert an episode for Breaking Bad
    db.prepare(`
      INSERT INTO media_items (type, title, series_title, source_id, library_id, series_tmdb_id, file_path)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run('episode', 'Pilot', 'Breaking Bad', 'src-1', 'lib-1', '1396', '/media/bb/s01e01.mkv')

    backfillSeriesIdentityKeys(db as any)

    // Verify exactly one summary record survives
    const summaries = db.prepare('SELECT * FROM series_completeness').all()
    expect(summaries).toHaveLength(1)

    const winner = summaries[0]
    expect(winner.series_identity_key).toBe('tmdb:1396')
    expect(winner.completeness_percentage).toBe(100)
    expect(winner.owned_episodes).toBe(62)
    expect(winner.poster_url).toBe('https://image.tmdb.org/poster2.jpg')
    // backdrop_url merged from loser
    expect(winner.backdrop_url).toBe('https://image.tmdb.org/backdrop1.jpg')
    // tvdb_id preserved
    expect(winner.tvdb_id).toBe('81189')
  })

  it('unifies all episodes under canonical key when only one episode has TMDB ID', () => {
    // 3 episodes of Better Call Saul, but only episode 1 has series_tmdb_id
    db.prepare(`
      INSERT INTO media_items (type, title, series_title, source_id, library_id, series_tmdb_id, file_path)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run('episode', 'Uno', 'Better Call Saul', 'src-1', 'lib-tv', '60059', '/tv/bcs/s01e01.mkv')

    db.prepare(`
      INSERT INTO media_items (type, title, series_title, source_id, library_id, series_tmdb_id, file_path)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run('episode', 'Mijo', 'Better Call Saul', 'src-1', 'lib-tv', null, '/tv/bcs/s01e02.mkv')

    db.prepare(`
      INSERT INTO media_items (type, title, series_title, source_id, library_id, series_tmdb_id, file_path)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run('episode', 'Nacho', 'Better Call Saul', 'src-1', 'lib-tv', null, '/tv/bcs/s01e03.mkv')

    backfillSeriesIdentityKeys(db as any)

    const episodes = db.prepare('SELECT id, series_identity_key FROM media_items ORDER BY id').all()
    expect(episodes).toHaveLength(3)
    for (const ep of episodes) {
      expect(ep.series_identity_key).toBe('tmdb:60059')
    }
  })

  it('assigns scoped unresolved keys to ambiguous records without guessing', () => {
    db.prepare(`
      INSERT INTO series_completeness (series_title, source_id, library_id, completeness_percentage)
      VALUES (?, ?, ?, ?)
    `).run('Unknown Home Movie Series', 'local-nas', 'home-vids', 50)

    db.prepare(`
      INSERT INTO media_items (type, title, series_title, source_id, library_id, file_path)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run('episode', 'Part 1', 'Unknown Home Movie Series', 'local-nas', 'home-vids', '/nas/part1.mp4')

    backfillSeriesIdentityKeys(db as any)

    const summary = db.prepare('SELECT series_identity_key FROM series_completeness').get()
    const episode = db.prepare('SELECT series_identity_key FROM media_items').get()

    expect(summary.series_identity_key).toBe('unresolved:local-nas:home-vids:unknown-home-movie-series')
    expect(episode.series_identity_key).toBe('unresolved:local-nas:home-vids:unknown-home-movie-series')
  })

  it('enforces SQLite triggers that abort invalid/empty series_identity_key writes', () => {
    backfillSeriesIdentityKeys(db as any)

    // Attempting to insert a row with NULL series_identity_key should fail
    expect(() => {
      db.prepare(`
        INSERT INTO series_completeness (series_title, source_id, library_id, series_identity_key)
        VALUES ('Illegal Show', 'src-1', 'lib-1', NULL)
      `).run()
    }).toThrow(/series_identity_key is required/)

    // Attempting to insert a row with blank whitespace series_identity_key should fail
    expect(() => {
      db.prepare(`
        INSERT INTO series_completeness (series_title, source_id, library_id, series_identity_key)
        VALUES ('Illegal Show', 'src-1', 'lib-1', '   ')
      `).run()
    }).toThrow(/series_identity_key is required/)

    // Valid insert succeeds
    db.prepare(`
      INSERT INTO series_completeness (series_title, source_id, library_id, series_identity_key)
      VALUES ('Legal Show', 'src-1', 'lib-1', 'tmdb:99999')
    `).run()

    // Attempting to update series_identity_key to empty string should fail
    expect(() => {
      db.prepare(`
        UPDATE series_completeness SET series_identity_key = '' WHERE series_title = 'Legal Show'
      `).run()
    }).toThrow(/series_identity_key is required/)
  })
})
