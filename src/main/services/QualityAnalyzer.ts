
import { getDatabase } from '../database/getDatabase'
import { getLoggingService } from '@main/services/LoggingService'
import type { MediaItem, MediaItemVersion, QualityScore, MusicAlbum, MusicTrack, MusicQualityScore, MusicQualityTier, AudioTrack, EvidenceConfidence, EvidenceStatus, SavingsBasis } from '@main/types/database'
import { APP_CONFIG } from '@main/config'
import { SETTING_KEYS } from '@shared/settingKeys'
import { TrashSourceClassifier, MediaSourceTier } from '@main/services/transcoding/TrashSourceClassifier'
import type { FileAnalysisResult } from '@main/services/MediaFileAnalyzer'
import { normalizeLanguage } from '@main/constants/languages'
import { buildOptimizationSavingsBreakdown, calculateBytesAtBitrateKbps, sumMeasuredStreamBytes, type OptimizationSavingsBreakdown } from '@main/services/OptimizationSavingsService'
import { getMediaFileAnalyzer } from '@main/services/MediaFileAnalyzer'
import { stat } from 'node:fs/promises'
import { PathUtils } from '@main/services/utils/PathUtils'
import { buildOptimizationDecision } from './OptimizationDecisionService'
import { selectBestAudioTrack } from '@main/providers/utils/ProviderUtils'
import { reconcileAnalyzedAudioTracks, mapAudioTracksForOptimization } from '@main/services/utils/audioTrackUtils'
import { buildStreamSelectionPlan } from './transcoding/StreamSelectionPlan'
import { normalizeVideoCodec } from '@main/services/MediaNormalizer'
import { getVideoResolutionTier } from './VideoResolutionTier'
import { AudioCodecRanker } from './AudioCodecRanker'
import { MEASUREMENT_VERSION, MEASUREMENT_SETTING_PREFIX, MeasuredQualityError, selectMeasuredCandidate, type CachedMeasurement } from './MeasuredOptimizationPolicy'
import { projectMeasuredSavingsBytes } from './OptimizationSavingsService'
import { fileIdentity, matchesFileIdentity, type FileIdentity } from './utils/FileIdentity'

export interface OptimizationAdvice {
  action: 'video_transcode' | 'stream_pruning' | 'already_optimized'
  decisionStatus: 'actionable' | 'sample_required' | 'already_optimized' | 'insufficient_evidence'
  sourceTier: MediaSourceTier
  reason: string
  estimatedSavingsBytes: number | null
  evidence_status: EvidenceStatus
  confidence: EvidenceConfidence
  savings_basis: SavingsBasis
}


/**
 * Shared input shape for quality scoring.
 * Both MediaItem and MediaItemVersion have these fields.
 */
interface QualityScoringInput {
  resolution: string | null | undefined
  video_codec: string | null | undefined
  video_bitrate_kbps: number | null | undefined
  file_size_bytes?: number | null | undefined
  duration_ms?: number | null | undefined
  audio_codec: string | null | undefined
  audio_channels: number | null | undefined
  audio_bitrate_kbps: number | null | undefined
  has_object_audio?: boolean | null
  audio_tracks?: string | null
  hdr_format?: string | null
  color_bit_depth?: number | null
  height?: number | null
}

export interface VersionQualityResult {
  quality_tier: string
  tier_quality: string
  tier_score: number | null
  bitrate_tier_score: number | null
  audio_tier_score: number | null
}

type QualitySavings = Pick<QualityScore,
  'media_item_id' | 'video_savings_bytes' | 'estimated_savings_bytes' | 'savings_coverage' |
  'evidence_status' | 'confidence' | 'savings_basis'
>

const DEFAULT_MUSIC_THRESHOLDS = APP_CONFIG.quality.musicThresholds
const DEFAULT_CODEC_EFFICIENCY = APP_CONFIG.quality.codecEfficiency
const DEFAULT_VIDEO_THRESHOLDS = APP_CONFIG.quality.videoBitrateThresholds
const DEFAULT_AUDIO_THRESHOLDS = APP_CONFIG.quality.audioBitrateThresholds
const QUALITY_ANALYSIS_BATCH_SIZE = 50
const DEFAULT_VIDEO_SAVINGS_TARGET_CODECS = ['HEVC']

type QualityTier = 'SD' | '720p' | '1080p' | '4K'
type TierQuality = 'LOW' | 'MEDIUM' | 'HIGH'

type MediaMetadataErrorCode = 'MALFORMED_AUDIO_TRACKS' | 'INVALID_MEDIA_METADATA'

export class MediaMetadataError extends Error {
  readonly code: MediaMetadataErrorCode

  constructor(code: MediaMetadataErrorCode, message: string, cause?: unknown) {
    super(message)
    this.name = 'MediaMetadataError'
    this.code = code
    if (cause !== undefined) {
      ;(this as Error & { cause?: unknown }).cause = cause
    }
  }
}

interface AudioQualityMetadata {
  codec: string | null
  channels: number | null
  bitrate: number | null
  hasObjectAudio: boolean | null
}

export class QualityAnalysisError extends Error {
  constructor(
    message: string,
    readonly details: { analyzedCount: number; totalCount: number; mediaItemId?: number; itemIndex?: number; stage: string }
  ) {
    super(message)
    this.name = 'QualityAnalysisError'
  }
}

function metadataString(value: unknown, field: string): string | null {
  if (value === null || value === undefined) return null
  if (typeof value !== 'string') {
    throw new MediaMetadataError('INVALID_MEDIA_METADATA', `${field} must be a string when present`)
  }
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function metadataNumber(value: unknown, field: string): number | null {
  if (value === null || value === undefined) return null
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new MediaMetadataError('INVALID_MEDIA_METADATA', `${field} must be a finite non-negative number when present`)
  }
  return value
}

function metadataBoolean(value: unknown, field: string): boolean | null {
  if (value === null || value === undefined) return null
  if (typeof value !== 'boolean') {
    throw new MediaMetadataError('INVALID_MEDIA_METADATA', `${field} must be a boolean when present`)
  }
  return value
}

function parseAudioTracks(raw: string): AudioTrack[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (cause) {
    throw new MediaMetadataError('MALFORMED_AUDIO_TRACKS', 'audio_tracks must contain valid JSON', cause)
  }
  if (!Array.isArray(parsed) || parsed.some(track => track === null || typeof track !== 'object' || Array.isArray(track))) {
    throw new MediaMetadataError('MALFORMED_AUDIO_TRACKS', 'audio_tracks must be an array of track objects')
  }
  return parsed as AudioTrack[]
}

function mergeAnalysisIntoMediaItem(item: MediaItem, analysis: FileAnalysisResult): MediaItem {
  return {
    ...item,
    file_size_bytes: analysis.fileSizeBytes ?? item.file_size_bytes,
    video_codec: analysis.video?.codec ?? item.video_codec,
    video_bitrate_kbps: analysis.video?.bitrateKbps ?? item.video_bitrate_kbps,
    hdr_format: analysis.video?.hdrFormat ?? item.hdr_format,
    color_bit_depth: analysis.video?.bitDepth ?? item.color_bit_depth,
    width: analysis.video?.width ?? item.width,
    height: analysis.video?.height ?? item.height,
    duration_ms: analysis.durationMs ?? item.duration_ms,
    audio_codec: analysis.audioTracks[0]?.codec ?? item.audio_codec,
    audio_channels: analysis.audioTracks[0]?.channels ?? item.audio_channels,
    audio_bitrate_kbps: analysis.audioTracks[0]?.bitrateKbps ?? item.audio_bitrate_kbps,
    audio_tracks: JSON.stringify(analysis.audioTracks),
    subtitle_tracks: JSON.stringify(analysis.subtitleTracks),
  }
}

export class QualityAnalyzer {
  private thresholdsLoaded = false

