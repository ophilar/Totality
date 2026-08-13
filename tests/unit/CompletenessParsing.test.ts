import { describe, expect, it } from 'vitest'
import { parseMissingEpisodes, parseMissingSeasons } from '@/components/library/tv/completenessParsing'

describe('TV completeness metadata parsing', () => {
  it('accepts validated season and episode records', () => {
    expect(parseMissingSeasons('[0, 2]').value).toEqual([0, 2])
    expect(parseMissingEpisodes('[{"season_number": 1, "episode_number": 3, "title": "Pilot"}]').value).toEqual([
      { season_number: 1, episode_number: 3, title: 'Pilot' },
    ])
  })

  it('returns an explicit diagnostic for malformed persisted metadata', () => {
    expect(parseMissingSeasons('{bad').diagnostic?.field).toBe('missing_seasons')
    expect(parseMissingEpisodes('[{"season_number":"1","episode_number":2}]').diagnostic?.field).toBe('missing_episodes')
  })
})
