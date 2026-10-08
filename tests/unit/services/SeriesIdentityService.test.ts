import { describe, it, expect } from 'vitest'
import {
  deriveSeriesIdentityKey,
  normalizeSeriesPathOrTitle,
  getMediaMatchStatus,
} from '@main/services/SeriesIdentityService'

describe('SeriesIdentityService', () => {
  describe('deriveSeriesIdentityKey', () => {
    it('uses TMDB ID when present', () => {
      const key = deriveSeriesIdentityKey({
        sourceId: 'src-1',
        libraryId: 'lib-1',
        folderRelativePath: 'Breaking Bad',
        tmdbId: '1396',
      })
      expect(key).toBe('tmdb:1396')
    })

    it('uses TVDB ID when TMDB ID is absent', () => {
      const key = deriveSeriesIdentityKey({
        sourceId: 'src-1',
        libraryId: 'lib-1',
        folderRelativePath: 'The Wire',
        tvdbId: '79126',
      })
      expect(key).toBe('tvdb:79126')
    })

    it('creates an unresolved key when neither TMDB nor TVDB ID is available', () => {
      const key = deriveSeriesIdentityKey({
        sourceId: 'src-local',
        libraryId: 'tv-shows',
        folderRelativePath: 'Doctor Who (2005)',
      })
      expect(key).toBe('unresolved:src-local:tv-shows:doctor-who')
    })

    it('distinguishes two shows with identical titles across different sources', () => {
      const key1 = deriveSeriesIdentityKey({
        sourceId: 'source-a',
        libraryId: 'lib-1',
        folderRelativePath: 'The Office',
      })
      const key2 = deriveSeriesIdentityKey({
        sourceId: 'source-b',
        libraryId: 'lib-1',
        folderRelativePath: 'The Office',
      })
      expect(key1).not.toBe(key2)
      expect(key1).toBe('unresolved:source-a:lib-1:the-office')
      expect(key2).toBe('unresolved:source-b:lib-1:the-office')
    })

    it('does not guess IDs for ambiguous records', () => {
      const key = deriveSeriesIdentityKey({
        sourceId: 'src-x',
        libraryId: 'lib-y',
        folderRelativePath: '',
      })
      expect(key).toBe('unresolved:src-x:lib-y:unknown')
    })
  })

  describe('normalizeSeriesPathOrTitle', () => {
    it('extracts and cleans titles from paths with years', () => {
      expect(normalizeSeriesPathOrTitle('/media/TV/Better Call Saul (2015)/Season 01/')).toBe('better call saul')
    })

    it('cleans titles directly', () => {
      expect(normalizeSeriesPathOrTitle('Severance.S01E01.1080p')).toBe('severance')
    })
  })

  describe('getMediaMatchStatus', () => {
    it('returns manual when match is locked', () => {
      expect(getMediaMatchStatus({ locked: true, canonicalIds: ['tmdb:100'], conflictingEntityIds: [] })).toBe('manual')
    })

    it('returns conflicting when conflicting entity IDs exist', () => {
      expect(getMediaMatchStatus({ locked: false, canonicalIds: ['tmdb:100'], conflictingEntityIds: [2] })).toBe('conflicting')
    })

    it('returns verified when canonical IDs exist without conflict', () => {
      expect(getMediaMatchStatus({ locked: false, canonicalIds: ['tmdb:100'], conflictingEntityIds: [] })).toBe('verified')
    })

    it('returns unresolved when no canonical IDs exist', () => {
      expect(getMediaMatchStatus({ locked: false, canonicalIds: [], conflictingEntityIds: [] })).toBe('unresolved')
    })
  })
})