  private musicThresholds = { ...DEFAULT_MUSIC_THRESHOLDS }
  private codecEfficiency = { ...DEFAULT_CODEC_EFFICIENCY }
  private videoThresholds = { ...DEFAULT_VIDEO_THRESHOLDS }
  private audioThresholds = { ...DEFAULT_AUDIO_THRESHOLDS }
  private videoWeight = APP_CONFIG.quality.videoWeight
  private videoSavingsTargetCodecs: string[] = DEFAULT_VIDEO_SAVINGS_TARGET_CODECS

  /** Use the same configurable music thresholds as album-quality analysis. */
  isHighResolutionAudio(sampleRate?: number, bitDepth?: number): boolean {
    return (sampleRate !== undefined && sampleRate > this.musicThresholds.hiResSampleRate) ||
      (bitDepth !== undefined && bitDepth > this.musicThresholds.hiResBitDepth)
  }

  /**
   * Load all configurable settings from database (cached after first load)
   * Optimized: Uses single batch query instead of multiple individual calls
   */
  async loadThresholdsFromDatabase(): Promise<void> {
    if (this.thresholdsLoaded) {
      return
    }

    try {
      const db = getDatabase()
      const qualitySettings = await db.config.getSettingsByPrefix('quality_')

      const getNum = (key: string, defaultVal: number): number => {
        const val = qualitySettings[key]
        if (val) {
          const parsed = parseFloat(val)
          if (!isNaN(parsed)) return parsed
        }
        return defaultVal
      }
      this.musicThresholds = {
        lowBitrate: getNum('quality_music_low_bitrate', DEFAULT_MUSIC_THRESHOLDS.lowBitrate),
        highBitrate: getNum('quality_music_high_bitrate', DEFAULT_MUSIC_THRESHOLDS.highBitrate),
        hiResSampleRate: getNum('quality_music_hires_samplerate', DEFAULT_MUSIC_THRESHOLDS.hiResSampleRate),
        hiResBitDepth: getNum('quality_music_hires_bitdepth', DEFAULT_MUSIC_THRESHOLDS.hiResBitDepth),
      }
      this.codecEfficiency = {
        ...DEFAULT_CODEC_EFFICIENCY,
        h264: getNum('quality_codec_h264', DEFAULT_CODEC_EFFICIENCY.h264),
        h265: getNum('quality_codec_h265', DEFAULT_CODEC_EFFICIENCY.h265),
        av1: getNum('quality_codec_av1', DEFAULT_CODEC_EFFICIENCY.av1),
        vp9: getNum('quality_codec_vp9', DEFAULT_CODEC_EFFICIENCY.vp9),
      }
      const threshold = (kind: 'video' | 'audio', tier: QualityTier, level: 'medium' | 'high') => {
        const prefix = tier === '4K' ? '4k' : tier.toLowerCase()
        const defaults = kind === 'video' ? DEFAULT_VIDEO_THRESHOLDS[tier] : DEFAULT_AUDIO_THRESHOLDS[tier]
        const value = Number.parseFloat(qualitySettings[`quality_${kind}_${prefix}_${level}`] ?? '')
        return Number.isFinite(value) && value > 0 ? value : defaults[level]
      }
      this.videoThresholds = Object.fromEntries((['SD', '720p', '1080p', '4K'] as const).map(tier => [tier, {
        medium: threshold('video', tier, 'medium'), high: threshold('video', tier, 'high'),
      }])) as typeof DEFAULT_VIDEO_THRESHOLDS
      this.audioThresholds = Object.fromEntries((['SD', '720p', '1080p', '4K'] as const).map(tier => [tier, {
        medium: threshold('audio', tier, 'medium'), high: threshold('audio', tier, 'high'),
      }])) as typeof DEFAULT_AUDIO_THRESHOLDS
      const configuredWeight = Number.parseFloat(qualitySettings.quality_video_weight ?? '')
      this.videoWeight = Number.isFinite(configuredWeight)
        ? Math.max(0, Math.min(100, configuredWeight)) / 100
        : APP_CONFIG.quality.videoWeight

      const targetProfileId = await db.config.getSetting(SETTING_KEYS.optimization_default_target_profile_id)
      if (targetProfileId) {
        const profile = await db.playbackTargetProfiles.get(targetProfileId)
        if (!profile) throw new Error(`Playback target profile ${targetProfileId} was not found`)
        this.videoSavingsTargetCodecs = profile.definition.video.codecs.map(normalizeVideoCodec)
      } else {
        this.videoSavingsTargetCodecs = DEFAULT_VIDEO_SAVINGS_TARGET_CODECS
      }

      this.thresholdsLoaded = true
    } catch (error) {
      getLoggingService().error('[QualityAnalyzer]', 'Failed to load quality thresholds:', error)
      throw error
    }
  }

  invalidateThresholdsCache(): void {
    this.thresholdsLoaded = false
  }

  private getBestAudioTrack(input: QualityScoringInput): AudioQualityMetadata {
    const primaryAudio: AudioQualityMetadata = {
      codec: metadataString(input.audio_codec, 'audio_codec'),
      channels: metadataNumber(input.audio_channels, 'audio_channels'),
      bitrate: metadataNumber(input.audio_bitrate_kbps, 'audio_bitrate_kbps'),
      hasObjectAudio: metadataBoolean(input.has_object_audio, 'has_object_audio'),
    }

    if (input.audio_tracks === null || input.audio_tracks === undefined) {
      return primaryAudio
    }

    const tracks = parseAudioTracks(input.audio_tracks)
    if (tracks.length === 0) {
      return { codec: null, channels: null, bitrate: null, hasObjectAudio: null }
    }

    const bestTrack = selectBestAudioTrack(tracks)
    if (!bestTrack) return primaryAudio

    return {
      codec: metadataString(bestTrack.codec, 'audio track codec'),
      channels: metadataNumber(bestTrack.channels, 'audio track channels'),
      bitrate: metadataNumber((bestTrack as AudioTrack & { bitrateKbps?: number }).bitrateKbps ?? bestTrack.bitrate, 'audio track bitrate'),
      hasObjectAudio: metadataBoolean(bestTrack.hasObjectAudio, 'audio track object-audio flag'),
    }
  }

  private scoreQuality(input: QualityScoringInput): {
    qualityTier: QualityTier | 'Unknown'
    tierQuality: TierQuality | 'UNKNOWN'
    tierScore: number | null
    bitrateTierScore: number | null
    audioTierScore: number | null
    effectiveBitrate: number | null
    bestAudio: AudioQualityMetadata
  } {
    const qualityTier = this.classifyTier(input.resolution, input.height)
    const bestAudio = this.getBestAudioTrack(input)
    if (qualityTier === 'Unknown' || input.video_bitrate_kbps == null || input.video_bitrate_kbps <= 0) {
      return { qualityTier, tierQuality: 'UNKNOWN', tierScore: null, bitrateTierScore: null, audioTierScore: null, effectiveBitrate: null, bestAudio }
    }
    const efficiency = this.getVideoCodecEfficiency(input.video_codec)
    if (efficiency === undefined) {
      return { qualityTier, tierQuality: 'UNKNOWN', tierScore: null, bitrateTierScore: null, audioTierScore: null, effectiveBitrate: null, bestAudio }
    }
    const effectiveBitrate = input.video_bitrate_kbps * efficiency
    const bitrateTierScore = this.calculateVideoTierScore(effectiveBitrate, qualityTier)
    const audioTierScore = this.calculateAudioTierScore(bestAudio, qualityTier)
    const tierScore = audioTierScore == null ? bitrateTierScore : Math.round(bitrateTierScore * this.videoWeight + audioTierScore * (1 - this.videoWeight))
    return {
      qualityTier,
      tierQuality: tierScore >= 75 ? 'HIGH' : tierScore >= 50 ? 'MEDIUM' : 'LOW',
      tierScore,
      bitrateTierScore,
      audioTierScore,
      effectiveBitrate,
      bestAudio,
    }
  }

