import { LanguageDecisionService } from './LanguageDecisionService'

export interface TrackStreamInfo {
  index?: number
  codec?: string
  codec_name?: string
  language?: string | null
  languageTag?: string | null
  title?: string | null
  channels?: number | null
  bit_rate?: string | number | null
  bitrate?: number | null
  isCommentary?: boolean
  isAudioDescription?: boolean
  isAccessibility?: boolean
  reliableTag?: boolean
  disposition?: {
    default?: number
    forced?: number
    comment?: number
    visual_impaired?: number
    hearing_impaired?: number
    [key: string]: unknown
  }
  tags?: {
    language?: string
    title?: string
    BPS?: string
    'BPS-eng'?: string
    NUMBER_OF_BYTES?: string | number
    'NUMBER_OF_BYTES-eng'?: string | number
    [key: string]: unknown
  } | null
}

export interface TrackContainerContext {
  totalBitrate?: number | null
  totalStreams?: number | null
  fileSize?: number | null
}

export interface TrackDecision {
  index: number
  streamIndex: number
  codec: string
  language?: string | null
  languageTag?: string | null
  channels: number
  estimatedBytes: number
  bytes: number
  decision: 'retain' | 'remove' | 'review-required'
  action: 'retain' | 'remove' | 'review-required'
  rationale: string
  reason: string
}

export interface EpisodeOptimizationMetric {
  sizeBytes: number | null | undefined
  recoverableBytes?: number | null | undefined
  efficiency?: number | null | undefined
  audioStreams?: TrackStreamInfo[]
  durationSeconds?: number | null
}

export interface ShowOptimizationMetrics {
  totalSize: number
  totalRecoverableBytes: number
  weightedEfficiency: number | null
  scoredEpisodeCount: number
  unscoredEpisodeCount: number
}

export interface ShowDryRunResult {
  totalBytes: number
  recoverableBytes: number
  percentageSavings: number
  totalEpisodes: number
  scoredEpisodes: number
  unscoredEpisodes: number
  weightedEfficiency: number | null
  trackDecisions: TrackDecision[]
  videoDebtBytes?: number
  audioTranscodeSavingsBytes?: number
  totalCombinedSavingsBytes?: number
}

/**
 * Calculate audio track byte size using real stream properties:
 * 1. If stream.tags?.NUMBER_OF_BYTES is present and non-zero, parse integer value.
 * 2. Else if stream.bit_rate and duration (in seconds) are available: Math.round((parseInt(stream.bit_rate, 10) * duration) / 8).
 * 3. Else if container total bitrate and audio channels are known: calculate proportional audio slice based on audio channels vs total container streams.
 */
export function calculateTrackByteSize(
  stream: TrackStreamInfo,
  durationSeconds?: number | null,
  containerContext?: TrackContainerContext | null
): number {
  // 1. Tag-based byte size
  const tags = stream.tags
  if (tags) {
    const rawTagBytes = tags.NUMBER_OF_BYTES ?? tags['NUMBER_OF_BYTES-eng'] ?? tags['number_of_bytes']
    if (rawTagBytes != null) {
      const parsed = typeof rawTagBytes === 'number' ? rawTagBytes : parseInt(String(rawTagBytes), 10)
      if (Number.isFinite(parsed) && parsed > 0) {
        return parsed
      }
    }
  }

  // 2. Bitrate * duration / 8
  const rawBitrate = stream.bit_rate ?? stream.bitrate
  const duration = durationSeconds != null && durationSeconds > 0 ? durationSeconds : null
  if (rawBitrate != null && duration != null) {
    const parsedBitrate = typeof rawBitrate === 'number' ? rawBitrate : parseInt(String(rawBitrate), 10)
    if (Number.isFinite(parsedBitrate) && parsedBitrate > 0) {
      return Math.round((parsedBitrate * duration) / 8)
    }
  }

  // 3. Container total bitrate and audio channels proportional slice
  if (containerContext?.totalBitrate != null && duration != null && stream.channels != null && stream.channels > 0) {
    const totalStreams = containerContext.totalStreams && containerContext.totalStreams > 0 ? containerContext.totalStreams : 1
    return Math.round(((containerContext.totalBitrate * duration) / 8) * (stream.channels / totalStreams))
  }

  if (containerContext?.fileSize != null && stream.channels != null && stream.channels > 0) {
    const totalStreams = containerContext.totalStreams && containerContext.totalStreams > 0 ? containerContext.totalStreams : 1
    return Math.round(containerContext.fileSize * (stream.channels / totalStreams) * 0.15)
  }

  return 0
}

