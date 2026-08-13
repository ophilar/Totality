import { describe, expect, it } from 'vitest'
import { calculatePosterWidth } from '@/components/library/mediaUtils'

describe('poster sizing', () => {
  it('maps every grid scale to a bounded shared poster width', () => {
    expect([1, 2, 3, 4, 5, 6, 7].map(calculatePosterWidth)).toEqual([96, 112, 128, 144, 160, 176, 192])
  })

  it('clamps invalid grid scales to the supported range', () => {
    expect(calculatePosterWidth(0)).toBe(96)
    expect(calculatePosterWidth(99)).toBe(192)
  })
})
