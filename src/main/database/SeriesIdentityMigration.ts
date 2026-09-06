import type { Client } from '@libsql/client'
import { deriveSeriesIdentityKey } from '@main/services/SeriesIdentityService'

interface SeriesCompletenessIdentityRow {
  id: number
  series_title: string
  source_id: string
  library_id: string
  tmdb_id: string | null
  tvdb_id: string | null
}

interface EpisodeIdentityRow {
  id: number
  series_title: string
  source_id: string
  library_id: string
  series_tmdb_id: string | null
}

const SERIES_UNIQUENESS_INDEXES = [
  {
    name: 'idx_series_completeness_unique',
    create: 'CREATE UNIQUE INDEX IF NOT EXISTS idx_series_completeness_unique ON series_completeness(series_identity_key, source_id, library_id)',
  },
  {
    name: 'idx_series_completeness_tvdb',
    create: "CREATE UNIQUE INDEX IF NOT EXISTS idx_series_completeness_tvdb ON series_completeness(source_id, library_id, tvdb_id) WHERE tvdb_id IS NOT NULL AND tvdb_id != ''",
  },
  {
    name: 'idx_series_completeness_tmdb',
    create: "CREATE UNIQUE INDEX IF NOT EXISTS idx_series_completeness_tmdb ON series_completeness(source_id, library_id, tmdb_id) WHERE tmdb_id IS NOT NULL AND tmdb_id != ''",
  },
] as const

export async function backfillSeriesIdentityKeys(db: Client): Promise<void> {
  for (const index of SERIES_UNIQUENESS_INDEXES) {
    await db.execute(`DROP INDEX IF EXISTS ${index.name}`)
  }

  const completenessRows = await db.execute(`
    SELECT id, series_title, source_id, library_id, tmdb_id, tvdb_id
    FROM series_completeness
    WHERE series_identity_key IS NULL OR TRIM(series_identity_key) = ''
  `)
  const episodeRows = await db.execute(`
    SELECT id, series_title, source_id, library_id, series_tmdb_id
    FROM media_items
    WHERE type = 'episode'
      AND series_title IS NOT NULL
      AND series_title <> ''
      AND (series_identity_key IS NULL OR TRIM(series_identity_key) = '')
  `)

  await db.execute('BEGIN IMMEDIATE')
  try {
    for (const rawRow of completenessRows.rows) {
      const row = rawRow as unknown as SeriesCompletenessIdentityRow
      const identityKey = deriveSeriesIdentityKey({
        sourceId: row.source_id,
        libraryId: row.library_id,
        folderRelativePath: row.series_title,
        tmdbId: row.tmdb_id,
        tvdbId: row.tvdb_id,
      })
      await db.execute({
        sql: 'UPDATE series_completeness SET series_identity_key = ? WHERE id = ?',
        args: [identityKey, row.id],
      })
    }

    for (const rawRow of episodeRows.rows) {
      const row = rawRow as unknown as EpisodeIdentityRow
      const identityKey = deriveSeriesIdentityKey({
        sourceId: row.source_id,
        libraryId: row.library_id,
        folderRelativePath: row.series_title,
        tmdbId: row.series_tmdb_id,
      })
      await db.execute({
        sql: 'UPDATE media_items SET series_identity_key = ? WHERE id = ?',
        args: [identityKey, row.id],
      })
    }

    await db.execute('COMMIT')
  } catch (error) {
    await db.execute('ROLLBACK')
    throw error
  }
}

export async function enforceSeriesIdentityConstraints(db: Client): Promise<void> {
  const invalidIdentity = await db.execute(`
    SELECT id
    FROM series_completeness
    WHERE series_identity_key IS NULL OR TRIM(series_identity_key) = ''
    LIMIT 1
  `)
  if (invalidIdentity.rows.length > 0) {
    throw new Error('Series identity migration left a completeness row without a canonical identity')
  }

  const duplicateIdentity = await db.execute(`
    SELECT series_identity_key, source_id, library_id
    FROM series_completeness
    GROUP BY series_identity_key, source_id, library_id
    HAVING COUNT(*) > 1
    LIMIT 1
  `)
  if (duplicateIdentity.rows.length > 0) {
    throw new Error('Series identity migration left duplicate canonical completeness rows')
  }

  for (const index of SERIES_UNIQUENESS_INDEXES) {
    await db.execute(index.create)
  }

  await db.execute(`
    CREATE TRIGGER IF NOT EXISTS trg_series_completeness_identity_insert
    BEFORE INSERT ON series_completeness
    FOR EACH ROW
    WHEN NEW.series_identity_key IS NULL OR TRIM(NEW.series_identity_key) = ''
    BEGIN
      SELECT RAISE(ABORT, 'series_identity_key is required');
    END
  `)
  await db.execute(`
    CREATE TRIGGER IF NOT EXISTS trg_series_completeness_identity_update
    BEFORE UPDATE OF series_identity_key ON series_completeness
    FOR EACH ROW
    WHEN NEW.series_identity_key IS NULL OR TRIM(NEW.series_identity_key) = ''
    BEGIN
      SELECT RAISE(ABORT, 'series_identity_key is required');
    END
  `)
}
