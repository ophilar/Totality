
import { LanguageDecisionService, type AudioTrackForDecision } from './LanguageDecisionService'
import { AudioCodecRanker } from './AudioCodecRanker'
import { APP_CONFIG } from '@main/config'
import type { EvidenceConfidence, EvidenceStatus, SavingsBasis } from '@main/types/database'
import { calculateBitrateSavingsBytes } from './OptimizationSavingsService'
import { normalizeAudioCodec } from './MediaNormalizer'

export type OptimizationMechanismStatus = 'executable' | 'eligible-awaiting-opt-in' | 'review-required' | 'blocked' | 'unavailable'
export type OptimizationPrimaryAction = 'remove-audio-tracks' | 'transcode-audio' | 'transcode-video' | 'review-language' | 'no-action'

export interface OptimizationDecisionAudioTrack extends AudioTrackForDecision {
  codec: string
  profile?: string
  channels: number
  bitrateKbps?: number
  isDefault: boolean
  hasObjectAudio: boolean
  channelLayout?: string
  isCommentary?: boolean
  isAudioDescription?: boolean
  isAccessibility?: boolean
}

export interface OptimizationDecisionInput {
  originalLanguage: string | null | undefined
  durationMs?: number
  videoSavingsBytes?: number | null
  videoAvailable?: boolean
  audioTranscodeSavingsBytes?: number | null
  audioTracks: OptimizationDecisionAudioTrack[]
  videoTargetCodec?: 'hevc' | 'av1' | null
}

