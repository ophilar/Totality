import { LanguageDecisionService, type AudioTrackForDecision } from './LanguageDecisionService'
import { AudioCodecRanker } from './AudioCodecRanker'

export type OptimizationMechanismStatus = 'executable' | 'eligible-awaiting-opt-in' | 'review-required' | 'blocked' | 'unavailable'
export type OptimizationPrimaryAction = 'remove-audio-tracks' | 'transcode-audio' | 'transcode-video' | 'review-language' | 'no-action'

export interface OptimizationDecisionAudioTrack extends AudioTrackForDecision {
  codec: string
  channels: number
  bitrate?: number
  isDefault: boolean
  hasObjectAudio: boolean
  channelLayout?: string
  isCommentary?: boolean
  isAudioDescription?: boolean
  isAccessibility?: boolean
}

export interface OptimizationDecisionInput {
  originalLanguage: string | null | undefined
  durationSeconds?: number
  fileSize: number
  videoStorageDebtBytes?: number | null
  audioTranscodeSavingsBytes?: number | null
  audioTracks: OptimizationDecisionAudioTrack[]
}

export interface OptimizationDecisionMechanism {
  status: OptimizationMechanismStatus
  estimatedSavingsBytes: number | null
  reason: string
}

export interface OptimizationDecisionTrackRemoval extends OptimizationDecisionMechanism {
  retainedTrackIndexes: number[]
  removableTrackIndexes: number[]
  reviewRequiredTrackIndexes: number[]
  tracks: OptimizationDecisionAudioTrack[]
  originalLanguage: string | null
  confidence: 'high' | 'none'
  evidenceSources: string[]
}

export interface OptimizationDecision {
  primaryAction: OptimizationPrimaryAction
  trackRemoval: OptimizationDecisionTrackRemoval
  audioTranscode: OptimizationDecisionMechanism
  videoTranscode: OptimizationDecisionMechanism
}

const nonNegative = (value: number | null | undefined) => value == null || !Number.isFinite(value) ? null : Math.max(0, value)

export function buildOptimizationDecision(input: OptimizationDecisionInput): OptimizationDecision {
  const languageDecision = new LanguageDecisionService().decide(input.originalLanguage, input.audioTracks)
  const trackRemovalStatus: OptimizationMechanismStatus = languageDecision.status === 'review-required'
    ? 'review-required'
    : languageDecision.removableTrackIndexes.length > 0 ? 'executable' : 'blocked'
  const trackSavings = trackRemovalStatus === 'executable' && input.durationSeconds != null
    ? input.audioTracks
        .filter(track => languageDecision.removableTrackIndexes.includes(track.index))
        .reduce((sum, track) => {
          const bitrateKbps = track.bitrate && track.bitrate > 0 ? track.bitrate : AudioCodecRanker.estimateBitrate(track.codec, track.channels)
          return sum + Math.max(0, (bitrateKbps * 1000 / 8) * input.durationSeconds!)
        }, 0)
    : null

  const trackRemoval: OptimizationDecisionTrackRemoval = {
    status: trackRemovalStatus,
    estimatedSavingsBytes: trackSavings,
    reason: languageDecision.reason,
    retainedTrackIndexes: languageDecision.retainedTrackIndexes,
    removableTrackIndexes: languageDecision.removableTrackIndexes,
    reviewRequiredTrackIndexes: languageDecision.reviewRequiredTrackIndexes,
    tracks: input.audioTracks,
    originalLanguage: languageDecision.originalLanguage,
    confidence: languageDecision.confidence,
    evidenceSources: languageDecision.evidenceSources,
  }
  const audioSavings = nonNegative(input.audioTranscodeSavingsBytes)
  const videoSavings = nonNegative(input.videoStorageDebtBytes)
  const audioTranscode: OptimizationDecisionMechanism = { status: audioSavings != null && audioSavings > 0 ? 'executable' : 'unavailable', estimatedSavingsBytes: audioSavings, reason: audioSavings != null && audioSavings > 0 ? 'Existing audio transcode analysis found recoverable space' : 'Audio transcode estimate is unavailable' }
  const videoTranscode: OptimizationDecisionMechanism = { status: videoSavings != null && videoSavings > 0 ? 'executable' : 'unavailable', estimatedSavingsBytes: videoSavings, reason: videoSavings != null && videoSavings > 0 ? 'Existing video storage analysis found recoverable space' : 'Video transcode estimate is unavailable' }
  const primaryAction: OptimizationPrimaryAction = trackRemovalStatus === 'review-required' ? 'review-language' : trackRemovalStatus === 'executable' ? 'remove-audio-tracks' : audioTranscode.status === 'executable' ? 'transcode-audio' : videoTranscode.status === 'executable' ? 'transcode-video' : 'no-action'
  return { primaryAction, trackRemoval, audioTranscode, videoTranscode }
}
