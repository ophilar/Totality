import { getDatabase } from '@main/database/BetterSQLiteService'
import { getLoggingService } from '@main/services/LoggingService'
import type { MediaItem, MediaItemVersion, QualityScore, MusicAlbum, MusicTrack, MusicQualityScore, MusicQualityTier, AudioTrack, EvidenceConfidence, EvidenceStatus, SavingsBasis } from '@main/types/database'
import { APP_CONFIG } from '@main/config'
import { TrashSourceClassifier, MediaSourceTier } from '@main/services/transcoding/TrashSourceClassifier'
import type { FileAnalysisResult } from '@main/services/MediaFileAnalyzer'
import { normalizeLanguage } from '@main/constants/languages'

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
  video_bitrate: number | null | undefined
  file_size?: number | null | undefined
  duration?: number | null | undefined
  audio_codec: string | null | undefined
  audio_channels: number | null | undefined
  audio_bitrate: number | null | undefined
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

const DEFAULT_VIDEO_THRESHOLDS = APP_CONFIG.quality.videoBitrateThresholds
const DEFAULT_AUDIO_THRESHOLDS = APP_CONFIG.quality.audioBitrateThresholds
const DEFAULT_CODEC_EFFICIENCY = APP_CONFIG.quality.codecEfficiency
const DEFAULT_MUSIC_THRESHOLDS = APP_CONFIG.quality.musicThresholds
const DEFAULT_EFFICIENCY_TARGETS = APP_CONFIG.quality.efficiencyTargets
const DEFAULT_BLOAT_THRESHOLDS = APP_CONFIG.quality.bloatThresholds

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
  } catch (error) {
    throw new MediaMetadataError('MALFORMED_AUDIO_TRACKS', 'audio_tracks is not valid JSON', error)
  }

  if (!Array.isArray(parsed) || parsed.some(track => track === null || typeof track !== 'object' || Array.isArray(track))) {
    throw new MediaMetadataError('MALFORMED_AUDIO_TRACKS', 'audio_tracks must be a JSON array of track objects')
  }

  return parsed as AudioTrack[]
}

export class QualityAnalyzer {
  private thresholdsLoaded = false

  private videoThresholds = { ...DEFAULT_VIDEO_THRESHOLDS }
  private audioThresholds = { ...DEFAULT_AUDIO_THRESHOLDS }
  private efficiencyThresholds = { ...DEFAULT_EFFICIENCY_TARGETS }
  private bloatThresholds = { ...DEFAULT_BLOAT_THRESHOLDS }
  private efficiencyTrashThreshold = APP_CONFIG.quality.minEfficiencyScore
  private hdrOverheadMultiplier = APP_CONFIG.quality.hdrOverheadMultiplier
  private codecEfficiency = { ...DEFAULT_CODEC_EFFICIENCY }
  private musicThresholds = { ...DEFAULT_MUSIC_THRESHOLDS }
  private videoWeight = APP_CONFIG.quality.videoWeight

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
      const getPositiveNum = (key: string, defaultVal: number): number => {
        const value = getNum(key, defaultVal)
        return Number.isFinite(value) && value > 0 ? value : defaultVal
      }

      this.videoThresholds = {
        'SD': {
          medium: getNum('quality_video_sd_medium', DEFAULT_VIDEO_THRESHOLDS.SD.medium),
          high: getNum('quality_video_sd_high', DEFAULT_VIDEO_THRESHOLDS.SD.high),
        },
        '720p': {
          medium: getNum('quality_video_720p_medium', DEFAULT_VIDEO_THRESHOLDS['720p'].medium),
          high: getNum('quality_video_720p_high', DEFAULT_VIDEO_THRESHOLDS['720p'].high),
        },
        '1080p': {
          medium: getNum('quality_video_1080p_medium', DEFAULT_VIDEO_THRESHOLDS['1080p'].medium),
          high: getNum('quality_video_1080p_high', DEFAULT_VIDEO_THRESHOLDS['1080p'].high),
        },
        '4K': {
          medium: getNum('quality_video_4k_medium', DEFAULT_VIDEO_THRESHOLDS['4K'].medium),
          high: getNum('quality_video_4k_high', DEFAULT_VIDEO_THRESHOLDS['4K'].high),
        },
      }

      this.audioThresholds = {
        'SD': {
          medium: getNum('quality_audio_sd_medium', DEFAULT_AUDIO_THRESHOLDS.SD.medium),
          high: getNum('quality_audio_sd_high', DEFAULT_AUDIO_THRESHOLDS.SD.high),
        },
        '720p': {
          medium: getNum('quality_audio_720p_medium', DEFAULT_AUDIO_THRESHOLDS['720p'].medium),
          high: getNum('quality_audio_720p_high', DEFAULT_AUDIO_THRESHOLDS['720p'].high),
        },
        '1080p': {
          medium: getNum('quality_audio_1080p_medium', DEFAULT_AUDIO_THRESHOLDS['1080p'].medium),
          high: getNum('quality_audio_1080p_high', DEFAULT_AUDIO_THRESHOLDS['1080p'].high),
        },
        '4K': {
          medium: getNum('quality_audio_4k_medium', DEFAULT_AUDIO_THRESHOLDS['4K'].medium),
          high: getNum('quality_audio_4k_high', DEFAULT_AUDIO_THRESHOLDS['4K'].high),
        },
      }

