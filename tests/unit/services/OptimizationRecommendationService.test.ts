import { describe, expect, it } from 'vitest'
import { recommendOptimization } from '@main/services/OptimizationRecommendationService'

describe('recommendOptimization', () => {
  it('never remuxes an Arr-managed item while awaiting rescan', () => {
    const result = recommendOptimization({ arrManaged: true, arrCanPursueUpgrade: true, pendingArrSearch: true, estimatedRecoverableBytes: 100, optIn: true })
    expect(result.action).toBe('awaiting-rescan')
    expect(result.localRemuxEligible).toBe(false)
  })
})