export function aggregateShowOptimizationMetrics(episodes: EpisodeOptimizationMetric[]): ShowOptimizationMetrics {
  let totalSize = 0, scoredSize = 0, totalRecoverableBytes = 0, weightedNumerator = 0, scoredEpisodeCount = 0, totalEfficiency = 0
  for (const episode of episodes) {
    const size = Math.max(0, episode.sizeBytes ?? 0)
    totalSize += size
    totalRecoverableBytes += Math.max(0, episode.recoverableBytes ?? 0)
    if (episode.efficiency != null && Number.isFinite(episode.efficiency)) {
      weightedNumerator += episode.efficiency * size
      totalEfficiency += episode.efficiency
      scoredSize += size
      scoredEpisodeCount++
    }
  }
  const weightedEfficiency = scoredEpisodeCount > 0
    ? (scoredSize > 0 ? weightedNumerator / scoredSize : totalEfficiency / scoredEpisodeCount)
    : null
  return { totalSize, totalRecoverableBytes, weightedEfficiency, scoredEpisodeCount, unscoredEpisodeCount: episodes.length - scoredEpisodeCount }
}

export function calculateDryRunMetrics(
  episodes: EpisodeOptimizationMetric[],
  originalLanguage?: string | null
): ShowDryRunResult {
  const languageService = new LanguageDecisionService()
  let totalBytes = 0
  let totalRecoverableBytes = 0
  let videoDebtBytes = 0
  let scoredSize = 0
  let weightedNumerator = 0
  let totalEfficiency = 0
  let scoredEpisodeCount = 0
  const trackDecisions: TrackDecision[] = []

  for (const episode of episodes) {
    const size = Math.max(0, episode.sizeBytes ?? 0)
    totalBytes += size

    if (episode.recoverableBytes != null && Number.isFinite(episode.recoverableBytes)) {
      videoDebtBytes += Math.max(0, episode.recoverableBytes)
    }

    const hasAudioStreams = Boolean(episode.audioStreams && episode.audioStreams.length > 0)
    let episodeRecoverable = 0

    if (hasAudioStreams && episode.audioStreams) {
      scoredEpisodeCount++
      if (episode.efficiency != null && Number.isFinite(episode.efficiency)) {
        weightedNumerator += episode.efficiency * size
        totalEfficiency += episode.efficiency
        scoredSize += size
      }

      for (const stream of episode.audioStreams) {
        const streamIndex = stream.index ?? 0
        const codec = stream.codec ?? stream.codec_name ?? 'unknown'
        const language = stream.language ?? stream.tags?.language ?? null
        const channels = stream.channels ?? 2
        const estimatedBytes = calculateTrackByteSize(stream, episode.durationSeconds)

        const decision = languageService.decideAudioStream(stream, originalLanguage)
        if (decision.action === 'remove') {
          episodeRecoverable += estimatedBytes
        }

        trackDecisions.push({
          index: streamIndex,
          streamIndex,
          codec,
          language,
          languageTag: language,
          channels,
          estimatedBytes,
          bytes: estimatedBytes,
          decision: decision.decision,
          action: decision.action,
          rationale: decision.rationale,
          reason: decision.reason,
        })
      }
      totalRecoverableBytes += episodeRecoverable
    } else {
      if (episode.efficiency != null && Number.isFinite(episode.efficiency)) {
        scoredEpisodeCount++
        weightedNumerator += episode.efficiency * size
        totalEfficiency += episode.efficiency
        scoredSize += size
      }
    }
  }

  const unscoredEpisodeCount = episodes.length - scoredEpisodeCount
  const weightedEfficiency = scoredEpisodeCount > 0
    ? (scoredSize > 0 ? weightedNumerator / scoredSize : totalEfficiency / scoredEpisodeCount)
    : null
  const percentageSavings = totalBytes > 0 ? (totalRecoverableBytes / totalBytes) * 100 : 0
  const totalCombinedSavingsBytes = totalRecoverableBytes + videoDebtBytes

  return {
    totalBytes,
    recoverableBytes: totalRecoverableBytes,
    percentageSavings,
    totalEpisodes: episodes.length,
    scoredEpisodes: scoredEpisodeCount,
    unscoredEpisodes: unscoredEpisodeCount,
    weightedEfficiency,
    trackDecisions,
    videoDebtBytes,
    totalCombinedSavingsBytes,
  }
}
