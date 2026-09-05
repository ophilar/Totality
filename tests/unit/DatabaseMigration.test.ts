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

  it('safely handles incremental column migration without SQL injection', async () => {
    await runMigrations(dbService.db)

    const columnsBefore = await dbService.db.execute('PRAGMA table_info(media_items)')
    const colCountBefore = columnsBefore.rows.length

    await runMigrations(dbService.db)

    const columnsAfter = await dbService.db.execute('PRAGMA table_info(media_items)')
    expect(columnsAfter.rows.length).toBe(colCountBefore)
    expect(columnsAfter.rows.some(r => r.name === 'deep_analysis_at')).toBe(true)
  })
})
