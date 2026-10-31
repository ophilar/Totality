export const OPTIMIZATION_STAGES = ['Settings', 'Review', 'Results'] as const

export type OptimizationDialogStage = typeof OPTIMIZATION_STAGES[number]

export function optimizationDialogStage(reviewActive: boolean, resultsActive: boolean): OptimizationDialogStage {
  if (resultsActive) return 'Results'
  if (reviewActive) return 'Review'
  return 'Settings'
}

export function availableOptimizationDialogStages(reviewAvailable: boolean, resultsAvailable: boolean): OptimizationDialogStage[] {
  return ['Settings', ...(reviewAvailable ? ['Review' as const] : []), ...(resultsAvailable ? ['Results' as const] : [])]
}
