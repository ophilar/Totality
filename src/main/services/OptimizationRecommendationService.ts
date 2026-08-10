import type { LanguageDecision } from './LanguageDecisionService'

export type OptimizationAction = 'arr-search-requested' | 'awaiting-rescan' | 'local-remux-eligible' | 'review-required' | 'no-optimization'
export interface OptimizationRecommendation {
  action: OptimizationAction
  arrEligible: boolean
  arrResultState: 'not-managed' | 'eligible' | 'requested' | 'awaiting-rescan' | 'blocked'
  localRemuxEligible: boolean
  estimatedRecoverableBytes: number
  blockingReason?: string
}

export function recommendOptimization(input: { languageDecision?: LanguageDecision; estimatedRecoverableBytes: number; arrManaged: boolean; arrCanPursueUpgrade: boolean; pendingArrSearch: boolean; optIn: boolean }): OptimizationRecommendation {
  const bytes = Math.max(0, input.estimatedRecoverableBytes)
  if (input.arrManaged && input.pendingArrSearch) return { action: 'awaiting-rescan', arrEligible: false, arrResultState: 'awaiting-rescan', localRemuxEligible: false, estimatedRecoverableBytes: bytes, blockingReason: 'Arr search already requested; wait for the next Totality scan' }
  if (input.arrManaged && input.arrCanPursueUpgrade) return { action: input.optIn ? 'arr-search-requested' : 'no-optimization', arrEligible: true, arrResultState: input.optIn ? 'requested' : 'eligible', localRemuxEligible: false, estimatedRecoverableBytes: bytes, blockingReason: input.optIn ? 'Arr search requested; local source remains untouched until rescan' : 'Opt-in required to request Arr search' }
  if (input.languageDecision?.status === 'review-required') return { action: 'review-required', arrEligible: false, arrResultState: input.arrManaged ? 'blocked' : 'not-managed', localRemuxEligible: false, estimatedRecoverableBytes: bytes, blockingReason: input.languageDecision.reason }
  if (bytes > 0) return { action: 'local-remux-eligible', arrEligible: false, arrResultState: input.arrManaged ? 'blocked' : 'not-managed', localRemuxEligible: true, estimatedRecoverableBytes: bytes, blockingReason: input.optIn ? undefined : 'Opt-in required before local remux' }
  return { action: 'no-optimization', arrEligible: false, arrResultState: input.arrManaged ? 'blocked' : 'not-managed', localRemuxEligible: false, estimatedRecoverableBytes: 0 }
}
