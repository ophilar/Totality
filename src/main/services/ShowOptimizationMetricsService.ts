
import { LanguageDecisionService } from './LanguageDecisionService'
import { buildOptimizationSavingsBreakdown, calculateBytesAtBitrateKbps, type OptimizationSavingsCoverage } from './OptimizationSavingsService'

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

export interface TrackDecision {
  index: number
  streamIndex: number
  codec: string
  language?: string | null
  languageTag?: string | null
  channels: number
  estimatedBytes: number | null
  bytes: number | null
  decision: 'retain' | 'remove' | 'review-required'
  action: 'retain' | 'remove' | 'review-required'
  rationale: string
  reason: string
}

export interface EpisodeOptimizationMetric {
  sizeBytes: number | null | undefined
  videoSavingsBytes?: number | null | undefined
  estimatedSavingsBytes?: number | null | undefined
  audioStreams?: TrackStreamInfo[]
  durationSeconds?: number | null
}

export interface ShowOptimizationMetrics {
  totalSize: number
  totalEstimatedSavingsBytes: number
}

export interface ShowDryRunResult {
  totalBytes: number
  audioPruningBytes: number
  totalEstimatedSavingsBytes: number
  percentageSavings: number
  coverage: OptimizationSavingsCoverage
  totalEpisodes: number
  trackDecisions: TrackDecision[]
  videoSavingsBytes: number
  audioTranscodeSavingsBytes?: number
}

/**
 * Calculate audio track byte size using real stream properties:
 * 1. If stream.tags?.NUMBER_OF_BYTES is present and non-zero, parse integer value.
 * 2. Else if stream.bit_rate and duration (in seconds) are available: Math.round((parseInt(stream.bit_rate, 10) * duration) / 8).
 * 3. Else if container total bitrate and audio channels are known: calculate proportional audio slice based on audio channels vs total container streams.
 */
export function calculateTrackByteSize(
  stream: TrackStreamInfo,
  durationSeconds?: number | null
): number | null {
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

  const rawBitrate = stream.bit_rate ?? stream.bitrate
  const duration = durationSeconds != null && durationSeconds > 0 ? durationSeconds : null
  if (rawBitrate != null && duration != null) {
    const parsedBitrate = typeof rawBitrate === 'number' ? rawBitrate : parseInt(String(rawBitrate), 10)
    if (Number.isFinite(parsedBitrate) && parsedBitrate > 0) {
      return calculateBytesAtBitrateKbps(parsedBitrate / 1000, duration)
    }
  }

  return null
}

export function aggregateShowOptimizationMetrics(episodes: EpisodeOptimizationMetric[]): ShowOptimizationMetrics {
  let totalSize = 0
  let totalEstimatedSavingsBytes = 0
  for (const episode of episodes) {
    const size = Math.max(0, episode.sizeBytes ?? 0)
    totalSize += size
    totalEstimatedSavingsBytes += Math.max(0, episode.estimatedSavingsBytes ?? 0)
  }
  return { totalSize, totalEstimatedSavingsBytes }
}

export function calculateDryRunMetrics(
  episodes: EpisodeOptimizationMetric[],
  originalLanguage?: string | null
): ShowDryRunResult {
  const languageService = new LanguageDecisionService()
  let totalBytes = 0
  let audioPruningBytes = 0
  let videoSavingsBytes = 0
  let hasVideoSavingsEvidence = false
  let hasAudioPruningEvidence = false
  let hasUnmeasuredAudioPruning = false
  const trackDecisions: TrackDecision[] = []

  for (const episode of episodes) {
    const size = Math.max(0, episode.sizeBytes ?? 0)
    totalBytes += size


    let episodeAudioPruningBytes = 0
    if (episode.audioStreams) {
      hasAudioPruningEvidence = true
      for (const stream of episode.audioStreams) {
        const streamIndex = stream.index ?? 0
        const codec = stream.codec ?? stream.codec_name ?? 'unknown'
        const language = stream.language ?? stream.tags?.language ?? null
        const channels = stream.channels ?? 2
        const estimatedBytes = calculateTrackByteSize(stream, episode.durationSeconds)

        const decision = languageService.decideAudioStream(stream, originalLanguage)
        if (decision.action === 'review-required') {
          hasUnmeasuredAudioPruning = true
        } else if (decision.action === 'remove' && estimatedBytes !== null) {
          episodeAudioPruningBytes += estimatedBytes
        } else if (decision.action === 'remove') {
          hasUnmeasuredAudioPruning = true
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
    }
    audioPruningBytes += episodeAudioPruningBytes

    if (episode.videoSavingsBytes != null && Number.isFinite(episode.videoSavingsBytes)) {
      hasVideoSavingsEvidence = true
      videoSavingsBytes += Math.max(0, episode.videoSavingsBytes)
    } else if (episode.estimatedSavingsBytes != null && Number.isFinite(episode.estimatedSavingsBytes)) {
      hasVideoSavingsEvidence = true
      videoSavingsBytes += Math.max(0, episode.estimatedSavingsBytes - episodeAudioPruningBytes)
    }
  }

  const savings = buildOptimizationSavingsBreakdown({
    totalBytes,
    videoSavingsBytes: hasVideoSavingsEvidence ? videoSavingsBytes : null,
    audioPruningBytes: hasAudioPruningEvidence && !hasUnmeasuredAudioPruning ? audioPruningBytes : null,
    audioTranscodeBytes: null,
  })

  return {
    totalBytes,
    audioPruningBytes,
    totalEstimatedSavingsBytes: savings.totalEstimatedSavingsBytes,
    percentageSavings: savings.percentageSavings ?? 0,
    coverage: savings.coverage,
    totalEpisodes: episodes.length,
    trackDecisions,
    videoSavingsBytes,
  }
}
