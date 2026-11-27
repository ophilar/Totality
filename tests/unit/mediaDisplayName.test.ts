import { describe, expect, it } from 'vitest'
import { formatMediaDisplayName } from '@shared/mediaDisplayName'

describe('formatMediaDisplayName', () => {
  it('formats episodes with series, coordinates, and title', () => {
    expect(formatMediaDisplayName({ type: 'episode', series_title: 'The Expanse', season_number: 2, episode_number: 3, title: 'Static' })).toBe('The Expanse: S02E03 Static')
  })

  it('omits an absent episode title', () => {
    expect(formatMediaDisplayName({ type: 'episode', series_title: 'The Expanse', season_number: 2, episode_number: 3 })).toBe('The Expanse: S02E03')
  })

  it('keeps movie titles unchanged', () => {
    expect(formatMediaDisplayName({ type: 'movie', title: 'Arrival' })).toBe('Arrival')
  })
})
