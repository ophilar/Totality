const DECISION_LABELS: Readonly<Record<string, string>> = {
  already_optimized: 'Up to date',
  actionable: 'Ready',
  incompatible: 'Not compatible',
  insufficient_evidence: 'Needs analysis',
  sample_required: 'Review sample',
  measurement_failed: 'Analysis failed',
  no_positive_savings: 'No savings',
  no_savings: 'No savings',
  quality_threshold_unmet: 'Quality threshold not met',
}

export function optimizationDecisionLabel(status?: string): string {
  return status ? DECISION_LABELS[status] ?? 'Needs review' : 'Decision unavailable'
}

const COVERAGE_LABELS: Readonly<Record<string, string>> = {
  complete: 'Complete',
  partial: 'Partial',
  insufficient: 'Limited',
}

export function optimizationCoverageLabel(coverage?: string | null): string {
  return coverage ? COVERAGE_LABELS[coverage] ?? 'Unavailable' : 'Unavailable'
}
