import { LanguageDecisionService, type AudioTrackForDecision } from './LanguageDecisionService'
import { AudioCodecRanker } from './AudioCodecRanker'
import { APP_CONFIG } from '@main/config'
import type { EvidenceConfidence, EvidenceStatus, SavingsBasis } from '@main/types/database'

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
  evidence_status: EvidenceStatus
  confidence: EvidenceConfidence
  savings_basis: SavingsBasis
}

export interface OptimizationDecisionTrackRemoval extends OptimizationDecisionMechanism {
  retainedTrackIndexes: number[]
  removableTrackIndexes: number[]
  reviewRequiredTrackIndexes: number[]
  tracks: OptimizationDecisionAudioTrack[]
  originalLanguage: string | null
  evidenceSources: string[]
}

export interface OptimizationDecision {
  primaryAction: OptimizationPrimaryAction
  trackRemoval: OptimizationDecisionTrackRemoval
  audioTranscode: OptimizationDecisionMechanism
  videoTranscode: OptimizationDecisionMechanism
}

const nonNegative = (value: number | null | undefined) => value == null || !Number.isFinite(value) || value < 0 ? null : value

export function buildOptimizationDecision(input: OptimizationDecisionInput): OptimizationDecision {
  const languageDecision = new LanguageDecisionService().decide(input.originalLanguage, input.audioTracks)
  const removableTracks = input.audioTracks.filter(track => languageDecision.removableTrackIndexes.includes(track.index))
  const hasMeasuredTrackSavings = input.durationSeconds != null && input.durationSeconds > 0 &&
    removableTracks.every(track => Number.isFinite(track.bitrate) && track.bitrate != null && track.bitrate > 0)
  const trackRemovalStatus: OptimizationMechanismStatus = languageDecision.status === 'review-required'
    ? 'review-required'
    : removableTracks.length === 0 ? 'blocked'
    : hasMeasuredTrackSavings ? 'executable' : 'unavailable'
  const trackSavings = trackRemovalStatus === 'executable'
    ? removableTracks.reduce((sum, track) => sum + ((track.bitrate! * 1000 / 8) * input.durationSeconds!), 0)
    : null
  const trackRemovalEvidenceStatus: EvidenceStatus = languageDecision.confidence === 'high' && (removableTracks.length === 0 || hasMeasuredTrackSavings) ? 'measured' : 'insufficient'

  const trackRemoval: OptimizationDecisionTrackRemoval = {
    status: trackRemovalStatus,
    estimatedSavingsBytes: trackSavings,
    reason: languageDecision.reason,
    retainedTrackIndexes: languageDecision.retainedTrackIndexes,
    removableTrackIndexes: languageDecision.removableTrackIndexes,
    reviewRequiredTrackIndexes: languageDecision.reviewRequiredTrackIndexes,
    tracks: input.audioTracks,
    originalLanguage: languageDecision.originalLanguage,
    evidence_status: trackRemovalEvidenceStatus,
    confidence: trackRemovalEvidenceStatus === 'measured' ? 'high' : 'none',
    savings_basis: trackRemovalEvidenceStatus === 'measured' ? 'audio_stream_removal' : 'insufficient_data',
    evidenceSources: languageDecision.evidenceSources,
  }
  const audioTracksEligibleForTranscode = input.audioTracks.filter(track => !track.hasObjectAudio && !track.isCommentary && !track.isAudioDescription && !track.isAccessibility)
  const hasMeasuredAudioEvidence = input.durationSeconds != null && input.durationSeconds > 0 && audioTracksEligibleForTranscode.length > 0 &&
    audioTracksEligibleForTranscode.every(track => track.codec.trim().length > 0 && Number.isFinite(track.channels) && track.channels > 0 && Number.isFinite(track.bitrate) && track.bitrate != null && track.bitrate > 0)
  const computedAudioSavings = hasMeasuredAudioEvidence
    ? audioTracksEligibleForTranscode.reduce((sum, track) => {
        const tier = AudioCodecRanker.getTier(track.codec, track.hasObjectAudio)
        const currentBitrateKbps = track.bitrate!
        const targetBitrateKbps = track.channels >= 6 ? APP_CONFIG.transcoding.audioSurroundTargetBitrateKbps : APP_CONFIG.transcoding.audioStereoTargetBitrateKbps
        if (currentBitrateKbps > targetBitrateKbps && (tier >= AudioCodecRanker.TIER_LOSSLESS || currentBitrateKbps >= APP_CONFIG.transcoding.audioHeavyBitrateThresholdKbps)) {
          const savingsPerSecBytes = ((currentBitrateKbps - targetBitrateKbps) * 1000) / 8
          return sum + Math.round(savingsPerSecBytes * input.durationSeconds!)
        }
        return sum
      }, 0)
    : null

  const audioSavings = hasMeasuredAudioEvidence
    ? nonNegative(input.audioTranscodeSavingsBytes ?? (computedAudioSavings && computedAudioSavings > 0 ? computedAudioSavings : null))
    : null
  const videoSavings = nonNegative(input.videoStorageDebtBytes)
  const audioTranscode: OptimizationDecisionMechanism = {
    status: audioSavings != null && audioSavings > 0 ? 'executable' : 'unavailable',
    estimatedSavingsBytes: audioSavings,
    reason: !hasMeasuredAudioEvidence ? 'Measured codec, channel, bitrate, and duration evidence is required for audio transcoding' : audioSavings != null && audioSavings > 0 ? 'Measured audio streams exceed the configured target bitrate' : 'Measured audio streams are already efficient',
    evidence_status: hasMeasuredAudioEvidence ? 'estimated' : 'insufficient',
    confidence: hasMeasuredAudioEvidence ? 'medium' : 'none',
    savings_basis: hasMeasuredAudioEvidence ? 'audio_transcode_model' : 'insufficient_data',
  }
  const estimatedVideoSavings = videoSavings != null && videoSavings > 0 ? videoSavings : null
  const videoTranscode: OptimizationDecisionMechanism = {
    status: estimatedVideoSavings != null ? 'review-required' : 'unavailable',
    estimatedSavingsBytes: estimatedVideoSavings,
    reason: estimatedVideoSavings != null ? 'Estimated video-stream analysis found recoverable space; review before transcoding' : videoSavings === 0 ? 'Estimated video-stream analysis found no recoverable space' : 'Video-stream savings evidence is unavailable',
    evidence_status: videoSavings == null ? 'insufficient' : 'estimated',
    confidence: videoSavings == null ? 'none' : 'medium',
    savings_basis: estimatedVideoSavings != null ? 'video_sample_encode' : 'insufficient_data',
  }
  const primaryAction: OptimizationPrimaryAction = trackRemovalStatus === 'review-required' ? 'review-language' : trackRemovalStatus === 'executable' ? 'remove-audio-tracks' : audioTranscode.status === 'executable' ? 'transcode-audio' : 'no-action'
  return { primaryAction, trackRemoval, audioTranscode, videoTranscode }
}
