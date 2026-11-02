import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { TimelineCacheService } from '@main/services/timelines/TimelineCacheService'
import { getLoggingService } from '@main/services/LoggingService'
import { cleanupTestDb, setupTestDb } from '@tests/TestUtils'

const envelope = (data: unknown) => ({
  data,
  timestamp: Date.now(),
  expiresAt: Date.now() + 60_000,
})

const validRecipe = {
  id: 'valid-v2',
  franchise: 'Example',
  name: 'Valid timeline',
  description: 'Episode-level order',
  version: 2,
  items: [{
    order: 1,
    type: 'episode',
    title: 'Pilot',
    seriesTitle: 'Example Series',
    seasonNumber: 1,
    episodeNumber: 1,
    identifiers: { tmdbId: 101 },
  }],
}

describe('TimelineCacheService schema boundary', () => {
  let db: Awaited<ReturnType<typeof setupTestDb>>

  beforeEach(async () => {
    db = await setupTestDb()
    getLoggingService().clearLogs()
  })

  afterEach(() => cleanupTestDb())

  it('serves a supported recipe only after validating its complete schema', async () => {
    await db.config.setSetting('timeline_recipe:valid-v2', JSON.stringify(envelope(validRecipe)))

    const cached = await new TimelineCacheService().getRecipe('valid-v2')

    expect(cached).toEqual(validRecipe)
  })

  it('accepts a version-two special episode in season zero', async () => {
    const specialRecipe = {
      ...validRecipe,
      id: 'special-v2',
      items: [{ ...validRecipe.items[0], seasonNumber: 0 }],
    }
    await db.config.setSetting('timeline_recipe:special-v2', JSON.stringify(envelope(specialRecipe)))

    const cached = await new TimelineCacheService().getRecipe('special-v2')

    expect(cached).toEqual(specialRecipe)
  })

  it('rejects an unsupported recipe version before serving it', async () => {
    await db.config.setSetting('timeline_recipe:future', JSON.stringify(envelope({ ...validRecipe, id: 'future', version: 99 })))

    const cached = await new TimelineCacheService().getRecipe('future')

    expect(cached).toBeNull()
    expect(getLoggingService().getLogs().some(log =>
      log.level === 'warn' && log.message.includes("timeline recipe 'future'") && log.message.includes('unsupported version')
    )).toBe(true)
  })

  it('rejects a version-two recipe that still contains show-level items', async () => {
    const showLevelRecipe = {
      ...validRecipe,
      id: 'show-level-v2',
      items: [{ order: 1, type: 'show', title: 'Example Series', identifiers: { tmdbId: 101 } }],
    }
    await db.config.setSetting('timeline_recipe:show-level-v2', JSON.stringify(envelope(showLevelRecipe)))

    const cached = await new TimelineCacheService().getRecipe('show-level-v2')

    expect(cached).toBeNull()
    expect(getLoggingService().getLogs().some(log =>
      log.level === 'warn' && log.message.includes("timeline recipe 'show-level-v2'") && log.message.includes('episode-interleaved')
    )).toBe(true)
  })

  it('rejects a recipe inside a malformed cache envelope', async () => {
    await db.config.setSetting('timeline_recipe:malformed-envelope', JSON.stringify({
      data: { ...validRecipe, id: 'malformed-envelope' },
      expiresAt: Date.now() + 60_000,
    }))

    const cached = await new TimelineCacheService().getRecipe('malformed-envelope')

    expect(cached).toBeNull()
    expect(getLoggingService().getLogs().some(log =>
      log.level === 'warn' && log.message.includes("timeline recipe 'malformed-envelope'") && log.message.includes('cache envelope')
    )).toBe(true)
  })
})
