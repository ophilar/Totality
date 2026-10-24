import type { OptimizationSavingsCoverage } from './OptimizationSavingsService'

export interface EpisodeOptimizationMetric {
  sizeBytes: number | null | undefined
  estimatedSavingsBytes?: number | null
  savingsCoverage?: OptimizationSavingsCoverage
}

export interface ShowOptimizationMetrics {
  totalSize: number | null
  totalEstimatedSavingsBytes: number | null
  coverage: OptimizationSavingsCoverage
}

export function aggregateShowOptimizationMetrics(episodes: EpisodeOptimizationMetric[]): ShowOptimizationMetrics {
  const totalSize = episodes.every(episode => episode.sizeBytes != null)
    ? episodes.reduce((total, episode) => total + Math.max(0, episode.sizeBytes!), 0)
    : null
  const evidencedEpisodes = episodes.filter(episode => episode.estimatedSavingsBytes != null)
  const totalEstimatedSavingsBytes = evidencedEpisodes.length === 0
    ? null
    : totalSize === null
      ? evidencedEpisodes.reduce((total, episode) => total + Math.max(0, episode.estimatedSavingsBytes!), 0)
      : Math.min(totalSize, evidencedEpisodes.reduce((total, episode) => total + Math.max(0, episode.estimatedSavingsBytes!), 0))
  const coverage = totalEstimatedSavingsBytes === null
    ? 'insufficient'
    : totalSize === null || evidencedEpisodes.length !== episodes.length || evidencedEpisodes.some(episode => episode.savingsCoverage !== 'complete')
      ? 'partial'
      : 'complete'

  return { totalSize, totalEstimatedSavingsBytes, coverage }
}