      this.efficiencyThresholds = {
        'SD': getPositiveNum('quality_efficiency_sd_target', DEFAULT_EFFICIENCY_TARGETS.SD),
        '720p': getPositiveNum('quality_efficiency_720p_target', DEFAULT_EFFICIENCY_TARGETS['720p']),
        '1080p': getPositiveNum('quality_efficiency_1080p_target', DEFAULT_EFFICIENCY_TARGETS['1080p']),
        '4K': getPositiveNum('quality_efficiency_4k_target', DEFAULT_EFFICIENCY_TARGETS['4K']),
      }

      this.bloatThresholds = {
        'SD': getNum('quality_efficiency_sd_bloat', DEFAULT_BLOAT_THRESHOLDS.SD),
        '720p': getNum('quality_efficiency_720p_bloat', DEFAULT_BLOAT_THRESHOLDS['720p']),
        '1080p': getNum('quality_efficiency_1080p_bloat', DEFAULT_BLOAT_THRESHOLDS['1080p']),
        '4K': getNum('quality_efficiency_4k_bloat', DEFAULT_BLOAT_THRESHOLDS['4K']),
      }

      const h264Eff = getNum('quality_codec_h264', DEFAULT_CODEC_EFFICIENCY.h264)
      const h265Eff = getNum('quality_codec_h265', DEFAULT_CODEC_EFFICIENCY.h265)
      const av1Eff = getNum('quality_codec_av1', DEFAULT_CODEC_EFFICIENCY.av1)
      const vp9Eff = getNum('quality_codec_vp9', DEFAULT_CODEC_EFFICIENCY.vp9)
      this.codecEfficiency = {
        'h264': h264Eff, 'avc': h264Eff, 'x264': h264Eff,
        'h265': h265Eff, 'hevc': h265Eff, 'x265': h265Eff,
        'av1': av1Eff,
        'vp9': vp9Eff,
      }

      const rawWeight = getNum('quality_video_weight', 70)
      this.videoWeight = Math.max(0, Math.min(100, rawWeight)) / 100
      this.efficiencyTrashThreshold = getNum('quality_efficiency_trash_threshold', 60)
      this.hdrOverheadMultiplier = getNum('quality_efficiency_hdr_overhead', 1.10)