  private calculateVideoTierScore(effectiveBitrate: number, tier: QualityTier): number {
    if (effectiveBitrate <= 0) return 0
    const { medium, high } = this.videoThresholds[tier]
    if (effectiveBitrate >= high) return 100
    if (effectiveBitrate < medium) return Math.round((effectiveBitrate / medium) * 50)
    return 50 + Math.round(((effectiveBitrate - medium) / (high - medium)) * 49)
  }

  private getVideoCodecEfficiency(value: string | null | undefined): number | undefined {
    const codec = normalizeVideoCodec(value)
    const key = codec === 'H.264' ? 'h264' : codec === 'HEVC' ? 'h265' : codec === 'AV1' ? 'av1' : codec === 'VP9' ? 'vp9' : undefined
    const efficiency = key ? this.codecEfficiency[key] : undefined
    return efficiency !== undefined && Number.isFinite(efficiency) && efficiency > 0 ? efficiency : undefined
  }

  private calculateAudioTierScore(bestAudio: AudioQualityMetadata, tier: QualityTier): number | null {
    if (bestAudio.hasObjectAudio === true || this.isLosslessAudio(bestAudio.codec) === true) return 100
    if (bestAudio.bitrate === null) return null
    if (bestAudio.bitrate <= 0) return 0
    const { medium, high } = this.audioThresholds[tier]
    if (bestAudio.bitrate >= high) return 100
    if (bestAudio.bitrate < medium) return Math.round((bestAudio.bitrate / medium) * 50)
    return 50 + Math.round(((bestAudio.bitrate - medium) / (high - medium)) * 49)
  }

  private isLosslessAudio(codec: string | null): boolean | null {
    return codec === null ? null : AudioCodecRanker.isLossless(codec)
  }

  analyzeVersion(version: MediaItemVersion): VersionQualityResult {
    const { qualityTier, tierQuality, tierScore, bitrateTierScore, audioTierScore } = this.scoreQuality(version)
    return {
      quality_tier: qualityTier === 'Unknown' ? 'UNKNOWN' : qualityTier,
      tier_quality: tierQuality,
      tier_score: tierScore,
      bitrate_tier_score: bitrateTierScore,
      audio_tier_score: audioTierScore,
    }
  }

  private async analyzeQualityScore(mediaItem: MediaItem): Promise<QualityScore> {
    const { qualityTier, tierQuality, tierScore, bitrateTierScore, audioTierScore } = this.scoreQuality(mediaItem)
    return {
      media_item_id: mediaItem.id!,
      quality_tier: qualityTier === 'Unknown' ? 'UNKNOWN' : qualityTier,
      tier_quality: tierQuality,
      tier_score: tierScore,
      bitrate_tier_score: bitrateTierScore,
      audio_tier_score: audioTierScore,
      overall_score: tierScore,
      resolution_score: null,
      bitrate_score: null,
      audio_score: null,
      savings_coverage: 'insufficient',
      is_low_quality: tierQuality === 'LOW',
      needs_upgrade: tierQuality === 'LOW',
      issues: '[]',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }
  }

  private async analyzeSavings(mediaItem: MediaItem, analysis?: FileAnalysisResult, measurementAnalysis?: FileAnalysisResult): Promise<{
    savings: Omit<QualitySavings, 'media_item_id'>
    optimizationDecision: ReturnType<typeof buildOptimizationDecision>
  }> {
    const scoringItem = analysis ? mergeAnalysisIntoMediaItem(mediaItem, analysis) : mediaItem
    let measuredPlanSavingsBytes: number | undefined
    let measuredPlanBasis: SavingsBasis | undefined
    let hasApplicableMeasurements = false
    const measurement = measurementAnalysis?.optimizationMeasurement
    if (measurement && mediaItem.file_path && measurementAnalysis?.fileAnalysisFingerprint) {
      const raw = await getDatabase().config.getSetting(`${MEASUREMENT_SETTING_PREFIX}${measurement.cacheKey}`)
      if (raw) {
        const cached = JSON.parse(raw) as CachedMeasurement
        if (cached.version === MEASUREMENT_VERSION && cached.complete && cached.cacheKey === measurement.cacheKey) {
          const source = await stat(mediaItem.file_path)
          if (measurement.sourceSize === source.size && measurement.sourceMtimeMs === source.mtimeMs &&
              matchesFileIdentity(measurementAnalysis.fileAnalysisFingerprint, source)) {
            hasApplicableMeasurements = true
            try {
              const candidate = selectMeasuredCandidate(measurement.qualityProfile, cached.candidates)
              measuredPlanSavingsBytes = projectMeasuredSavingsBytes(source.size, (measurementAnalysis?.durationMs ?? mediaItem.duration_ms!) / 1000, candidate.outputBytes, candidate.sampledDurationSeconds)
              measuredPlanBasis = measurement.samplingRole === 'projected' ? 'representative_video_sample_projection' : 'video_sample_encode'
            } catch (error) {
              if (!(error instanceof MeasuredQualityError)) throw error
              getLoggingService().debug('[QualityAnalyzer]', `Cached measurements do not satisfy the selected requirements: mediaItem=${mediaItem.id}, cacheKey=${measurement.cacheKey}, outcome=${error.decisionStatus}`)
            }
          }
        }
      }
    }
    const { breakdown, audioPruningEvidence, optimizationDecision } = this.calculateOptimizationSavings(scoringItem, analysis, { measuredPlanSavingsBytes, hasApplicableMeasurements })
    const savingSources = [
      breakdown.videoSavingsBytes === null ? null : { status: 'estimated' as const, basis: 'video_bitrate_estimate' as const },
      audioPruningEvidence.estimatedSavingsBytes === null ? null : { status: audioPruningEvidence.status, basis: audioPruningEvidence.status === 'measured' ? 'audio_stream_removal' as const : 'audio_bitrate_estimate' as const },
      breakdown.subtitlePruningBytes === null ? null : { status: 'measured' as const, basis: 'subtitle_stream_removal' as const },
    ].filter((value): value is NonNullable<typeof value> => value !== null)
    const evidenceStatus = measuredPlanSavingsBytes !== undefined || savingSources.some(source => source.status === 'estimated')
      ? 'estimated' : savingSources.length > 0 ? 'measured' : 'insufficient'
    return {
      savings: {
        video_savings_bytes: breakdown.videoSavingsBytes,
        estimated_savings_bytes: breakdown.totalEstimatedSavingsBytes,
        savings_coverage: measuredPlanBasis === 'representative_video_sample_projection' ? 'partial' : breakdown.coverage,
        evidence_status: evidenceStatus,
        confidence: measuredPlanSavingsBytes !== undefined ? 'medium' : evidenceStatus === 'measured' ? 'high' : evidenceStatus === 'estimated' ? 'low' : 'none',
        savings_basis: measuredPlanBasis ?? (savingSources.length === 0
          ? 'insufficient_data'
          : savingSources.length > 1
            ? savingSources.some(source => source.status === 'estimated') ? 'mixed_measured_and_estimated' : 'mixed_measured'
            : savingSources[0].basis),
      },
      optimizationDecision,
    }
  }

  async analyzeMediaItemSavings(mediaItem: MediaItem, analysis: FileAnalysisResult): Promise<QualitySavings> {
    const { savings } = await this.analyzeSavings(mediaItem, analysis)
    return { media_item_id: mediaItem.id!, ...savings }
  }

