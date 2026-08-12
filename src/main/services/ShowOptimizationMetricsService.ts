export interface EpisodeOptimizationMetric { sizeBytes: number | null | undefined; recoverableBytes: number | null | undefined; efficiency: number | null | undefined }
export interface ShowOptimizationMetrics { totalSize: number; totalRecoverableBytes: number; weightedEfficiency: number | null; scoredEpisodeCount: number; unscoredEpisodeCount: number }

export function aggregateShowOptimizationMetrics(episodes: EpisodeOptimizationMetric[]): ShowOptimizationMetrics {
  let totalSize = 0, scoredSize = 0, totalRecoverableBytes = 0, weightedNumerator = 0, scoredEpisodeCount = 0
  for (const episode of episodes) {
    const size = Math.max(0, episode.sizeBytes ?? 0)
    totalSize += size
    totalRecoverableBytes += Math.max(0, episode.recoverableBytes ?? 0)
    if (episode.efficiency != null && Number.isFinite(episode.efficiency)) { weightedNumerator += episode.efficiency * size; scoredSize += size; scoredEpisodeCount++ }
  }
  return { totalSize, totalRecoverableBytes, weightedEfficiency: scoredSize > 0 && scoredEpisodeCount > 0 ? weightedNumerator / scoredSize : null, scoredEpisodeCount, unscoredEpisodeCount: episodes.length - scoredEpisodeCount }
}
