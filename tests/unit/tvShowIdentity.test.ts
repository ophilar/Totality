import { describe, expect, it } from 'vitest'
import { getTVShowIdentity, getTVShowIdentityKey } from '@/components/library/tv/showIdentity'

describe('TV show identity', () => {
  it('keeps same-title resolved series distinct', () => {
    expect(getTVShowIdentityKey({ series_identity_key: 'tmdb:101', source_id: 's1', library_id: 'tv' }))
      .not.toBe(getTVShowIdentityKey({ series_identity_key: 'tmdb:202', source_id: 's1', library_id: 'tv' }))
  })

  it('keeps unresolved identities scoped by source and library', () => {
    expect(getTVShowIdentityKey({ series_identity_key: 'unresolved:s1:tv-a:legacy', source_id: 's1', library_id: 'tv-a' }))
      .not.toBe(getTVShowIdentityKey({ series_identity_key: 'unresolved:s1:tv-b:legacy', source_id: 's1', library_id: 'tv-b' }))
  })

  it('returns the canonical scoped identity components and renderer key', () => {
    expect(getTVShowIdentity({ series_identity_key: 'tmdb:101', source_id: 's1', library_id: 'tv' })).toEqual({
      seriesIdentityKey: 'tmdb:101',
      sourceId: 's1',
      libraryId: 'tv',
      key: 'tmdb:101\u001fs1\u001ftv',
    })
  })

  it('rejects incomplete scoped identity', () => {
    expect(() => getTVShowIdentity({ source_id: 's1', library_id: 'tv' })).toThrow('TV series identity is missing')
    expect(() => getTVShowIdentity({ series_identity_key: 'tmdb:101', library_id: 'tv' })).toThrow('TV series source is missing')
    expect(() => getTVShowIdentity({ series_identity_key: 'tmdb:101', source_id: 's1' })).toThrow('TV series library is missing')
  })
})