  async analyzeMediaItem(mediaItem: MediaItem, analysis?: FileAnalysisResult): Promise<QualityScore> {
    // Never forward stale persisted evidence to savings calculations.
    let savedAnalysis = analysis ?? (mediaItem.deep_analysis ? JSON.parse(mediaItem.deep_analysis) as FileAnalysisResult : undefined)
    if (!analysis) {
      if (savedAnalysis?.success && savedAnalysis.fileAnalysisFingerprint && mediaItem.file_path) {
        const source = await stat(mediaItem.file_path)
        if (matchesFileIdentity(savedAnalysis.fileAnalysisFingerprint, source) &&
            PathUtils.arePathsEqual(savedAnalysis.filePath, mediaItem.file_path)) {
          analysis = savedAnalysis
        } else {
          savedAnalysis = undefined
        }
      } else {
        savedAnalysis = undefined
      }
    }
    const scoringItem = analysis ? mergeAnalysisIntoMediaItem(mediaItem, analysis) : mediaItem
    const { qualityTier, tierQuality, tierScore, bitrateTierScore, audioTierScore, bestAudio } =
      this.scoreQuality(scoringItem)

    const { savings, optimizationDecision } = await this.analyzeSavings(mediaItem, analysis, savedAnalysis)

    const issues: string[] = []
    const languageDecision = optimizationDecision.trackRemoval
    if (languageDecision.status === 'review-required') {
      const trackIndexes = languageDecision.reviewRequiredTrackIndexes
      issues.push(`${languageDecision.reason} (audio track indexes: ${trackIndexes.join(', ') || 'none'})`)
      getLoggingService().debug(
        '[QualityAnalyzer]',
        `Audio language review required: mediaItem=${mediaItem.id ?? 'unknown'}, title=${mediaItem.title}, filePath=${mediaItem.file_path ?? 'unknown'}, reason=${languageDecision.reason}, trackIndexes=${trackIndexes.join(', ')}`
      )
    }

    if (qualityTier === 'Unknown') {
      issues.push('Resolution unknown')
    } else {
      if (qualityTier === '4K') {
        if (scoringItem.hdr_format === null || scoringItem.hdr_format === undefined) {
          issues.push('HDR metadata unknown')
        } else if (scoringItem.hdr_format === 'None') {
          issues.push('4K content without HDR')
        }

        if (scoringItem.color_bit_depth === null || scoringItem.color_bit_depth === undefined) {
          issues.push('Color bit depth unknown')
        } else if (scoringItem.color_bit_depth < 10) {
          issues.push(`Color bit depth is ${scoringItem.color_bit_depth}-bit (below 10-bit)`)
        }
      }

      if (bestAudio.channels === null) {
        issues.push('Audio channel count unknown')
      } else if (bestAudio.channels < 2) {
        issues.push('Mono audio')
      }

    }

    const finalQualityTier = qualityTier === 'Unknown' ? 'UNKNOWN' : qualityTier
    const finalTierQuality = tierQuality

    return {
      media_item_id: mediaItem.id || 0,
      quality_tier: finalQualityTier,
      tier_quality: finalTierQuality,
      tier_score: tierScore,
      bitrate_tier_score: bitrateTierScore,
      audio_tier_score: audioTierScore,
      overall_score: tierScore,
      resolution_score: null,
      bitrate_score: null,
      audio_score: null,
      efficiency_score: null,
      ...savings,
      is_low_quality: tierQuality === 'LOW',
      needs_upgrade: tierQuality === 'LOW',
      issues: JSON.stringify(issues),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }
  }

  async analyzeMediaItemFileEvidence(
    mediaItem: MediaItem,
    signal?: AbortSignal,
    options: { scanBitrate?: boolean; detectVolume?: boolean; includePacketMetrics?: boolean; requestId?: string } = {},
  ): Promise<{ analysis: FileAnalysisResult }> {
    if (!mediaItem.file_path) throw new Error(`Media item ${mediaItem.id ?? mediaItem.title} has no local file path`)
    await this.loadThresholdsFromDatabase()
    const db = getDatabase()
    const filePath = mediaItem.file_path
    const source = await stat(filePath)
    const persistedItem = await ((db as any).getMediaItemByPath ? (db as any).getMediaItemByPath(filePath) : db.media?.getItemByPath(filePath))
    const cachedItem = persistedItem ?? mediaItem
    const requestedAnalysisOptions = {
      scanBitrate: options.scanBitrate ?? true,
      detectVolume: options.detectVolume ?? true,
      includePacketMetrics: options.includePacketMetrics ?? true,
    }
    type PersistedFileAnalysis = FileAnalysisResult & {
      fileAnalysisFingerprint?: Partial<FileIdentity>
      analysisOptions?: { scanBitrate?: boolean; detectVolume?: boolean; includePacketMetrics?: boolean }
    }
    const cachedAnalysis = cachedItem.deep_analysis
      ? JSON.parse(cachedItem.deep_analysis) as PersistedFileAnalysis
      : null
    // Older cache entries without full file identity must be reanalyzed once;
    // matching only size and mtime can reuse a replaced source incorrectly.
    const fingerprintMatches = matchesFileIdentity(cachedAnalysis?.fileAnalysisFingerprint, source)
    const analysisIsReusable = Boolean(
      cachedAnalysis?.success &&
      cachedAnalysis.filePath &&
      PathUtils.arePathsEqual(cachedAnalysis.filePath, filePath) &&
      fingerprintMatches &&
      (cachedAnalysis.analysisOptions
        ? cachedAnalysis.analysisOptions.scanBitrate === requestedAnalysisOptions.scanBitrate &&
          cachedAnalysis.analysisOptions.detectVolume === requestedAnalysisOptions.detectVolume &&
          (!requestedAnalysisOptions.includePacketMetrics || (cachedAnalysis.analysisOptions.includePacketMetrics ?? true))
        : requestedAnalysisOptions.scanBitrate && requestedAnalysisOptions.detectVolume),
    )

    getLoggingService().debug('[QualityAnalyzer]', `File evidence cache ${analysisIsReusable ? 'hit' : 'miss'}: mediaItem=${mediaItem.id}, filePath=${filePath}`)

    let analysis: PersistedFileAnalysis
    if (analysisIsReusable) {
      analysis = cachedAnalysis!
    } else {
      analysis = await getMediaFileAnalyzer().analyzeCompleteFile(filePath, { ...requestedAnalysisOptions, ...options, signal })
      if (!analysis.success) throw new Error(analysis.error || `File analysis failed for ${mediaItem.title}`)
      const afterAnalysis = await stat(filePath)
      if (!matchesFileIdentity(fileIdentity(source), afterAnalysis)) {
        throw new Error(`Media file changed during analysis: ${filePath}`)
      }
      analysis = {
        ...analysis,
        ...(fingerprintMatches ? { optimizationMeasurement: cachedAnalysis?.optimizationMeasurement } : {}),
        fileAnalysisFingerprint: fileIdentity(source),
        analysisOptions: requestedAnalysisOptions,
      }
      if ((db as any).updateDeepAnalysisByPath) {
        await (db as any).updateDeepAnalysisByPath(filePath, analysis, new Date().toISOString())
      } else if (db.media?.updateDeepAnalysisByPath) {
        await db.media.updateDeepAnalysisByPath(filePath, analysis, new Date().toISOString())
      }
    }

    if (!analysis.success) throw new Error(analysis.error || `File analysis failed for ${mediaItem.title}`)
    const providerTracks = cachedItem.audio_tracks ? parseAudioTracks(cachedItem.audio_tracks) : []
    const reconciled = reconcileAnalyzedAudioTracks(providerTracks, analysis.audioTracks)
    if (providerTracks.length > 0 && !reconciled.aligned) {
      getLoggingService().warn('[QualityAnalyzer]', `Audio stream evidence mismatch: mediaItem=${mediaItem.id}, matched=${reconciled.matchedCount}/${providerTracks.length} provider tracks, probed=${analysis.audioTracks.length}, nativeIndexes=${providerTracks.filter(track => track.streamIndex !== undefined).length}; unmatched stream languages are not inferred`)
    }
    // The persisted analysis remains the actual FFprobe result. Provider tags
    // are joined on each read, so later rescans cannot leave stale labels.
    return { analysis: { ...analysis, audioTracks: reconciled.tracks } }
  }

