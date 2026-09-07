import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runMigrations } from '@main/database/DatabaseMigration'
import { getLoggingService } from '@main/services/LoggingService'
import { cleanupTestDb, setupTestDb } from '@tests/TestUtils'

const recipe = {
  id: 'example',
  franchise: 'Example',
  name: 'Example timeline',
  description: 'A test timeline',
  version: 2,
  items: [{ order: 1, type: 'movie', title: 'Example', identifiers: {} }]
}

const envelope = (data: unknown) => ({ data, timestamp: 100, expiresAt: 200 })

describe('timeline cache migration', () => {
  let dbService: Awaited<ReturnType<typeof setupTestDb>>

  beforeEach(async () => {
    dbService = await setupTestDb()
    getLoggingService().clearLogs()
  })

  afterEach(() => cleanupTestDb())

  it('retains current recipe and manifest records unchanged', async () => {
    const manifest = [{ id: 'example', name: 'Example', franchise: 'Example', description: 'A test timeline', totalItems: 1, sourceType: 'preset' }]
    await dbService.config.setSetting('timeline_recipe:current', JSON.stringify(envelope(recipe)))
    await dbService.config.setSetting('timeline_manifest:current', JSON.stringify(envelope(manifest)))

    await runMigrations(dbService.db)

    expect(await dbService.config.getSetting('timeline_recipe:current')).toBe(JSON.stringify(envelope(recipe)))
    expect(await dbService.config.getSetting('timeline_manifest:current')).toBe(JSON.stringify(envelope(manifest)))
  })

  it('retains and warns for a version-one recipe whose v2 interleaving cannot be proven lossless', async () => {
    const legacy = {
      ...recipe,
      version: 1,
      items: [
        { order: 1, type: 'episode', title: 'Series A S01E01', seriesTitle: 'Series A', seasonNumber: 1, episodeNumber: 1, identifiers: { tmdbId: 1 } },
        { order: 2, type: 'episode', title: 'Series B S01E01', seriesTitle: 'Series B', seasonNumber: 1, episodeNumber: 1, identifiers: { tmdbId: 2 } },
        { order: 3, type: 'episode', title: 'Series A S01E02', seriesTitle: 'Series A', seasonNumber: 1, episodeNumber: 2, identifiers: { tmdbId: 1 } },
      ],
    }
    await dbService.config.setSetting('timeline_recipe:legacy', JSON.stringify(envelope(legacy)))

    await runMigrations(dbService.db)

    expect(await dbService.config.getSetting('timeline_recipe:legacy')).toBe(JSON.stringify(envelope(legacy)))
    expect(getLoggingService().getLogs().some(log =>
      log.level === 'warn' &&
      log.message.includes('timeline_recipe:legacy') &&
      log.message.includes('cannot losslessly infer')
    )).toBe(true)
  })

  it('retains malformed records and logs the key and reason', async () => {
    await dbService.config.setSetting('timeline_recipe:malformed', '{not-json')

    await runMigrations(dbService.db)

    expect(await dbService.config.getSetting('timeline_recipe:malformed')).toBe('{not-json')
    expect(getLoggingService().getLogs().some(log => log.level === 'warn' && log.message.includes('timeline_recipe:malformed') && log.message.includes('malformed'))).toBe(true)
  })

  it('retains unsupported records and logs an explicit warning', async () => {
    const unsupported = envelope({ ...recipe, version: 99 })
    await dbService.config.setSetting('timeline_recipe:unsupported', JSON.stringify(unsupported))

    await runMigrations(dbService.db)

    expect(await dbService.config.getSetting('timeline_recipe:unsupported')).toBe(JSON.stringify(unsupported))
    expect(getLoggingService().getLogs().some(log => log.level === 'warn' && log.message.includes('timeline_recipe:unsupported') && log.message.includes('unsupported recipe version'))).toBe(true)
  })

  it('retains a recipe with no explicit version', async () => {
    const unversioned = envelope({ ...recipe, version: undefined })
    await dbService.config.setSetting('timeline_recipe:unversioned', JSON.stringify(unversioned))

    await runMigrations(dbService.db)

    expect(await dbService.config.getSetting('timeline_recipe:unversioned')).toBe(JSON.stringify(unversioned))
    expect(getLoggingService().getLogs().some(log => log.level === 'warn' && log.message.includes('timeline_recipe:unversioned') && log.message.includes('unsupported recipe version'))).toBe(true)
  })

  it('does not guess an album relationship from ambiguous denormalized names', async () => {
    const firstArtistId = await dbService.music.upsertArtist({
      source_id: 'music-source',
      source_type: 'local',
      library_id: 'library-a',
      provider_id: 'artist-a',
      name: 'Shared Artist',
    })
    const secondArtistId = await dbService.music.upsertArtist({
      source_id: 'music-source',
      source_type: 'local',
      library_id: 'library-b',
      provider_id: 'artist-b',
      name: 'Shared Artist',
    })
    await dbService.music.upsertAlbum({
      source_id: 'music-source',
      source_type: 'local',
      library_id: 'library-a',
      provider_id: 'album-a',
      artist_id: firstArtistId,
      artist_name: 'Shared Artist',
      title: 'Shared Album',
    })
    await dbService.music.upsertAlbum({
      source_id: 'music-source',
      source_type: 'local',
      library_id: 'library-b',
      provider_id: 'album-b',
      artist_id: secondArtistId,
      artist_name: 'Shared Artist',
      title: 'Shared Album',
    })
    await dbService.music.upsertTrack({
      source_id: 'music-source',
      source_type: 'local',
      library_id: 'library-b',
      provider_id: 'unlinked-track',
      artist_name: 'Shared Artist',
      album_name: 'Shared Album',
      title: 'Track',
      file_path: '/music/shared/track.flac',
      audio_codec: 'flac',
    })

    await runMigrations(dbService.db)

    const result = await dbService.db.execute("SELECT album_id FROM music_tracks WHERE provider_id = 'unlinked-track'")
    expect(result.rows[0]?.album_id).toBeNull()
  })

  it('successfully executes migrations and table rebuilds with quoted identifiers', async () => {
    await runMigrations(dbService.db)
    const tableInfo = await dbService.db.execute('PRAGMA table_info(quality_scores)')
    expect(tableInfo.rows.length).toBeGreaterThan(0)
  })
})
