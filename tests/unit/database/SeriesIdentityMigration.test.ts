import { describe, it, expect, vi } from 'vitest'
import {
  backfillSeriesIdentityKeys,
  enforceSeriesIdentityConstraints,
} from '@main/database/SeriesIdentityMigration'

describe('SeriesIdentityMigration', () => {
  it('backfills historical series completeness and episode records with canonical identity keys', () => {
    const executedSql: string[] = []
    const updatedCompleteness: Array<{ id: number; key: string }> = []
    const updatedEpisodes: Array<{ id: number; key: string }> = []

    const completenessRows = [
      { id: 1, series_title: 'Breaking Bad', source_id: 'src-1', library_id: 'lib-1', tmdb_id: '1396', tvdb_id: null },
      { id: 2, series_title: 'Unmatched Show', source_id: 'src-2', library_id: 'lib-2', tmdb_id: null, tvdb_id: null },
    ]

    const episodeRows = [
      { id: 10, series_title: 'Breaking Bad', source_id: 'src-1', library_id: 'lib-1', series_tmdb_id: '1396', tmdb_id: null },
      { id: 20, series_title: 'Unmatched Show', source_id: 'src-2', library_id: 'lib-2', series_tmdb_id: null, tmdb_id: null },
    ]

    const mockDb = {
      exec: vi.fn((sql: string) => {
        executedSql.push(sql)
      }),
      prepare: vi.fn((sql: string) => {
        if (sql.includes('SELECT id, series_title, source_id, library_id, tmdb_id, tvdb_id')) {
          return { all: () => completenessRows, get: () => undefined, run: () => {} }
        }
        if (sql.includes('SELECT id, series_title, source_id, library_id, series_tmdb_id')) {
          return { all: () => episodeRows, get: () => undefined, run: () => {} }
        }
        if (sql.includes('UPDATE series_completeness SET series_identity_key = ?')) {
          return {
            all: () => [],
            get: () => undefined,
            run: (key: string, id: number) => {
              updatedCompleteness.push({ id, key })
            },
          }
        }
        if (sql.includes('UPDATE media_items SET series_identity_key = ?')) {
          return {
            all: () => [],
            get: () => undefined,
            run: (key: string, id: number) => {
              updatedEpisodes.push({ id, key })
            },
          }
        }
        if (sql.includes('LIMIT 1')) {
          return { all: () => [], get: () => undefined, run: () => {} }
        }
        if (sql.includes('COUNT(*) > 1') || sql.includes('GROUP BY series_identity_key')) {
          return { all: () => [], get: () => undefined, run: () => {} }
        }
        return {
          all: () => [],
          get: () => undefined,
          run: () => {},
        }
      }),
      transaction: vi.fn((fn: () => void) => fn),
    }

    backfillSeriesIdentityKeys(mockDb as any)

    expect(updatedCompleteness).toEqual([
      { id: 1, key: 'tmdb:1396' },
      { id: 2, key: 'unresolved:src-2:lib-2:unmatched-show' },
    ])

    expect(updatedEpisodes).toEqual([
      { id: 10, key: 'tmdb:1396' },
      { id: 20, key: 'unresolved:src-2:lib-2:unmatched-show' },
    ])

    expect(mockDb.exec).toHaveBeenCalled()
  })

  it('throws an error if migration leaves a series completeness row without an identity key', () => {
    const mockDb = {
      exec: vi.fn(),
      prepare: vi.fn((sql: string) => {
        if (sql.includes('series_completeness') && sql.includes('LIMIT 1')) {
          return { get: () => ({ id: 999 }) }
        }
        return {
          all: () => [],
          get: () => undefined,
          run: () => {},
        }
      }),
      transaction: vi.fn((fn: () => void) => fn),
    }

    expect(() => enforceSeriesIdentityConstraints(mockDb as any)).toThrow(
      'Series identity migration left a completeness row without a canonical identity'
    )
  })
})