  getOptimizationSavingsBreakdown(item: MediaItem, analysis?: FileAnalysisResult, targetCodec?: 'hevc' | 'av1', policy?: { originalLanguage?: string | null; subtitleLanguageWhitelist?: readonly string[] }): OptimizationSavingsBreakdown {
    const analyzedItem = analysis ? mergeAnalysisIntoMediaItem(item, analysis) : item
    return this.calculateOptimizationSavings(analyzedItem, analysis, { targetCodec, ...policy }).breakdown
  }

  getRemovableAudioTrackIndexes(item: MediaItem, originalLanguage: string | null | undefined = item.original_language): number[] {
    return buildOptimizationDecision({ originalLanguage, audioTracks: this.getOptimizationAudioTracks(item) }).trackRemoval.removableTrackIndexes
  }

  private calculateOptimizationSavings(item: MediaItem, analysis: FileAnalysisResult | undefined, options?: { measuredPlanSavingsBytes?: number; hasApplicableMeasurements?: boolean; targetCodec?: 'hevc' | 'av1'; originalLanguage?: string | null; subtitleLanguageWhitelist?: readonly string[] }) {
    const audioTracks = this.getOptimizationAudioTracks(item, analysis)
    const durationMs = metadataNumber(analysis?.durationMs ?? item.duration_ms, 'duration_ms')
    const optimizationDecision = buildOptimizationDecision({
      originalLanguage: options && 'originalLanguage' in options ? options.originalLanguage : item.original_language,
      durationMs: durationMs ?? undefined,
      audioTracks,
    })
    const audioPruningEvidence = this.getAudioPruningEvidence(item, analysis, optimizationDecision)
    const subtitleWhitelist = options?.subtitleLanguageWhitelist ?? this.getSubtitleLanguageWhitelist()
    const subtitlePruningBytes = analysis && subtitleWhitelist.length > 0
      ? this.getSubtitlePruningBytes(analysis, [...subtitleWhitelist])
      : null
    const sourceCodec = normalizeVideoCodec(analysis?.video?.codec ?? item.video_codec)
    const targetCodec = options?.targetCodec ? normalizeVideoCodec(options.targetCodec)
      : sourceCodec === 'HEVC' && this.videoSavingsTargetCodecs.includes('AV1') ? 'AV1'
        : sourceCodec === 'AV1' && this.videoSavingsTargetCodecs.includes('AV1') ? 'AV1'
          : this.videoSavingsTargetCodecs.includes('HEVC') ? 'HEVC'
            : this.videoSavingsTargetCodecs.includes('AV1') ? 'AV1' : ''
    const sourceEfficiency = this.getVideoCodecEfficiency(sourceCodec)
    const targetEfficiency = this.getVideoCodecEfficiency(targetCodec)
    const sourceBitrateKbps = analysis?.video?.bitrateKbps ?? item.video_bitrate_kbps
    const sourceBytes = analysis?.video && analysis.streamBytes?.[analysis.video.index] !== undefined
      ? analysis.streamBytes[analysis.video.index]
      : sourceBitrateKbps != null && sourceBitrateKbps > 0 && durationMs != null && durationMs > 0 ? calculateBytesAtBitrateKbps(sourceBitrateKbps, durationMs / 1000) : undefined
    const totalBytes = analysis?.fileSizeBytes ?? item.file_size_bytes
    const otherStreamBytes = analysis?.video && analysis.streamBytes
      ? Object.entries(analysis.streamBytes).reduce((sum, [index, bytes]) => Number(index) === analysis.video!.index ? sum : sum + bytes, 0) : 0
    const videoBytes = sourceBytes === undefined ? undefined : totalBytes == null ? sourceBytes : Math.min(sourceBytes, Math.max(0, totalBytes - otherStreamBytes))
    // Codec efficiency is a configurable prior, not a perceptual measurement.
    // Preserve already encoded same/newer-codec video rather than inferring
    // recompression savings from the quality-rating bitrate thresholds.
    const videoSavingsBytes = options?.hasApplicableMeasurements || videoBytes === undefined || sourceEfficiency === undefined || targetEfficiency === undefined
      ? null
      : ['Dolby Vision', 'HDR10+'].includes(analysis?.video?.hdrFormat ?? item.hdr_format ?? '') ? 0
        : Math.round(videoBytes * Math.max(0, 1 - sourceEfficiency / targetEfficiency))
    const breakdown = buildOptimizationSavingsBreakdown({
      measuredPlanSavingsBytes: options?.measuredPlanSavingsBytes,
      totalBytes: analysis?.fileSizeBytes ?? item.file_size_bytes,
      videoSavingsBytes,
      audioPruningBytes: audioPruningEvidence.estimatedSavingsBytes,
      audioTranscodeBytes: null,
      subtitlePruningBytes,
      videoTargetCodec: targetCodec === 'HEVC' ? 'hevc' : targetCodec === 'AV1' ? 'av1' : null,
      plannedOperations: [
        'audio_pruning',
        'video_transcode',
        ...(subtitleWhitelist.length > 0 ? ['subtitle_pruning' as const] : []),
      ],
    })
    return { breakdown, audioPruningEvidence, optimizationDecision }
  }

  getSubtitleLanguageWhitelist(): string[] {
    const configuredLanguages = getDatabase().config.getSetting(SETTING_KEYS.subtitle_preferred_languages)
    if (!configuredLanguages?.trim()) return []
    return configuredLanguages.split(/[\s,]+/)
      .map(language => normalizeLanguage(language))
      .filter((language): language is string => Boolean(language))
  }

  private getSubtitlePruningBytes(analysis: FileAnalysisResult, subtitleWhitelist: string[]): number | null {
    const selection = buildStreamSelectionPlan(analysis, {
      streamSelection: { audio: 'all', subtitle: 'all', subtitleLanguageWhitelist: subtitleWhitelist },
    })
    const selectedIndexes = new Set(selection.subtitleStreamIndexes)
    const removedIndexes = analysis.subtitleTracks
      .filter(track => !selectedIndexes.has(track.index))
      .map(track => track.index)
    return removedIndexes.length === 0 ? 0 : sumMeasuredStreamBytes(analysis.streamBytes, removedIndexes)
  }

  getOptimizationAudioTracks(item: MediaItem, analysis?: FileAnalysisResult) {
    const providerTracks = item.audio_tracks ? parseAudioTracks(item.audio_tracks) : []
    return mapAudioTracksForOptimization(providerTracks, analysis?.audioTracks)
  }

  private classifyTier(resolution?: string | null, height?: number | null): QualityTier | 'Unknown' {
    const res = metadataString(resolution, 'resolution')
    const mediaHeight = metadataNumber(height, 'height')
    return getVideoResolutionTier(res, mediaHeight)
  }