      this.musicThresholds = {
        lowBitrate: getNum('quality_music_low_bitrate', DEFAULT_MUSIC_THRESHOLDS.lowBitrate),
        highBitrate: getNum('quality_music_high_bitrate', DEFAULT_MUSIC_THRESHOLDS.highBitrate),
        hiResSampleRate: getNum('quality_music_hires_samplerate', DEFAULT_MUSIC_THRESHOLDS.hiResSampleRate),
        hiResBitDepth: getNum('quality_music_hires_bitdepth', DEFAULT_MUSIC_THRESHOLDS.hiResBitDepth),
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

  private getCodecEfficiency(codec: string | null): number | null {
    if (codec === null) return null
    const codecLower = codec.toLowerCase()
    for (const [key, efficiency] of Object.entries(this.codecEfficiency)) {
      if (codecLower.includes(key)) return efficiency
    }
    return null
  }

  private calculateDubBitrate(item: MediaItem): number | null {
    if (item.audio_tracks === null || item.audio_tracks === undefined || item.original_language === null || item.original_language === undefined) {
      return null
    }

    const tracks = parseAudioTracks(item.audio_tracks)
    const originalLanguage = normalizeLanguage(item.original_language)
    if (!originalLanguage || originalLanguage === 'und' || originalLanguage === 'unk') return null

    let dubBitrate = 0
    for (const track of tracks) {
      const language = normalizeLanguage(track.language)
      if (!language || language === 'und' || language === 'unk') return null
      if (language === originalLanguage) continue

      const bitrate = metadataNumber(track.bitrate, 'audio track bitrate')
      if (bitrate === null) return null
      dubBitrate += bitrate
    }

    return dubBitrate
  }

  private isLosslessAudio(codec: string | null): boolean | null {
    if (codec === null) return null
    const codecLower = codec.toLowerCase()
    return APP_CONFIG.audioCodecs.lossless.some(losslessCodec => codecLower.includes(losslessCodec.toLowerCase()))
  }

  private calculateAudioTrackQualityScore(track: AudioTrack): number {
    let score = 0
    const codec = metadataString(track.codec, 'audio track codec')
    const channels = metadataNumber(track.channels, 'audio track channels')
    const bitrate = metadataNumber(track.bitrate, 'audio track bitrate')
    const hasObjectAudio = metadataBoolean(track.hasObjectAudio, 'audio track object-audio flag')
    const isLossless = this.isLosslessAudio(codec)

    const minBitratePerChannel = 32
    const isSuspiciouslyLow = isLossless === false && hasObjectAudio !== true &&
      bitrate !== null && channels !== null && bitrate > 0 && bitrate < channels * minBitratePerChannel

    if (isSuspiciouslyLow) {
      return bitrate
    }

    if (hasObjectAudio === true) {
      score += 10000
    }

    if (isLossless === true) {
      score += 5000
    }

    if (codec !== null) {
      const codecLower = codec.toLowerCase()
      if (codecLower.includes('eac3') || codecLower.includes('e-ac-3') || codecLower.includes('dd+')) {
        score += 3000
      } else if (codecLower.includes('ac3') || codecLower.includes('ac-3') || codecLower.includes('dts')) {
        score += 2000
      } else if (codecLower.includes('aac')) {
        score += 1000
      }
    }

    if (channels !== null) score += channels * 100
    if (bitrate !== null) score += bitrate

    return score
  }

  private getBestAudioTrack(input: QualityScoringInput): AudioQualityMetadata {
    const primaryAudio: AudioQualityMetadata = {
      codec: metadataString(input.audio_codec, 'audio_codec'),
      channels: metadataNumber(input.audio_channels, 'audio_channels'),
      bitrate: metadataNumber(input.audio_bitrate, 'audio_bitrate'),
      hasObjectAudio: metadataBoolean(input.has_object_audio, 'has_object_audio'),
    }

    if (input.audio_tracks === null || input.audio_tracks === undefined) {
      return primaryAudio
    }

    const tracks = parseAudioTracks(input.audio_tracks)
    if (tracks.length === 0) {
      return { codec: null, channels: null, bitrate: null, hasObjectAudio: null }
    }

    const nonCommentary = tracks.filter(track => {
      const title = metadataString(track.title, 'audio track title')
      return title === null || !title.toLowerCase().includes('commentary')
    })
    if (nonCommentary.length === 0) {
      return { codec: null, channels: null, bitrate: null, hasObjectAudio: null }
    }
    const candidates = nonCommentary

    let bestTrack = candidates[0]
    let bestScore = this.calculateAudioTrackQualityScore(bestTrack)

    for (let i = 1; i < candidates.length; i++) {
      const score = this.calculateAudioTrackQualityScore(candidates[i])
      if (score > bestScore) {
        bestScore = score
        bestTrack = candidates[i]
      }
    }

    return {
      codec: metadataString(bestTrack.codec, 'audio track codec'),
      channels: metadataNumber(bestTrack.channels, 'audio track channels'),
      bitrate: metadataNumber(bestTrack.bitrate, 'audio track bitrate'),
      hasObjectAudio: metadataBoolean(bestTrack.hasObjectAudio, 'audio track object-audio flag'),
    }
  }

  private calculateVideoTierScore(effectiveBitrate: number, tier: QualityTier): number {
    if (effectiveBitrate <= 0) return 0
    const { medium, high } = this.videoThresholds[tier]
    if (effectiveBitrate >= high) return 100
    if (effectiveBitrate < medium) {
      return Math.round((effectiveBitrate / medium) * 50)
    }
    return 50 + Math.round(((effectiveBitrate - medium) / (high - medium)) * 49)
  }

  private calculateAudioTierScore(bestAudio: AudioQualityMetadata, tier: QualityTier): number | null {
    if (bestAudio.hasObjectAudio === true) return 100
    if (this.isLosslessAudio(bestAudio.codec) === true) return 100
    if (bestAudio.bitrate === null) return null
    if (bestAudio.bitrate <= 0) return 0

    const { medium, high } = this.audioThresholds[tier]
    if (bestAudio.bitrate >= high) return 100
    if (bestAudio.bitrate < medium) {
      return Math.round((bestAudio.bitrate / medium) * 50)
    }
    return 50 + Math.round(((bestAudio.bitrate - medium) / (high - medium)) * 49)
  }

  private formatBitrate(kbps: number): string {
    if (kbps >= 1000) {
      return `${(kbps / 1000).toFixed(1)} Mbps`
    }
    return `${kbps} kbps`
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

    if (qualityTier === 'Unknown') {
      return {
        qualityTier: 'Unknown',
        tierQuality: 'UNKNOWN',
        tierScore: null,
        bitrateTierScore: null,
        audioTierScore: null,
        effectiveBitrate: null,
        bestAudio,
      }
    }

    const videoCodec = metadataString(input.video_codec, 'video_codec')
    const videoBitrate = metadataNumber(input.video_bitrate, 'video_bitrate')
    const codecEfficiency = this.getCodecEfficiency(videoCodec)
    const effectiveBitrate = videoBitrate !== null && codecEfficiency !== null
      ? videoBitrate * codecEfficiency
      : null

    const bitrateTierScore = effectiveBitrate !== null ? this.calculateVideoTierScore(effectiveBitrate, qualityTier) : null
    const audioTierScore = this.calculateAudioTierScore(bestAudio, qualityTier)

    let tierScore: number | null = null
    if (bitrateTierScore !== null && audioTierScore !== null) {
      tierScore = Math.round(bitrateTierScore * this.videoWeight + audioTierScore * (1 - this.videoWeight))
    } else if (bitrateTierScore !== null) {
      tierScore = bitrateTierScore
    } else if (audioTierScore !== null) {
      tierScore = audioTierScore
    }

    let tierQuality: TierQuality | 'UNKNOWN' = 'UNKNOWN'
    if (tierScore !== null) {
      tierQuality = tierScore >= 75 ? 'HIGH' : tierScore >= 50 ? 'MEDIUM' : 'LOW'
    }
    return { qualityTier, tierQuality, tierScore, bitrateTierScore, audioTierScore, effectiveBitrate, bestAudio }
  }

  analyzeVersion(version: MediaItemVersion): VersionQualityResult {
    const { qualityTier, tierQuality, tierScore, bitrateTierScore, audioTierScore } = this.scoreQuality(version)
    return {
      quality_tier: qualityTier,
      tier_quality: tierQuality,
      tier_score: tierScore,
      bitrate_tier_score: bitrateTierScore,
      audio_tier_score: audioTierScore,
    }
  }

  async analyzeMediaItem(mediaItem: MediaItem): Promise<QualityScore> {
    const { qualityTier, tierQuality, tierScore, bitrateTierScore, audioTierScore, effectiveBitrate, bestAudio } =
      this.scoreQuality(mediaItem)

    const efficiencyScore = qualityTier !== 'Unknown' ? this.calculateEfficiencyScore(mediaItem, qualityTier) : null
    const videoBloatBytes = this.calculateVideoBloatBytes(mediaItem, qualityTier)
    const audioPruningEvidence = this.getAudioPruningEvidence(mediaItem)
    const storageDebtBytes = videoBloatBytes !== null && audioPruningEvidence.estimatedSavingsBytes !== null
      ? videoBloatBytes + audioPruningEvidence.estimatedSavingsBytes
      : null

    const issues: string[] = []
    const itemBitrate = metadataNumber(mediaItem.video_bitrate, 'video_bitrate')
    const videoCodec = metadataString(mediaItem.video_codec, 'video_codec')
    const codecEfficiency = this.getCodecEfficiency(videoCodec)

    if (qualityTier === 'Unknown') {
      issues.push('Resolution unknown')
    } else {
      const { medium: mediumThreshold } = this.videoThresholds[qualityTier]
      if (itemBitrate === null) {
        issues.push(`Bitrate unknown for ${qualityTier}`)
      } else if (effectiveBitrate !== null && effectiveBitrate < mediumThreshold && itemBitrate > 0) {
        const codecName = codecEfficiency !== null && codecEfficiency > 1.0 ? ` (${mediaItem.video_codec})` : ''
        issues.push(`Low bitrate for ${qualityTier}: ${this.formatBitrate(itemBitrate)}${codecName}`)
      }

      if (efficiencyScore !== null && efficiencyScore < this.efficiencyTrashThreshold && efficiencyScore > 0) {
        issues.push(`Low efficiency score (${efficiencyScore}%): bitrate is high for this tier`)
      }

      if (qualityTier === '4K') {
        if (mediaItem.hdr_format === null || mediaItem.hdr_format === undefined) {
          issues.push('HDR metadata unknown')
        } else if (mediaItem.hdr_format === 'None') {
          issues.push('4K content without HDR')
        }

        if (mediaItem.color_bit_depth === null || mediaItem.color_bit_depth === undefined) {
          issues.push('Color bit depth unknown')
        } else if (mediaItem.color_bit_depth < 10) {
          issues.push(`Color bit depth is ${mediaItem.color_bit_depth}-bit (below 10-bit)`)
        }
      }

      const { medium: audioMedium } = this.audioThresholds[qualityTier]
      if (bestAudio.channels === null) {
        issues.push('Audio channel count unknown')
      } else if (bestAudio.channels < 2) {
        issues.push('Mono audio')
      }

      if (bestAudio.bitrate === null) {
        issues.push('Audio bitrate unknown')
      } else if (bestAudio.channels === 2 && bestAudio.bitrate < audioMedium) {
        issues.push(`Low audio quality: ${bestAudio.bitrate} kbps`)
      }
    }

    const dubBitrate = this.calculateDubBitrate(mediaItem)
    if (dubBitrate !== null && dubBitrate > 500) {
      issues.push(`Dubbed audio bloat: ${this.formatBitrate(dubBitrate)} from non-original language tracks`)
    }

    const hasVideoBitrate = itemBitrate !== null
    const isLowQuality = tierQuality === 'LOW'
    const needsUpgrade = tierQuality === 'LOW'
    const resolutionScore = qualityTier === '4K' ? 100 : qualityTier === '1080p' ? 80 : qualityTier === '720p' ? 60 : qualityTier === 'SD' ? 40 : null

    return {
      media_item_id: mediaItem.id || 0,
      quality_tier: qualityTier,
      tier_quality: tierQuality,
      tier_score: tierScore,
      bitrate_tier_score: bitrateTierScore,
      audio_tier_score: audioTierScore,
      overall_score: tierScore,
      resolution_score: resolutionScore,
      bitrate_score: bitrateTierScore,
      audio_score: audioTierScore,
      efficiency_score: efficiencyScore,
      storage_debt_bytes: storageDebtBytes,
      evidence_status: hasVideoBitrate && bestAudio.bitrate !== null ? 'estimated' : 'insufficient',
      confidence: hasVideoBitrate && bestAudio.bitrate !== null ? 'medium' : 'none',
      savings_basis: 'insufficient_data',
      is_low_quality: isLowQuality,
      needs_upgrade: needsUpgrade,
      issues: JSON.stringify(issues),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }
  }

  private calculateEfficiencyScore(item: MediaItem, tier: QualityTier): number | null {
    const bitrate = metadataNumber(item.video_bitrate, 'video_bitrate')
    const duration = metadataNumber(item.duration, 'duration')
    const codec = metadataString(item.video_codec, 'video_codec')
    if (bitrate === null || duration === null || codec === null) return null
    if (bitrate === 0 || duration === 0) return 0

    const efficiencyMult = this.getCodecEfficiency(codec)
    if (efficiencyMult === null) return null

    const isHdr = item.hdr_format !== null && item.hdr_format !== undefined ? item.hdr_format !== 'None' : null
    const is10Bit = item.color_bit_depth !== null && item.color_bit_depth !== undefined && item.color_bit_depth >= 10
    const analysisBitrate = bitrate
    const effectiveBitrate = analysisBitrate * efficiencyMult
    const targetKbps = this.efficiencyThresholds[tier]
    const bloatKbps = this.bloatThresholds[tier] * (isHdr === true ? this.hdrOverheadMultiplier : 1.0)

    let score: number
    if (analysisBitrate <= targetKbps && efficiencyMult >= 2.0) {
      score = 100
    } else if (effectiveBitrate <= targetKbps) {
      score = Math.round(100 - (Math.max(0, analysisBitrate - targetKbps) / targetKbps) * 15)
    } else if (analysisBitrate <= bloatKbps) {
      const range = bloatKbps - targetKbps
      const offset = analysisBitrate - targetKbps
      score = Math.round(85 - (offset / range) * 25)
    } else {
      const overage = analysisBitrate - bloatKbps
      score = Math.max(0, Math.round(60 - (overage / bloatKbps) * 100))
    }

    if (is10Bit && score < 100 && score > 0) {
      score = Math.min(100, score + 5)
    }

    return score
  }

  private calculateVideoBloatBytes(item: MediaItem, qualityTier: QualityTier | 'Unknown'): number | null {
    if (qualityTier === 'Unknown') return null
    const bitrate = metadataNumber(item.video_bitrate, 'video_bitrate')
    const duration = metadataNumber(item.duration, 'duration')
    if (bitrate === null || duration === null) return null
    if (bitrate === 0 || duration === 0) return 0

    const targetBitrate = this.efficiencyThresholds[qualityTier]
    if (!Number.isFinite(targetBitrate) || targetBitrate <= 0) {
      throw new MediaMetadataError('INVALID_MEDIA_METADATA', `quality target for ${qualityTier} must be positive`)
    }

    const durationSec = duration / 1000
    return Math.max(0, Math.round(((bitrate - targetBitrate) * 1000 * durationSec) / 8))
  }

  private classifyTier(resolution?: string | null, height?: number | null): QualityTier | 'Unknown' {
    const res = metadataString(resolution, 'resolution')
    const mediaHeight = metadataNumber(height, 'height')

    if (res !== null) {
      const resLower = res.toLowerCase()
      if (resLower.includes('4k') || resLower.includes('2160p') || resLower.includes('uhd')) return '4K'
      if (resLower.includes('1080p') || resLower.includes('1080i') || resLower.includes('fhd')) return '1080p'
      if (resLower.includes('720p') || resLower.includes('720i') || resLower.includes('hd')) return '720p'
      if (resLower.includes('sd') || resLower.includes('480p') || resLower.includes('576p') || resLower.includes('480i') || resLower.includes('576i')) return 'SD'

      const wxhMatch = resLower.match(/(\d+)\s*x\s*(\d+)/i)
      if (wxhMatch) {
        const h = parseInt(wxhMatch[2], 10)
        if (h >= 2160) return '4K'
        if (h >= 1080) return '1080p'
        if (h >= 720) return '720p'
        if (h > 0) return 'SD'
      }
    }

    if (mediaHeight !== null && mediaHeight > 0) {
      if (mediaHeight >= 2160) return '4K'
      if (mediaHeight >= 1080) return '1080p'
      if (mediaHeight >= 720) return '720p'
      return 'SD'
    }

    return 'Unknown'
  }

  async analyzeAllMediaItems(
    onProgress?: (current: number, total: number) => void,
    isCancelled?: () => boolean,
    sourceId?: string,
    libraryId?: string
  ): Promise<number> {
    const db = getDatabase()
    const mediaItems = await db.media.getItems(sourceId || libraryId ? { sourceId, libraryId } : undefined)

    let analyzed = 0
    const tierCounts: Record<string, number> = {}
    const qualityCounts: Record<string, number> = {}

    getLoggingService().verbose('[QualityAnalyzer]', `Starting analysis of ${mediaItems.length} items`)

    try {
      for (const item of mediaItems) {
        if (isCancelled?.()) {
          return analyzed
        }
        const qualityScore = await this.analyzeMediaItem(item)
        await db.withBatch(async () => {
          await db.media.upsertQualityScore(qualityScore)
        })

        const tier = qualityScore.quality_tier
        const quality = qualityScore.tier_quality
        tierCounts[tier] = (tierCounts[tier] ?? 0) + 1
        qualityCounts[quality] = (qualityCounts[quality] ?? 0) + 1

        if (item.id && item.version_count && item.version_count > 1) {
          const versions = await db.media.getItemVersions(item.id)
          const updatePromises: Promise<void>[] = []
          for (const version of versions) {
            if (isCancelled?.()) {
              return analyzed
            }
            if (version.id) {
              const vScore = this.analyzeVersion(version)
              updatePromises.push(db.media.updateVersionQuality(version.id, vScore))
            }
          }
          if (updatePromises.length > 0) {
            await db.withBatch(async () => { await Promise.all(updatePromises) })
          }
          await db.media.updateBestVersion(item.id)
        }

        analyzed++
        if (onProgress) onProgress(analyzed, mediaItems.length)
      }
    } catch (error) {
      getLoggingService().error('[QualityAnalyzer]', 'Analysis failed:', error)
      throw error
    }

    const tierSummary = Object.entries(tierCounts).map(([t, c]) => `${t}:${c}`).join(', ')
    const qualSummary = Object.entries(qualityCounts).map(([q, c]) => `${q}:${c}`).join(', ')
    getLoggingService().verbose('[QualityAnalyzer]',
      `Analysis complete: ${analyzed}/${mediaItems.length} items — Tiers: ${tierSummary} — Quality: ${qualSummary}`)

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
    }
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
      }
    }

    scores.forEach((score: QualityScore) => {
      const tier = score.quality_tier
      const quality = score.tier_quality.toLowerCase()
      if (!(tier in distribution.byTier) || (quality !== 'low' && quality !== 'medium' && quality !== 'high')) return

      const knownTier = tier as QualityTier
      distribution.byTier[knownTier][quality]++
      distribution.byQuality[quality]++
    })

    return distribution
  }

  getRecommendedFormat(mediaItem: MediaItem, currentScore: number): string {
    const height = metadataNumber(mediaItem.height, 'height')
    if (height === null) return 'Insufficient evidence'
    if (height >= 2160 && currentScore >= 90) return 'No upgrade needed'
    if (height >= 1080 && currentScore < 80) return '4K UHD Blu-ray'
    return 'Blu-ray'
  }

  private getAudioPruningEvidence(item: MediaItem, analysis?: FileAnalysisResult): {
    status: 'measured' | 'estimated' | 'insufficient'
    estimatedSavingsBytes: number | null
  } {
    const durationMs = metadataNumber(analysis?.duration ?? item.duration, 'duration')
    const originalLanguage = normalizeLanguage(item.original_language)
    if (!originalLanguage || originalLanguage === 'und' || durationMs === null) {
      return { status: 'insufficient', estimatedSavingsBytes: null }
    }

    let tracks: Array<{
      index?: number
      bitrate?: number
      language?: string | null
      title?: string | null
      hasObjectAudio?: boolean
      isCommentary?: boolean
      isAudioDescription?: boolean
      isAccessibility?: boolean
    }>
    if (analysis) {
      tracks = analysis.audioTracks
    } else if (item.audio_tracks !== null && item.audio_tracks !== undefined) {
      tracks = parseAudioTracks(item.audio_tracks)
    } else {
      return { status: 'insufficient', estimatedSavingsBytes: null }
    }

    let removableBitrateKbps = 0
    let removableStreamBytes = 0
    const hasStreamByteEvidence = analysis?.streamBytes !== undefined
    for (const track of tracks) {
      const title = metadataString(track.title, 'audio track title')
      const protectedTrack = track.isCommentary === true || track.isAudioDescription === true || track.isAccessibility === true ||
        track.hasObjectAudio === true || (title !== null && /commentary|comment|audio description|descriptive|accessib|narration/i.test(title))
      if (protectedTrack) continue

      const language = normalizeLanguage(track.language)
      if (!language || language === 'und' || language === 'unk') {
        return { status: 'insufficient', estimatedSavingsBytes: null }
      }
      if (language === originalLanguage) continue

      if (hasStreamByteEvidence) {
        const index = metadataNumber(track.index, 'audio track index')
        if (index === null || !Number.isInteger(index)) {
          throw new MediaMetadataError('INVALID_MEDIA_METADATA', 'audio track index must be an integer when stream-byte evidence is present')
        }
        const streamBytes = analysis?.streamBytes?.[index]
        if (streamBytes === undefined) return { status: 'insufficient', estimatedSavingsBytes: null }
        if (!Number.isSafeInteger(streamBytes) || streamBytes < 0) {
          throw new MediaMetadataError('INVALID_MEDIA_METADATA', 'audio stream byte count must be a non-negative safe integer')
        }
        removableStreamBytes += streamBytes
        continue
      }

      const bitrate = metadataNumber(track.bitrate, 'audio track bitrate')
      if (bitrate === null) return { status: 'insufficient', estimatedSavingsBytes: null }
      removableBitrateKbps += bitrate
    }

    return {
      status: hasStreamByteEvidence ? 'measured' : 'estimated',
      estimatedSavingsBytes: hasStreamByteEvidence
        ? removableStreamBytes
        : Math.round((removableBitrateKbps * 1000 * (durationMs / 1000)) / 8),
    }
  }

  calculateDubBloatBytes(item: MediaItem, analysis?: FileAnalysisResult): number | null {
    return this.getAudioPruningEvidence(item, analysis).estimatedSavingsBytes
  }

  getOptimizationAdvice(item: MediaItem, analysis?: FileAnalysisResult): OptimizationAdvice {
    const video = analysis?.video
    const hasFreshAnalysis = analysis !== undefined
    const videoBitrate = metadataNumber(hasFreshAnalysis ? video?.bitrate : item.video_bitrate, 'video bitrate')
    const codec = metadataString(video?.codec ?? item.video_codec, 'video codec')
    const durationMs = metadataNumber(analysis?.duration ?? item.duration, 'duration')
    const filePath = metadataString(item.file_path, 'file_path')
    const sourceTier = TrashSourceClassifier.classify(filePath, videoBitrate, codec)
    const hasVideoEvidence = videoBitrate !== null && codec !== null && durationMs !== null &&
      Boolean(item.resolution || video?.height)
    const videoSavings = null
    const audioEvidence = this.getAudioPruningEvidence(item, analysis)
    const audioSavings = audioEvidence.estimatedSavingsBytes
    const isLegacyCodec = codec !== null && /^(h\.?264|x264|avc1?|vc-?1|mpeg-?2(video)?)$/i.test(codec)
    const isModernCodec = codec !== null && (codec.includes('hevc') || codec.includes('h265') || codec.includes('x265') || codec.includes('av1') || codec.includes('av01'))

    if ((audioEvidence.status === 'measured' || (!hasFreshAnalysis && audioEvidence.status === 'estimated')) && audioSavings !== null && audioSavings > 150 * 1024 * 1024 &&
      (sourceTier === 'WEB-DL' || sourceTier === 'WEBRip' || isModernCodec || !hasVideoEvidence)) {
      return {
        action: 'stream_pruning',
        decisionStatus: audioEvidence.status === 'measured' ? 'actionable' : 'insufficient_evidence',
        sourceTier,
        reason: 'Source is already efficient WEB-DL or HEVC/AV1. Stream copy (-c:v copy) recommended to prune measured foreign audio streams without re-encoding video.',
        estimatedSavingsBytes: audioSavings,
        evidence_status: audioEvidence.status,
        confidence: audioEvidence.status === 'measured' ? 'high' : 'medium',
        savings_basis: 'audio_stream_removal',
      }
    }

    const highBitrateSource = sourceTier === 'Remux' || sourceTier === 'BluRay' || (videoBitrate !== null && videoBitrate > 8000)
    if (hasVideoEvidence && !isModernCodec && highBitrateSource && sourceTier !== 'WEB-DL' && sourceTier !== 'WEBRip') {
      return {
        action: 'video_transcode',
        decisionStatus: hasFreshAnalysis ? 'sample_required' : 'insufficient_evidence',
        sourceTier,
        reason: sourceTier === 'Remux' && (videoBitrate! > 12000 || isLegacyCodec)
          ? 'High-bitrate Remux/BluRay source suitable for modern HEVC/AV1 encoding.'
          : 'Older or high-bitrate video stream suitable for modern transcoding.',
        estimatedSavingsBytes: videoSavings,
        evidence_status: 'measured',
        confidence: 'high',
        savings_basis: 'video_sample_encode',
      }
    }

    if (!hasVideoEvidence || audioEvidence.status === 'insufficient') {
      return {
        action: 'already_optimized',
        decisionStatus: 'insufficient_evidence',
        sourceTier,
        reason: 'Insufficient measured stream evidence to recommend an optimization action.',
        estimatedSavingsBytes: null,
        evidence_status: 'insufficient',
        confidence: 'none',
        savings_basis: 'insufficient_data',
      }
    }

    return {
      action: 'already_optimized',
      decisionStatus: hasFreshAnalysis ? 'already_optimized' : 'insufficient_evidence',
      sourceTier,
      reason: isModernCodec || sourceTier === 'WEB-DL' || sourceTier === 'WEBRip'
        ? 'Source is already compact and efficient. No transcode needed.'
        : 'Video bitrate is already within efficient range.',
      estimatedSavingsBytes: null,
      evidence_status: 'estimated',
      confidence: 'medium',
      savings_basis: 'video_sample_encode',
    }
  }

  analyzeMusicAlbum(album: MusicAlbum, tracks: MusicTrack[]): MusicQualityScore {
    const issues: string[] = []
    const avgBitrate = this.resolveMusicAverageBitrate(album, tracks)
    const qualityTier = this.determineMusicQualityTier(tracks, avgBitrate)
    const codecScore = this.calculateMusicCodecScore(tracks)
    const bitrateScore = this.calculateMusicBitrateScore(avgBitrate, qualityTier)
    const knownScores = [codecScore, bitrateScore].filter((score): score is number => score !== null)
    const tierScore = knownScores.length > 0
      ? Math.round(knownScores.reduce((sum, score) => sum + score, 0) / knownScores.length)
      : null

    let tierQuality: 'LOW' | 'MEDIUM' | 'HIGH' | 'UNKNOWN' = 'UNKNOWN'
    if (tierScore !== null) {
      if (tierScore >= 75) tierQuality = 'HIGH'
      else if (tierScore >= 40) tierQuality = 'MEDIUM'
      else tierQuality = 'LOW'
    }

    if (qualityTier === 'LOSSY_LOW') {
      issues.push(`Low quality lossy encoding (below ${this.musicThresholds.lowBitrate} kbps)`)
    } else if (qualityTier === 'LOSSY_MID' && tierQuality === 'LOW') {
      issues.push('Moderate quality lossy encoding')
    }

    if (tracks.length > 0) {
      const knownLosslessFlags = tracks.map(track => track.is_lossless).filter((value): value is boolean => typeof value === 'boolean')
      const losslessCount = knownLosslessFlags.filter(Boolean).length
      const lossyCount = knownLosslessFlags.filter(value => !value).length
      if (losslessCount > 0 && lossyCount > 0) issues.push('Mixed quality: some tracks are lossy')
    }

    const albumId = album.id
    if (albumId === null || albumId === undefined) {
      throw new MediaMetadataError('INVALID_MEDIA_METADATA', 'album id is required for a persisted music quality score')
    }

    return {
      album_id: albumId,
      quality_tier: qualityTier,
      tier_quality: tierQuality,
      tier_score: tierScore,
      codec_score: codecScore,
      bitrate_score: bitrateScore,
      efficiency_score: null,
      storage_debt_bytes: null,
      evidence_status: 'insufficient',
      confidence: 'none',
      savings_basis: 'insufficient_data',
      needs_upgrade: qualityTier === 'LOSSY_LOW' || qualityTier === 'LOSSY_MID',
      issues: JSON.stringify(issues),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }
  }

  private resolveMusicAverageBitrate(album: MusicAlbum, tracks: MusicTrack[]): number | null {
    const albumAverage = metadataNumber(album.avg_audio_bitrate, 'avg_audio_bitrate')
    if (albumAverage !== null) return albumAverage
    if (tracks.length === 0) return null

    const trackBitrates = tracks.map(track => metadataNumber(track.audio_bitrate, 'music track audio_bitrate'))
    if (trackBitrates.some(bitrate => bitrate === null)) return null

    const knownBitrates = trackBitrates as number[]
    return Math.round(knownBitrates.reduce((sum, bitrate) => sum + bitrate, 0) / knownBitrates.length)
  }

  private determineMusicQualityTier(tracks: MusicTrack[], avgBitrate: number | null): MusicQualityTier {
    if (tracks.some(track => track.is_hi_res === true)) return 'HI_RES'

    const explicitLossless = tracks.filter(track => typeof track.is_lossless === 'boolean')
    if (explicitLossless.length > 0 && explicitLossless.length === tracks.length && explicitLossless.every(track => track.is_lossless === true)) {
      return 'LOSSLESS'
    }

    const losslessCount = tracks.filter(track => track.is_lossless === true).length
    if (tracks.length > 0 && losslessCount / tracks.length > 0.5) return 'LOSSLESS'

    if (avgBitrate === null) return 'UNKNOWN'
    if (avgBitrate >= this.musicThresholds.highBitrate) return 'LOSSY_HIGH'
    if (avgBitrate >= this.musicThresholds.lowBitrate) return 'LOSSY_MID'
    return 'LOSSY_LOW'
  }

  private calculateMusicCodecScore(tracks: MusicTrack[]): number | null {
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

    const scores: number[] = []
    for (const track of tracks) {
      const codec = metadataString(track.audio_codec, 'music track audio_codec')
      if (codec === null) continue

      const codecLower = codec.toLowerCase()
      const ranking = Object.entries(codecRankings).find(([codecName]) => codecLower.includes(codecName))?.[1]
      if (ranking === undefined) continue

      scores.push(track.is_hi_res === true ? Math.min(100, ranking + 5) : ranking)
    }

    if (scores.length === 0) return null
    return Math.round(scores.reduce((sum, score) => sum + score, 0) / scores.length)
  }

  private calculateMusicBitrateScore(avgBitrate: number | null, tier: MusicQualityTier): number | null {
    if (avgBitrate === null) return null

    if (tier === 'LOSSLESS' || tier === 'HI_RES') {
      if (avgBitrate >= 1000) return 100
      if (avgBitrate >= 800) return 90
      if (avgBitrate >= 600) return 80
      return avgBitrate === 0 ? 0 : 70
    }

    if (avgBitrate >= 320) return 95
    if (avgBitrate >= 256) return 85
    if (avgBitrate >= 192) return 70
    if (avgBitrate >= 160) return 55
    if (avgBitrate >= 128) return 40
    return avgBitrate === 0 ? 0 : 25
  }

  getMusicQualityTierDisplay(tier: MusicQualityTier): string {
    const displays: Record<MusicQualityTier, string> = {
      'LOSSY_LOW': 'Low Quality',
      'LOSSY_MID': 'Standard',
      'LOSSY_HIGH': 'High Quality',
      'LOSSLESS': 'Lossless',
      'HI_RES': 'Hi-Res',
      'UNKNOWN': 'Unanalyzed',
    }
    return displays[tier]
  }

  getRecommendedMusicFormat(_album: MusicAlbum, score: MusicQualityScore): string {
    if (score.quality_tier === 'UNKNOWN') return 'Insufficient evidence'
    if (score.quality_tier === 'HI_RES' && score.tier_quality === 'HIGH') return 'No upgrade needed'
    if (score.quality_tier === 'LOSSLESS' && score.tier_quality !== 'LOW') return 'Hi-Res (24-bit/96kHz+)'
    if (score.quality_tier.startsWith('LOSSY')) return 'Lossless (FLAC/ALAC)'
    return 'Insufficient evidence'
  }
}

let analyzerInstance: QualityAnalyzer | null = null

export function getQualityAnalyzer(): QualityAnalyzer {
  if (!analyzerInstance) {
    analyzerInstance = new QualityAnalyzer()
  }
  return analyzerInstance
}