export interface OptimizationDecisionMechanism {
  status: OptimizationMechanismStatus
  estimatedSavingsBytes: number | null
  reason: string
  evidenceStatus: EvidenceStatus
  confidence: EvidenceConfidence
  savingsBasis: SavingsBasis
  assumedTargetCodec?: 'hevc' | 'av1'
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

export function resolveOptimizationPrimaryAction(input: {
  trackRemovalStatus: OptimizationMechanismStatus
  audioTranscodeStatus: OptimizationMechanismStatus
  videoTranscodeStatus: OptimizationMechanismStatus
}): OptimizationPrimaryAction {
  if (input.trackRemovalStatus === 'review-required') return 'review-language'
  if (input.trackRemovalStatus === 'executable' || input.trackRemovalStatus === 'eligible-awaiting-opt-in') return 'remove-audio-tracks'
  if (input.audioTranscodeStatus === 'executable' || input.audioTranscodeStatus === 'eligible-awaiting-opt-in') return 'transcode-audio'
  if (input.videoTranscodeStatus === 'executable' || input.videoTranscodeStatus === 'eligible-awaiting-opt-in' || input.videoTranscodeStatus === 'review-required') return 'transcode-video'
  return 'no-action'
}

export function buildOptimizationDecision(input: OptimizationDecisionInput): OptimizationDecision {
  const languageDecision = new LanguageDecisionService().decide(input.originalLanguage, input.audioTracks)
  const durationSeconds = input.durationMs == null ? undefined : input.durationMs / 1000
  const removableTracks = input.audioTracks.filter(track => languageDecision.removableTrackIndexes.includes(track.index))
  const hasMeasuredTrackSavings = durationSeconds != null && durationSeconds > 0 &&
    removableTracks.every(track => Number.isFinite(track.bitrateKbps) && track.bitrateKbps != null && track.bitrateKbps > 0)
  const trackRemovalStatus: OptimizationMechanismStatus = languageDecision.status === 'review-required'
    ? 'review-required'
    : removableTracks.length === 0 ? 'blocked'
    : hasMeasuredTrackSavings ? 'executable' : 'unavailable'
  const trackSavings = trackRemovalStatus === 'executable'
    ? removableTracks.reduce((sum, track) => sum + calculateBitrateSavingsBytes(track.bitrateKbps!, 0, durationSeconds!), 0)
    : null
  const trackRemovalEvidenceStatus: EvidenceStatus = languageDecision.confidence !== 'high' || (removableTracks.length > 0 && !hasMeasuredTrackSavings)
    ? 'insufficient'
    : removableTracks.length > 0 ? 'estimated' : 'measured'

  const trackRemoval: OptimizationDecisionTrackRemoval = {
    status: trackRemovalStatus,
    estimatedSavingsBytes: trackSavings,
    reason: languageDecision.reason,
    retainedTrackIndexes: languageDecision.retainedTrackIndexes,
    removableTrackIndexes: languageDecision.removableTrackIndexes,
    reviewRequiredTrackIndexes: languageDecision.reviewRequiredTrackIndexes,
    tracks: input.audioTracks,
    originalLanguage: languageDecision.originalLanguage,
    evidenceStatus: trackRemovalEvidenceStatus,
    confidence: trackRemovalEvidenceStatus === 'measured' ? 'high' : trackRemovalEvidenceStatus === 'estimated' ? 'medium' : 'none',
    savingsBasis: trackRemovalEvidenceStatus === 'measured' ? 'audio_stream_removal' : trackRemovalEvidenceStatus === 'estimated' ? 'audio_bitrate_estimate' : 'insufficient_data',
    evidenceSources: languageDecision.evidenceSources,
  }
  const retainedTrackIndexes = languageDecision.status === 'approved'
    ? new Set(languageDecision.retainedTrackIndexes)
    : null
  const removableTrackIndexes = new Set(languageDecision.removableTrackIndexes)
  const audioTracksEligibleForTranscode = input.audioTracks.filter(track =>
    (retainedTrackIndexes === null || retainedTrackIndexes.has(track.index))
    && !removableTrackIndexes.has(track.index)
    && !track.hasObjectAudio
    && !track.isCommentary
    && !track.isAudioDescription
    && !track.isAccessibility
  )
  const hasMeasuredAudioEvidence = durationSeconds != null && durationSeconds > 0 && audioTracksEligibleForTranscode.length > 0 &&
    audioTracksEligibleForTranscode.every(track => track.codec.trim().length > 0 && Number.isFinite(track.channels) && track.channels > 0 && Number.isFinite(track.bitrateKbps) && track.bitrateKbps != null && track.bitrateKbps > 0)
  const hasLosslessAudio = audioTracksEligibleForTranscode.some(track =>
    AudioCodecRanker.getTier(normalizeAudioCodec(track.codec, track.profile), track.hasObjectAudio) >= AudioCodecRanker.TIER_LOSSLESS
  )
  const computedAudioSavings = hasMeasuredAudioEvidence
    ? audioTracksEligibleForTranscode.reduce((sum, track) => {
        const tier = AudioCodecRanker.getTier(normalizeAudioCodec(track.codec, track.profile), track.hasObjectAudio)
        const currentBitrateKbps = track.bitrateKbps!
        const targetBitrateKbps = track.channels >= 6 ? APP_CONFIG.transcoding.audioSurroundTargetBitrateKbps : APP_CONFIG.transcoding.audioStereoTargetBitrateKbps
        if (currentBitrateKbps > targetBitrateKbps && (tier >= AudioCodecRanker.TIER_LOSSLESS || currentBitrateKbps >= APP_CONFIG.transcoding.audioHeavyBitrateThresholdKbps)) {
          return sum + calculateBitrateSavingsBytes(currentBitrateKbps, targetBitrateKbps, durationSeconds!)
        }
        return sum
      }, 0)
    : null

  const audioSavings = hasMeasuredAudioEvidence
    ? nonNegative(input.audioTranscodeSavingsBytes ?? computedAudioSavings)
    : null
  const videoSavings = nonNegative(input.videoSavingsBytes)
  const audioTranscode: OptimizationDecisionMechanism = {
    status: audioSavings != null && audioSavings > 0 ? 'executable' : 'unavailable',
    estimatedSavingsBytes: audioSavings,
    reason: !hasMeasuredAudioEvidence ? 'Codec, channel, bitrate, and duration data is required for audio transcoding' : audioSavings != null && audioSavings > 0 && hasLosslessAudio ? 'Potential savings assume lossy conversion of lossless audio; review playback compatibility and accept the quality tradeoff before selecting a codec' : audioSavings != null && audioSavings > 0 ? 'Audio streams exceed the configured target bitrate; choose an output codec and review its quality tradeoff' : 'Audio streams are already within the configured target bitrate',
    evidenceStatus: hasMeasuredAudioEvidence ? 'estimated' : 'insufficient',
    confidence: hasMeasuredAudioEvidence ? 'medium' : 'none',
    savingsBasis: hasMeasuredAudioEvidence ? 'audio_transcode_model' : 'insufficient_data',
  }
  const estimatedVideoSavings = videoSavings
  const videoTranscode: OptimizationDecisionMechanism = {
    status: estimatedVideoSavings != null && estimatedVideoSavings > 0 || input.videoAvailable ? 'review-required' : 'unavailable',
    estimatedSavingsBytes: estimatedVideoSavings,
    reason: videoSavings === 0
      ? `The codec model predicts no size reduction for ${input.videoTargetCodec?.toUpperCase() ?? 'the selected video target'}; sample encodes are needed to determine actual savings.`
      : estimatedVideoSavings != null
      ? 'Configured video target estimate only; visual quality is not assessed. Review measured samples before encoding'
      : input.videoAvailable
        ? 'Video savings require measured encode samples that satisfy the selected quality and playback requirements.'
      : videoSavings === 0
        ? 'Configured video target and bitrate threshold estimate no size reduction; visual quality is not assessed'
        : 'Video bitrate or duration evidence is unavailable, so file-size savings cannot be estimated',
    evidenceStatus: videoSavings == null ? 'insufficient' : 'estimated',
    confidence: videoSavings == null ? 'none' : 'low',
    savingsBasis: estimatedVideoSavings != null ? 'video_bitrate_estimate' : 'insufficient_data',
    assumedTargetCodec: input.videoTargetCodec ?? undefined,
  }
  const primaryAction = resolveOptimizationPrimaryAction({
    trackRemovalStatus,
    audioTranscodeStatus: audioTranscode.status,
    videoTranscodeStatus: videoTranscode.status,
  })
  return { primaryAction, trackRemoval, audioTranscode, videoTranscode }
}

export function buildUnavailableOptimizationDecision(reason: string, originalLanguage?: string | null): OptimizationDecision {
  const mechanism: OptimizationDecisionMechanism = {
    status: 'unavailable',
    estimatedSavingsBytes: null,
    reason,
    evidenceStatus: 'insufficient',
    confidence: 'none',
    savingsBasis: 'insufficient_data',
  }
  return {
    primaryAction: 'no-action',
    trackRemoval: {
      ...mechanism,
      retainedTrackIndexes: [],
      removableTrackIndexes: [],
      reviewRequiredTrackIndexes: [],
      tracks: [],
      originalLanguage: originalLanguage ?? null,
      evidenceSources: [],
    },
    audioTranscode: mechanism,
    videoTranscode: mechanism,
  }
}