  async analyzeAllMediaItems(
    onProgress?: (current: number, total: number) => void,
    isCancelled?: () => boolean,
    sourceId?: string,
    libraryId?: string,
    signal?: AbortSignal,
    series?: { title: string; seriesIdentityKey: string },
    onItemFailure?: (mediaItemId: number | undefined, error: unknown) => void,
    fileAnalysis?: {
      completedMediaItemIds: number[]
      onItemComplete: (mediaItemId: number) => void
      onItemStarted: (title: string, current: number, total: number) => void
      shouldYield?: () => boolean
    },
  ): Promise<number | { itemsScanned: number; yielded: true }> {
    const db = getDatabase()
    const logging = getLoggingService()
    const analysisStartedAt = Date.now()
    const filters = sourceId || libraryId ? { sourceId, libraryId } : undefined
    let analyzed = 0
    const completedMediaItemIds = new Set(fileAnalysis?.completedMediaItemIds)
    const tierCounts: Record<string, number> = {}
    const qualityCounts: Record<string, number> = {}
    const qualityScoresBatch: QualityScore[] = []
    const savingsBatch: QualitySavings[] = []
    let qualityScoreBatchWriteFailed = false
    const flushQualityScores = async (): Promise<void> => {
      if (qualityScoresBatch.length === 0 && savingsBatch.length === 0) return
      try {
        if (fileAnalysis) {
          for (const savings of savingsBatch) await db.media.updateQualitySavings(savings)
        } else {
          await db.media.upsertQualityRatings(qualityScoresBatch)
        }
        qualityScoresBatch.length = 0
        savingsBatch.length = 0
      } catch (error) {
        qualityScoreBatchWriteFailed = true
        throw error
      }
    }

    let currentItemId: number | undefined
    let currentItemIndex = 0
    let currentStage = 'loading media batch'
    let currentItemStartedAt = 0
    let totalItems = 0

    try {
      const seriesEpisodes = series
        ? await db.tvShows.getEpisodes(series.title, sourceId!, series.seriesIdentityKey, libraryId!)
        : undefined
      totalItems = seriesEpisodes?.length ?? db.countMediaItems(filters)

      logging.info(
        '[QualityAnalyzer]',
        `Starting analysis: items=${totalItems}, sourceId=${sourceId ?? 'all'}, libraryId=${libraryId ?? 'all'}`
      )

      for (let offset = 0; offset < totalItems; offset += QUALITY_ANALYSIS_BATCH_SIZE) {
        currentItemIndex = offset + 1
        currentStage = 'loading media batch'
        const mediaItems = seriesEpisodes
          ? seriesEpisodes.slice(offset, offset + QUALITY_ANALYSIS_BATCH_SIZE)
          : await db.media.getItems({ ...filters, limit: QUALITY_ANALYSIS_BATCH_SIZE, offset })
        const multiVersionItemIds = mediaItems
          .filter((item: MediaItem): item is MediaItem & { id: number } => Boolean(item.id && item.version_count && item.version_count > 1))
          .map((item: MediaItem) => item.id!)
        currentStage = 'loading media versions'
        const versionsByMediaId = await db.media.getItemVersionsForMediaIds(multiVersionItemIds)

        if (fileAnalysis) {
          const workerLimit = APP_CONFIG.workers.ffprobe.defaultWorkersLimit
          for (let batchStart = 0; batchStart < mediaItems.length; batchStart += workerLimit) {
            if (isCancelled?.() || signal?.aborted) {
              await flushQualityScores()
              signal?.throwIfAborted()
              logging.info('[QualityAnalyzer]', `Analysis cancelled after ${analyzed}/${totalItems} items`)
              return analyzed
            }
            if (fileAnalysis.shouldYield?.()) return { itemsScanned: analyzed, yielded: true }

            const batch = mediaItems.slice(batchStart, batchStart + workerLimit)
            const pendingItems = batch
              .map((item, batchIndex) => ({ item, index: batchStart + batchIndex }))
              .filter(({ item }) => !completedMediaItemIds.has(item.id!))

            for (const { index } of batch
              .map((item, batchIndex) => ({ item, index: batchStart + batchIndex }))
              .filter(({ item }) => completedMediaItemIds.has(item.id!))) {
              analyzed++
              onProgress?.(offset + index + 1, totalItems)
            }

            const results = await Promise.all(pendingItems.map(async ({ item, index }) => {
              const itemIndex = offset + index + 1
              const itemStartedAt = Date.now()
              currentItemId = item.id
              currentItemIndex = itemIndex
              currentItemStartedAt = itemStartedAt
              currentStage = 'media file analysis'
              fileAnalysis.onItemStarted(item.title, itemIndex - 1, totalItems)
              logging.debug('[QualityAnalyzer]', `Analyzing item ${itemIndex}/${totalItems}: id=${item.id}, type=${item.type}`)
              try {
                const { analysis } = await this.analyzeMediaItemFileEvidence(item, signal, {
                  requestId: String(item.id),
                  includePacketMetrics: false,
                })
                return { ok: true as const, item, itemIndex, itemStartedAt, savings: await this.analyzeMediaItemSavings(item, analysis) }
              } catch (error) {
                if (signal?.aborted || isCancelled?.()) throw error
                onItemFailure?.(item.id, error)
                logging.error('[QualityAnalyzer]', `Item analysis failed: id=${item.id ?? 'unknown'}, index=${itemIndex}/${totalItems}`, error)
                return { ok: false as const, item, itemIndex, itemStartedAt, error }
              }
            }))

            for (const result of results) {
              if (result.ok) savingsBatch.push(result.savings)
            }

            currentStage = 'persisting quality scores'
            await flushQualityScores()
            for (const result of results) {
              if (!result.ok) {
                onProgress?.(result.itemIndex, totalItems)
                continue
              }
              fileAnalysis.onItemComplete(result.item.id!)
              analyzed++
              logging.debug('[QualityAnalyzer]', `Analyzed item ${result.itemIndex}/${totalItems}: id=${result.item.id}, elapsedMs=${Date.now() - result.itemStartedAt}`)
              onProgress?.(result.itemIndex, totalItems)
            }
            if (fileAnalysis.shouldYield?.()) return { itemsScanned: analyzed, yielded: true }
          }
          continue
        }

        for (const [index, item] of mediaItems.entries()) {
          if (isCancelled?.() || signal?.aborted) {
            await flushQualityScores()
            signal?.throwIfAborted()
            logging.info('[QualityAnalyzer]', `Analysis cancelled after ${analyzed}/${totalItems} items`)
            return analyzed
          }
          currentItemId = item.id
          currentItemIndex = offset + index + 1
          currentItemStartedAt = Date.now()
          currentStage = 'calculating quality score'
          logging.debug(
            '[QualityAnalyzer]',
            `Analyzing item ${currentItemIndex}/${totalItems}: id=${currentItemId}, type=${item.type}`
          )
          let qualityScore: QualityScore | undefined
          try {
            qualityScore = await this.analyzeQualityScore(item)
            qualityScoresBatch.push(qualityScore)
          } catch (error) {
            if (signal?.aborted || isCancelled?.()) throw error
            onItemFailure?.(item.id, error)
            logging.error('[QualityAnalyzer]', `Item analysis failed: id=${item.id ?? 'unknown'}, index=${currentItemIndex}/${totalItems}`, error)
            if (onProgress) onProgress(currentItemIndex, totalItems)
            continue
          }
          currentStage = 'calculating quality score'
          if (qualityScore) {
            const tier = qualityScore.quality_tier
            const quality = qualityScore.tier_quality
            tierCounts[tier] = (tierCounts[tier] ?? 0) + 1
            qualityCounts[quality] = (qualityCounts[quality] ?? 0) + 1
          }

          if (item.id && item.version_count && item.version_count > 1) {
            currentStage = 'persisting quality scores before version analysis'
            await flushQualityScores()
            currentStage = 'analyzing alternate versions'
            const versions = versionsByMediaId.get(item.id) ?? []
            for (const version of versions) {
              if (isCancelled?.() || signal?.aborted) {
                signal?.throwIfAborted()
                logging.info('[QualityAnalyzer]', `Analysis cancelled after ${analyzed}/${totalItems} items`)
                return analyzed
              }
              if (version.id) {
                const vScore = this.analyzeVersion(version)
                db.media.updateVersionQuality(version.id, vScore)
              }
            }
            currentStage = 'selecting best alternate version'
            db.media.updateBestVersion(item.id)
          }

          if (qualityScoresBatch.length >= QUALITY_ANALYSIS_BATCH_SIZE) {
            currentStage = 'persisting quality scores'
            await flushQualityScores()
          }

          analyzed++
          logging.debug(
            '[QualityAnalyzer]',
            `Analyzed item ${currentItemIndex}/${totalItems}: id=${currentItemId}, elapsedMs=${Date.now() - currentItemStartedAt}`
          )
          if (onProgress) onProgress(currentItemIndex, totalItems)
        }
      }

      currentStage = 'persisting final quality scores'
      await flushQualityScores()
    } catch (error) {
      let failure: unknown = error
      let failureStage = currentStage
      if ((qualityScoresBatch.length > 0 || savingsBatch.length > 0) && !qualityScoreBatchWriteFailed) {
        try {
          await flushQualityScores()
        } catch (flushError) {
          const analysisMessage = error instanceof Error ? error.message : String(error)
          const persistenceMessage = flushError instanceof Error ? flushError.message : String(flushError)
          failure = new Error(`Analysis failed: ${analysisMessage}; pending score persistence failed: ${persistenceMessage}`)
          failureStage = 'persisting pending quality scores'
        }
      }
      signal?.throwIfAborted()
      const failureMessage = failure instanceof Error ? failure.message : String(failure)
      const contextualFailure = new QualityAnalysisError(
        `Quality analysis failed after ${analyzed}/${totalItems} items during ${failureStage}${currentItemId === undefined ? '' : ` at item ${currentItemIndex} (id=${currentItemId})`}: ${failureMessage}`,
        { analyzedCount: analyzed, totalCount: totalItems, mediaItemId: currentItemId, itemIndex: currentItemIndex || undefined, stage: failureStage }
      )
      logging.error(
        '[QualityAnalyzer]',
        `${contextualFailure.message}${currentItemId === undefined ? '' : `; elapsedMs=${Date.now() - currentItemStartedAt}`}`,
        contextualFailure
      )
      throw contextualFailure
    }

    const tierSummary = Object.entries(tierCounts).map(([t, c]) => `${t}:${c}`).join(', ')
    const qualSummary = Object.entries(qualityCounts).map(([q, c]) => `${q}:${c}`).join(', ')
    logging.info('[QualityAnalyzer]',
      `Analysis complete: ${analyzed}/${totalItems} items in ${Date.now() - analysisStartedAt}ms — Tiers: ${tierSummary} — Quality: ${qualSummary}`)

    return analyzed
  }

