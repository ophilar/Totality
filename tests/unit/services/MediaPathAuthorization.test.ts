import { describe, expect, it } from 'vitest'
import { MediaPathAuthorization } from '@main/services/MediaPathAuthorization'

describe('MediaPathAuthorization', () => {
  it('accepts a file inside a registered root and rejects traversal outside it', () => {
    const authorization = new MediaPathAuthorization(['C:/library/movies'])
    expect(authorization.assertAuthorized('C:/library/movies/title/movie.mkv')).toBe(true)
    expect(() => authorization.assertAuthorized('C:/library/movies/../private/movie.mkv')).toThrow('outside registered library roots')
  })

  it('rejects an empty root set', () => {
    expect(() => new MediaPathAuthorization([]).assertAuthorized('C:/movie.mkv')).toThrow('No registered library roots')
  })
})
