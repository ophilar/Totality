import { describe, expect, it } from 'vitest'
import { describeOptimizationScope, optimizationScopeForMedia, optimizationScopeForSeries, type OptimizationScope } from '../../src/renderer/src/components/library/transcoding/OptimizationScope'

describe('describeOptimizationScope', () => {
  it.each([
    [{ kind: 'movie', mediaId: 4 }, 'movie:4'],
    [{ kind: 'episode', showId: 'plex:12', mediaId: 4, seasonNumber: 1, episodeNumber: 2 }, 'episode:plex:12:4:1:2'],
    [{ kind: 'season', showId: 'plex:12', seasonNumber: 1 }, 'season:plex:12:1'],
    [{ kind: 'show', showId: 'plex:12' }, 'show:plex:12'],
  ] satisfies Array<[OptimizationScope, string]>)('maps %o to its stable key', (scope, expected) => {
    expect(describeOptimizationScope(scope)).toBe(expected)
  })
})

describe('optimization scope mapping', () => {
  it('preserves movie and episode identifiers', () => {
    expect(optimizationScopeForMedia({ id: 9, type: 'movie' })).toEqual({ kind: 'movie', mediaId: 9 })
    expect(optimizationScopeForMedia({ id: 12, type: 'episode', series_identity_key: 'plex:show:3', season_number: 2, episode_number: 4 })).toEqual({ kind: 'episode', showId: 'plex:show:3', mediaId: 12, seasonNumber: 2, episodeNumber: 4 })
  })

  it('preserves season and show scope identities', () => {
    const show = { series_title: 'Example', series_identity_key: 'plex:show:3' }
    expect(optimizationScopeForSeries(show, undefined, 2)).toEqual({ kind: 'season', showId: 'plex:show:3', seasonNumber: 2 })
    expect(optimizationScopeForSeries(show)).toEqual({ kind: 'show', showId: 'plex:show:3' })
    expect(() => optimizationScopeForMedia({ id: 12, type: 'episode' })).toThrow(/stable series identity/)
  })

  it('keeps an episode scope when episode numbering is unavailable', () => {
    expect(optimizationScopeForSeries({ series_title: 'Example', series_identity_key: 'plex:show:3' }, { id: 12 }))
      .toEqual({ kind: 'episode', showId: 'plex:show:3', mediaId: 12 })
  })

  it('rejects unsupported media types instead of treating them as movies', () => {
    expect(() => optimizationScopeForMedia({ id: 12, type: 'music' })).toThrow(/Unsupported optimization media type/)
  })
})