  async getQualityDistribution(): Promise<{
    byTier: {
      [tier: string]: { low: number; medium: number; high: number }
    }
    byQuality: {
      low: number
      medium: number
      high: number
    },
    coverage: { rated: number; total: number; unknown: number }
  }> {
    const db = getDatabase()
    const scores = await db.media.getQualityScores()
    const distribution = {
      byTier: {
        'SD': { low: 0, medium: 0, high: 0 },
        '720p': { low: 0, medium: 0, high: 0 },
        '1080p': { low: 0, medium: 0, high: 0 },
        '4K': { low: 0, medium: 0, high: 0 }
      },
      byQuality: {
        low: 0,
        medium: 0,
        high: 0
      },
      coverage: { rated: 0, total: db.countMediaItems(), unknown: 0 }
    }

    scores.forEach((score: QualityScore) => {
      const tier = score.quality_tier
      const quality = score.tier_quality.toLowerCase()
      if (quality === 'unknown') {
        distribution.coverage.unknown++
        return
      }
      if (quality !== 'low' && quality !== 'medium' && quality !== 'high') return
      distribution.byQuality[quality]++
      distribution.coverage.rated++
      if (tier in distribution.byTier) {
        const knownTier = tier as QualityTier
        distribution.byTier[knownTier][quality]++
      }
    })

    distribution.coverage.unknown += Math.max(0, distribution.coverage.total - scores.length)

    return distribution
  }

  getRecommendedFormat(mediaItem: MediaItem): string {
    const height = metadataNumber(mediaItem.height, 'height')
    if (height === null) return 'Resolution unknown'
    if (height >= 2160) return '4K resolution'
    if (height >= 1080) return '4K UHD Blu-ray'
    return 'Blu-ray'
  }

  private getAudioPruningEvidence(
    item: MediaItem,
    analysis?: FileAnalysisResult,
    decision?: ReturnType<typeof buildOptimizationDecision>,
  ): {
    status: 'measured' | 'estimated' | 'insufficient'
    estimatedSavingsBytes: number | null
  } {
    const optimizationDecision = decision ?? buildOptimizationDecision({
      originalLanguage: item.original_language,
      audioTracks: this.getOptimizationAudioTracks(item, analysis),
    })
    if (optimizationDecision.trackRemoval.status === 'review-required') {
      return { status: 'insufficient', estimatedSavingsBytes: null }
    }

    const removedIndexes = optimizationDecision.trackRemoval.removableTrackIndexes
    if (removedIndexes.length === 0) return { status: 'measured', estimatedSavingsBytes: 0 }
    if (analysis?.streamBytes) {
      const measuredBytes = sumMeasuredStreamBytes(analysis.streamBytes, removedIndexes)
      if (measuredBytes !== null) {
        if (!Number.isSafeInteger(measuredBytes) || measuredBytes < 0) {
          throw new MediaMetadataError('INVALID_MEDIA_METADATA', 'audio stream byte count must be a non-negative safe integer')
        }
        return { status: 'measured', estimatedSavingsBytes: measuredBytes }
      }
    }
    const durationMs = metadataNumber(analysis?.durationMs ?? item.duration_ms, 'duration_ms')
    const tracksByIndex = new Map(this.getOptimizationAudioTracks(item, analysis).map(track => [track.index, track]))
    const removableTracks = removedIndexes.map(index => tracksByIndex.get(index))
    if (durationMs == null || durationMs <= 0 || removableTracks.some(track => !track?.bitrateKbps || track.bitrateKbps <= 0)) {
      return { status: 'insufficient', estimatedSavingsBytes: null }
    }
    const estimatedBytes = removableTracks.reduce((sum, track) =>
      sum + calculateBytesAtBitrateKbps(track!.bitrateKbps!, durationMs / 1000), 0)
    return { status: 'estimated', estimatedSavingsBytes: estimatedBytes }
  }

  calculateDubBloatBytes(item: MediaItem, analysis?: FileAnalysisResult): number | null {
    return this.getAudioPruningEvidence(item, analysis).estimatedSavingsBytes
  }

  getOptimizationAdvice(item: MediaItem, analysis?: FileAnalysisResult, targetCodec?: 'hevc' | 'av1'): OptimizationAdvice {
    const video = analysis?.video
    const hasFreshAnalysis = analysis !== undefined
    const codec = metadataString(video?.codec ?? item.video_codec, 'video codec')
    const filePath = metadataString(item.file_path, 'file_path')
    const sourceTier = TrashSourceClassifier.classify(filePath)
    const audioEvidence = this.getAudioPruningEvidence(item, analysis)
    const audioSavings = audioEvidence.estimatedSavingsBytes
    const savings = this.calculateOptimizationSavings(item, analysis, { targetCodec }).breakdown
    const sourceCodec = normalizeVideoCodec(codec)
    const requestedCodec = targetCodec ? normalizeVideoCodec(targetCodec) : null
    const modeledTargetCodec = savings.videoTargetCodec?.toUpperCase()
    const codecMigrationCandidate = (sourceCodec === 'HEVC' && modeledTargetCodec === 'AV1') ||
      (requestedCodec !== null && requestedCodec !== sourceCodec)

    if (sourceCodec === 'H.264' || codecMigrationCandidate || (savings.videoSavingsBytes != null && savings.videoSavingsBytes > 0)) {
      return {
        action: 'video_transcode',
        decisionStatus: hasFreshAnalysis ? 'sample_required' : 'insufficient_evidence',
        sourceTier,
        reason: `Savings are estimated from source video bytes using relative codec efficiency, assuming ${modeledTargetCodec ?? 'the selected video target'}. This is a low-confidence estimate; samples must confirm quality, playback compatibility, and achievable savings.`,
        estimatedSavingsBytes: savings.totalEstimatedSavingsBytes,
        evidence_status: savings.videoSavingsBytes == null ? 'insufficient' : 'estimated',
        confidence: savings.videoSavingsBytes == null ? 'none' : 'low',
        savings_basis: savings.videoSavingsBytes == null ? 'insufficient_data' : 'video_bitrate_estimate',
      }
    }

    if (audioSavings !== null && audioSavings > 0) {
      return {
        action: 'stream_pruning',
        decisionStatus: audioEvidence.status === 'measured' ? 'actionable' : 'insufficient_evidence',
        sourceTier,
        reason: 'Measured unwanted audio streams can be removed while preserving the source video.',
        estimatedSavingsBytes: audioSavings,
        evidence_status: audioEvidence.status,
        confidence: audioEvidence.status === 'measured' ? 'high' : 'medium',
        savings_basis: 'audio_stream_removal',
      }
    }

    return {
      action: 'already_optimized',
      decisionStatus: 'insufficient_evidence',
      sourceTier,
      reason: 'No measured video savings or actionable stream removals are available.',
      estimatedSavingsBytes: null,
      evidence_status: 'insufficient',
      confidence: 'none',
      savings_basis: 'insufficient_data',
    }
  }

