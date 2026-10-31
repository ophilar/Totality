import type { MediaItem, SubtitleTrack } from '@main/types/database'
import { normalizeVideoCodec } from './MediaNormalizer'
import { getQualityAnalyzer } from './QualityAnalyzer'
import { buildOptimizationSavingsBreakdown } from './OptimizationSavingsService'
import { selectSubtitleStreamIndexes } from './transcoding/StreamSelectionPlan'

export type OptimizationCandidateReason =
  | 'h264_video_transcode'
  | 'hevc_to_av1'
  | 'audio_stream_pruning'
  | 'subtitle_stream_pruning'
  | 'dolby_vision_profile_5_mp4_remux'

export interface OptimizationCandidateEvidence {
  reasons: OptimizationCandidateReason[]
  estimatedSavingsBytes: number | null
  targetCodec?: 'hevc' | 'av1'
}

export interface OptimizationCandidatePolicy {
  av1HardwareEncodingAvailable: boolean
  targetCodec?: 'hevc' | 'av1'
  audioPruningEnabled: boolean
  originalAudioLanguage?: string
  subtitleLanguageWhitelist: readonly string[]
}

function parseSubtitleTracks(raw: string | undefined): SubtitleTrack[] {
  if (!raw) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    throw new Error(`subtitle_tracks must contain valid JSON: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (!Array.isArray(parsed) || parsed.some(track =>
    track === null || typeof track !== 'object' || Array.isArray(track) ||
    !Number.isSafeInteger((track as SubtitleTrack).index) || (track as SubtitleTrack).index < 0 ||
    typeof (track as SubtitleTrack).codec !== 'string' ||
    ((track as SubtitleTrack).language != null && typeof (track as SubtitleTrack).language !== 'string') ||
    ((track as SubtitleTrack).isForced != null && typeof (track as SubtitleTrack).isForced !== 'boolean')
  )) {
    throw new Error('subtitle_tracks must be an array of track objects')
  }
  return parsed as SubtitleTrack[]
}

export class OptimizationCandidateService {
  discover(item: MediaItem, policy: OptimizationCandidatePolicy): OptimizationCandidateEvidence {
    const reasons: OptimizationCandidateReason[] = []
    const codec = normalizeVideoCodec(item.video_codec)
    if (codec === 'H.264') reasons.push('h264_video_transcode')
    if (codec === 'HEVC' && policy.av1HardwareEncodingAvailable) reasons.push('hevc_to_av1')

    const analyzer = getQualityAnalyzer()
    const requestedOriginalLanguage = policy.originalAudioLanguage?.trim()
    const originalAudioLanguage = policy.audioPruningEnabled
      ? requestedOriginalLanguage || item.original_language
      : null
    const removableAudioTracks = policy.audioPruningEnabled
      ? analyzer.getRemovableAudioTrackIndexes(item, originalAudioLanguage)
      : []
    if (removableAudioTracks.length > 0) reasons.push('audio_stream_pruning')

    const subtitleTracks = parseSubtitleTracks(item.subtitle_tracks)
    const retainedSubtitleIndexes = policy.subtitleLanguageWhitelist.length > 0
      ? selectSubtitleStreamIndexes(subtitleTracks, policy.subtitleLanguageWhitelist)
      : subtitleTracks.map(track => track.index)
    if (retainedSubtitleIndexes.length < subtitleTracks.length) reasons.push('subtitle_stream_pruning')

    const container = (item.container ?? '').split(',')[0].trim().toLowerCase()
    if (item.dolby_vision_profile === 5 && !['mp4', 'm4v'].includes(container)) {
      reasons.push('dolby_vision_profile_5_mp4_remux')
    }
    if (reasons.length === 0) return { reasons, estimatedSavingsBytes: null }

    const targetCodec = reasons.includes('hevc_to_av1')
      ? 'av1'
      : reasons.includes('h264_video_transcode')
        ? policy.targetCodec ?? (policy.av1HardwareEncodingAvailable ? 'av1' : 'hevc')
        : undefined
    const components = analyzer.getOptimizationSavingsBreakdown(item, undefined, targetCodec, {
      originalLanguage: originalAudioLanguage,
      subtitleLanguageWhitelist: policy.subtitleLanguageWhitelist,
    })
    const plannedOperations = [
      ...(targetCodec ? ['video_transcode' as const] : []),
      ...(reasons.includes('audio_stream_pruning') ? ['audio_pruning' as const] : []),
      ...(reasons.includes('subtitle_stream_pruning') ? ['subtitle_pruning' as const] : []),
    ]
    const savings = buildOptimizationSavingsBreakdown({
      totalBytes: item.file_size_bytes,
      videoSavingsBytes: components.videoSavingsBytes,
      audioPruningBytes: components.audioPruningBytes,
      audioTranscodeBytes: null,
      subtitlePruningBytes: components.subtitlePruningBytes,
      plannedOperations,
    })
    return { reasons, estimatedSavingsBytes: savings.totalEstimatedSavingsBytes, targetCodec }
  }
}
