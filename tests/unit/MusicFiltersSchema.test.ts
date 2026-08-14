import { describe, expect, it } from 'vitest'
import { MusicFiltersSchema } from '@main/validation/schemas'

describe('MusicFiltersSchema', () => {
  it.each(['album_count', 'track_count', 'size'] as const)(
    'accepts the artist sort key %s emitted by the library browser',
    (sortBy) => {
      expect(MusicFiltersSchema.safeParse({ sortBy }).success).toBe(true)
    }
  )
})