  analyzeMusicAlbum(album: MusicAlbum, tracks: MusicTrack[]): MusicQualityScore {
    const issues: string[] = []

    const qualityTier = this.determineMusicQualityTier(album, tracks)
    const codecScore = this.calculateMusicCodecScore(album, tracks)
    const bitrateScore = this.calculateMusicBitrateScore(album, qualityTier, tracks)
    const tierScore = qualityTier === 'UNKNOWN' ? 0 : Math.round((codecScore + bitrateScore) / 2)

    // Determine tier quality based on tier score
    let tierQuality: 'LOW' | 'MEDIUM' | 'HIGH' | 'UNKNOWN'
    if (qualityTier === 'UNKNOWN') {
      tierQuality = 'UNKNOWN'
    } else if (tierScore >= 75) {
      tierQuality = 'HIGH'
    } else if (tierScore >= 40) {
      tierQuality = 'MEDIUM'
    } else {
      tierQuality = 'LOW'
    }

    if (qualityTier === 'UNKNOWN') {
      issues.push('Track quality evidence is incomplete')
    } else if (qualityTier === 'LOSSY_LOW') {
      issues.push(`Low quality lossy encoding (below ${this.musicThresholds.lowBitrate} kbps)`)
    } else if (qualityTier === 'LOSSY_MID' && tierQuality === 'LOW') {
      issues.push('Moderate quality lossy encoding')
    }

    if (tracks.length > 0) {
      const losslessCount = tracks.filter(t => t.is_lossless).length
      const lossyCount = tracks.length - losslessCount
      if (losslessCount > 0 && lossyCount > 0) {
        issues.push('Mixed quality: some tracks are lossy')
      }
    }

    const needsUpgrade = qualityTier !== 'UNKNOWN' && tracks.some(track => {
      if (track.is_lossless || track.is_hi_res) return false
      const bitrate = track.audio_bitrate ?? album.avg_audio_bitrate
      return bitrate == null || bitrate < this.musicThresholds.highBitrate
    })

    return {
      album_id: album.id!,
      quality_tier: qualityTier,
      tier_quality: tierQuality,
      tier_score: tierScore,
      codec_score: codecScore,
      bitrate_score: bitrateScore,
      needs_upgrade: needsUpgrade,
      issues: JSON.stringify(issues),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }
  }

  /**
   * Determine music quality tier based on codec and specs
   */
  private determineMusicQualityTier(album: MusicAlbum, tracks: MusicTrack[]): MusicQualityTier {
    if (tracks.length === 0) return 'UNKNOWN'
    const tierRank: Record<MusicQualityTier, number> = { UNKNOWN: -1, LOSSY_LOW: 0, LOSSY_MID: 1, LOSSY_HIGH: 2, LOSSLESS: 3, HI_RES: 4 }
    return tracks.map(track => {
      if (track.is_hi_res) return 'HI_RES'
      if (track.is_lossless) return 'LOSSLESS'
      const bitrate = track.audio_bitrate ?? album.avg_audio_bitrate
      if (bitrate == null || bitrate <= 0) return 'UNKNOWN'
      if (bitrate >= this.musicThresholds.highBitrate) return 'LOSSY_HIGH'
      if (bitrate >= this.musicThresholds.lowBitrate) return 'LOSSY_MID'
      return 'LOSSY_LOW'
    }).reduce<MusicQualityTier>((lowest, tier) => tierRank[tier] < tierRank[lowest] ? tier : lowest, 'HI_RES')
  }

  /**
   * Calculate codec score for music (0-100)
   */
  private calculateMusicCodecScore(_album: MusicAlbum, tracks: MusicTrack[]): number {
    if (tracks.length === 0) return 50

    const codecRankings: Record<string, number> = {
      'dsd': 100,
      'flac': 95,
      'alac': 95,
      'wav': 95,
      'aiff': 95,
      'ape': 85,
      'wavpack': 85,
      'opus': 80,
      'aac': 70,
      'vorbis': 65,
      'mp3': 60,
      'wma': 50,
    }

    let lowestScore = 100
    for (const track of tracks) {
      const codec = (track.audio_codec || '').toLowerCase()
      let codecScore = 50

      for (const [codecName, score] of Object.entries(codecRankings)) {
        if (codec.includes(codecName)) {
          codecScore = score
          break
        }
      }

      if (track.is_hi_res) {
        codecScore = Math.min(100, codecScore + 5)
      }

      lowestScore = Math.min(lowestScore, codecScore)
    }

    return lowestScore
  }

  /**
   * Calculate bitrate score for music (0-100)
   */
  private calculateMusicBitrateScore(album: MusicAlbum, tier: MusicQualityTier, tracks: MusicTrack[]): number {
    if (tier === 'UNKNOWN') return 0
    const scores = tracks.map(track => {
      if (track.is_hi_res) return 100
      const bitrate = track.audio_bitrate ?? album.avg_audio_bitrate ?? 0
      if (track.is_lossless) {
        if (bitrate >= 1000) return 100
        if (bitrate >= 800) return 90
        if (bitrate >= 600) return 80
        return 70
      }
      if (bitrate >= 320) return 95
      if (bitrate >= 256) return 85
      if (bitrate >= 192) return 70
      if (bitrate >= 160) return 55
      if (bitrate >= 128) return 40
      return 25
    })
    return Math.min(...scores)
  }

  /**
   * Get music quality tier display name
   */
  getMusicQualityTierDisplay(tier: MusicQualityTier): string {
    const displays: Record<MusicQualityTier, string> = {
      'LOSSY_LOW': 'Low Quality',
      'LOSSY_MID': 'Standard',
      'LOSSY_HIGH': 'High Quality',
      'LOSSLESS': 'Lossless',
      'HI_RES': 'Hi-Res',
      'UNKNOWN': 'Unknown',
    }
    return displays[tier] || tier
  }

  /**
   * Get recommended music format for upgrade
   */
  getRecommendedMusicFormat(_album: MusicAlbum, score: MusicQualityScore): string {
    if (score.quality_tier === 'UNKNOWN') return 'Insufficient evidence'
    if (score.quality_tier === 'HI_RES' && score.tier_quality === 'HIGH') {
      return 'No upgrade needed'
    }

    if (score.quality_tier === 'LOSSLESS' && score.tier_quality !== 'LOW') {
      return 'Hi-Res (24-bit/96kHz+)'
    }

    if (score.quality_tier.startsWith('LOSSY')) {
      return 'Lossless (FLAC/ALAC)'
    }

    return 'Lossless (FLAC/ALAC)'
  }
}

let analyzerInstance: QualityAnalyzer | null = null

export function getQualityAnalyzer(): QualityAnalyzer {
  if (!analyzerInstance) {
    analyzerInstance = new QualityAnalyzer()
  }
  return analyzerInstance
}
