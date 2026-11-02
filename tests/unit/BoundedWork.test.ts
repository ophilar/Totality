import { describe, expect, it } from 'vitest'
import { mapBounded } from '@main/services/utils/mapBounded'

describe('mapBounded', () => {
  it('limits concurrent work while preserving input order', async () => {
    let active = 0
    let peak = 0

    const result = await mapBounded([1, 2, 3, 4, 5], 2, async (value) => {
      active++
      peak = Math.max(peak, active)
      await new Promise(resolve => setTimeout(resolve, 1))
      active--
      return value * 2
    })

    expect(result).toEqual([2, 4, 6, 8, 10])
    expect(peak).toBeLessThanOrEqual(2)
  })
})
