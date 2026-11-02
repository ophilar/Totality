import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { IdentityRepository } from '@main/database/repositories/IdentityRepository'
import { setupTestDb, cleanupTestDb } from '@tests/TestUtils'

describe('IdentityRepository (Real DB)', () => {
  let repo: IdentityRepository

  beforeEach(async () => {
    const db = await setupTestDb()
    repo = db.identities
  })

  afterEach(() => cleanupTestDb())

  it('stores and retrieves multiple provider identities and aliases for a locked entity', async () => {
    await repo.upsertIdentity({ entityType: 'artist', entityId: 7, provider: 'musicbrainz', externalId: 'artist-7', locked: true })
    await repo.upsertIdentity({ entityType: 'artist', entityId: 7, provider: 'anilist', externalId: 'alias-7' })
    await repo.addAlias({ entityType: 'artist', entityId: 7, alias: 'The Example Band', provider: 'musicbrainz' })

    expect(await repo.getIdentities('artist', 7)).toEqual(expect.arrayContaining([
      expect.objectContaining({ provider: 'musicbrainz', externalId: 'artist-7', locked: true }),
      expect.objectContaining({ provider: 'anilist', externalId: 'alias-7', locked: false })
    ]))
    expect(await repo.getAliases('artist', 7)).toEqual([expect.objectContaining({ alias: 'The Example Band' })])
    expect(await repo.isLocked('artist', 7)).toBe(true)
  })

  it('only returns conflicting entity IDs if the entity exists in active tables', async () => {
    await repo.upsertIdentity({ entityType: 'artist', entityId: 999, provider: 'musicbrainz', externalId: 'mb-dup-1' })
    const orphanedConflicts = await repo.getConflictingEntityIds('artist', 888, [{ provider: 'musicbrainz', externalId: 'mb-dup-1' }])
    expect(orphanedConflicts).toEqual([])
  })

  it('adds multiple aliases efficiently using batchAddAliases', async () => {
    const inputs = [
      { entityType: 'movie' as const, entityId: 42, alias: 'Alien 1', provider: 'tmdb' },
      { entityType: 'movie' as const, entityId: 42, alias: 'Alien 1 (Director Cut)', provider: 'tmdb' },
      { entityType: 'movie' as const, entityId: 42, alias: '   ', provider: 'tmdb' }, // Empty strings should be ignored
    ]
    await repo.batchAddAliases(inputs)

    const aliases = await repo.getAliases('movie', 42)
    expect(aliases).toHaveLength(2)
    expect(aliases).toEqual(expect.arrayContaining([
      expect.objectContaining({ alias: 'Alien 1' }),
      expect.objectContaining({ alias: 'Alien 1 (Director Cut)' })
    ]))
  })
})
