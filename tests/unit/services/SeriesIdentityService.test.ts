import { describe, expect, it } from 'vitest'
import { deriveSeriesIdentityKey, getMediaMatchStatus } from '@main/services/SeriesIdentityService'

describe('SeriesIdentityService', () => {
  it('uses canonical provider identity before folder identity', () => {
    expect(deriveSeriesIdentityKey({ sourceId: 'plex', libraryId: 'tv', folderRelativePath: 'Shows/Office', tmdbId: '2316' })).toBe('tmdb:2316')
    expect(deriveSeriesIdentityKey({ sourceId: 'plex', libraryId: 'tv', folderRelativePath: 'Shows/Office', tvdbId: '81189' })).toBe('tvdb:81189')
  })

  it('keeps unmatched folders distinct', () => {
    expect(deriveSeriesIdentityKey({ sourceId: 'plex', libraryId: 'tv', folderRelativePath: 'Shows/Office' })).toBe('unresolved:plex:tv:Shows/Office')
  })

  it('applies match status precedence', () => {
    expect(getMediaMatchStatus({ locked: true, canonicalIds: ['tmdb:1'], conflictingEntityIds: [] })).toBe('manual')
    expect(getMediaMatchStatus({ locked: false, canonicalIds: ['tmdb:1'], conflictingEntityIds: [2] })).toBe('conflicting')
    expect(getMediaMatchStatus({ locked: false, canonicalIds: ['tmdb:1'], conflictingEntityIds: [] })).toBe('verified')
    expect(getMediaMatchStatus({ locked: false, canonicalIds: [], conflictingEntityIds: [] })).toBe('unresolved')
  })
})
