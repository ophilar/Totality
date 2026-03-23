import { getDatabase } from '../database/getDatabase'
import { getLoggingService } from './LoggingService'
import type { MediaItem, MediaItemVersion, QualityScore, MusicAlbum, MusicTrack, MusicQualityScore, MusicQualityTier, AudioTrack } from '../types/database'

/**
 * Shared input shape for quality scoring.
 * Both MediaItem and MediaItemVersion have these fields.
 */
interface QualityScoringInput {
  resolution: string | null | undefined
  video_codec: string | null | undefined
  video_bitrate: number
  audio_codec: string
  audio_channels: number
  audio_bitrate: number
  has_object_audio?: boolean | null
  audio_tracks?: string | null
  hdr_format?: string | null
  color_bit_depth?: number | null
  height?: number | null
}

/**
 * Lightweight quality result for version scoring.
 */
export interface VersionQualityResult {
  quality_tier: string
  tier_quality: string
  tier_score: number
  bitrate_tier_score: number
  audio_tier_score: number
}

// Default video bitrate thresholds (MEDIUM and HIGH per tier)
// Below MEDIUM = LOW, MEDIUM to HIGH = MEDIUM, above HIGH = HIGH
const DEFAULT_VIDEO_THRESHOLDS = {
  'SD': { medium: 1500, high: 3500 },
  '720p': { medium: 3000, high: 8000 },
  '1080p': { medium: 6000, high: 15000 },
  '4K': { medium: 15000, high: 40000 }
}

// Default audio bitrate thresholds (MEDIUM and HIGH per tier)
const DEFAULT_AUDIO_THRESHOLDS = {
  'SD': { medium: 128, high: 192 },
  '720p': { medium: 192, high: 320 },
  '1080p': { medium: 256, high: 640 },
  '4K': { medium: 320, high: 1000 }
}

type QualityTier = 'SD' | '720p' | '1080p' | '4K'
type TierQuality = 'LOW' | 'MEDIUM' | 'HIGH'

// Default codec efficiency multipliers (relative to H.264)
const DEFAULT_CODEC_EFFICIENCY = {
  'h264': 1.0, 'avc': 1.0, 'x264': 1.0,
  'h265': 2.0, 'hevc': 2.0, 'x265': 2.0,
  'av1': 2.5,
  'vp9': 1.8
}

// Default music quality thresholds
const DEFAULT_MUSIC_THRESHOLDS = {
  lowBitrate: 192,
  highBitrate: 256,
  hiResSampleRate: 44100,
  hiResBitDepth: 16,
}

// Default efficiency target thresholds (kbps) for HEVC
const DEFAULT_EFFICIENCY_TARGETS = {
  'SD': 1200,
  '720p': 2500,
  '1080p': 5000,
  '4K': 15000
}

// Default bloat start thresholds (kbps) for HEVC
const DEFAULT_BLOAT_THRESHOLDS = {
  'SD': 2500,
  '720p': 5000,
  '1080p': 10000,
  '4K': 30000
}

export class QualityAnalyzer {
  private thresholdsLoaded = false

  // Configurable settings loaded from database
  private videoThresholds = { ...DEFAULT_VIDEO_THRESHOLDS }
  private audioThresholds = { ...DEFAULT_AUDIO_THRESHOLDS }
  private efficiencyThresholds = { ...DEFAULT_EFFICIENCY_TARGETS }
  private bloatThresholds = { ...DEFAULT_BLOAT_THRESHOLDS }
  private efficiencyTrashThreshold = 60
  private losslessAudioAllowance = 4000 // kbps (4 Mbps)
  private hdrOverheadMultiplier = 1.10 // 10% more bitrate allowed for HDR
  private codecEfficiency = { ...DEFAULT_CODEC_EFFICIENCY }
  private musicThresholds = { ...DEFAULT_MUSIC_THRESHOLDS }
  private videoWeight = 0.7 // 0-1, audio weight = 1 - videoWeight

  constructor() {
    // Legacy constructor with custom thresholds removed
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

      // Batch load all quality settings in a single query
      const qualitySettings = db.getSettingsByPrefix('quality_')

      const getNum = (key: string, defaultVal: number): number => {
        const val = qualitySettings[key]
        if (val) {
          const parsed = parseFloat(val)
          if (!isNaN(parsed)) return parsed
        }
        return defaultVal
      }

      // Load video bitrate thresholds (try new keys first, fall back to old)
      this.videoThresholds = {
        'SD': {
          medium: getNum('quality_video_sd_medium', getNum('quality_video_sd_low', DEFAULT_VIDEO_THRESHOLDS.SD.medium)),
          high: getNum('quality_video_sd_high', DEFAULT_VIDEO_THRESHOLDS.SD.high),
        },
        '720p': {
          medium: getNum('quality_video_720p_medium', getNum('quality_video_720p_low', DEFAULT_VIDEO_THRESHOLDS['720p'].medium)),
          high: getNum('quality_video_720p_high', DEFAULT_VIDEO_THRESHOLDS['720p'].high),
        },
        '1080p': {
          medium: getNum('quality_video_1080p_medium', getNum('quality_video_1080p_low', DEFAULT_VIDEO_THRESHOLDS['1080p'].medium)),
          high: getNum('quality_video_1080p_high', DEFAULT_VIDEO_THRESHOLDS['1080p'].high),
        },
        '4K': {
          medium: getNum('quality_video_4k_medium', getNum('quality_video_4k_low', DEFAULT_VIDEO_THRESHOLDS['4K'].medium)),
          high: getNum('quality_video_4k_high', DEFAULT_VIDEO_THRESHOLDS['4K'].high),
        },
      }

      // Load audio bitrate thresholds (try new keys first, fall back to old)
      this.audioThresholds = {
        'SD': {
          medium: getNum('quality_audio_sd_medium', getNum('quality_audio_sd_good', DEFAULT_AUDIO_THRESHOLDS.SD.medium)),
          high: getNum('quality_audio_sd_high', getNum('quality_audio_sd_excellent', DEFAULT_AUDIO_THRESHOLDS.SD.high)),
        },
        '720p': {
          medium: getNum('quality_audio_720p_medium', getNum('quality_audio_720p_good', DEFAULT_AUDIO_THRESHOLDS['720p'].medium)),
          high: getNum('quality_audio_720p_high', getNum('quality_audio_720p_excellent', DEFAULT_AUDIO_THRESHOLDS['720p'].high)),
        },
        '1080p': {
          medium: getNum('quality_audio_1080p_medium', getNum('quality_audio_1080p_good', DEFAULT_AUDIO_THRESHOLDS['1080p'].medium)),
          high: getNum('quality_audio_1080p_high', getNum('quality_audio_1080p_excellent', DEFAULT_AUDIO_THRESHOLDS['1080p'].high)),
        },
        '4K': {
          medium: getNum('quality_audio_4k_medium', getNum('quality_audio_4k_good', DEFAULT_AUDIO_THRESHOLDS['4K'].medium)),
          high: getNum('quality_audio_4k_high', getNum('quality_audio_4k_excellent', DEFAULT_AUDIO_THRESHOLDS['4K'].high)),
        },
      }

      // Load efficiency target thresholds
      this.efficiencyThresholds = {
        'SD': getNum('quality_efficiency_sd_target', DEFAULT_EFFICIENCY_TARGETS.SD),
        '720p': getNum('quality_efficiency_720p_target', DEFAULT_EFFICIENCY_TARGETS['720p']),
        '1080p': getNum('quality_efficiency_1080p_target', DEFAULT_EFFICIENCY_TARGETS['1080p']),
        '4K': getNum('quality_efficiency_4k_target', DEFAULT_EFFICIENCY_TARGETS['4K']),
      }

      // Load bloat start thresholds
      this.bloatThresholds = {
        'SD': getNum('quality_efficiency_sd_bloat', DEFAULT_BLOAT_THRESHOLDS.SD),
        '720p': getNum('quality_efficiency_720p_bloat', DEFAULT_BLOAT_THRESHOLDS['720p']),
        '1080p': getNum('quality_efficiency_1080p_bloat', DEFAULT_BLOAT_THRESHOLDS['1080p']),
        '4K': getNum('quality_efficiency_4k_bloat', DEFAULT_BLOAT_THRESHOLDS['4K']),
      }

      // Load codec efficiency multipliers
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

      // Load video/audio weight
      const rawWeight = getNum('quality_video_weight', 70)
      this.videoWeight = Math.max(0, Math.min(100, rawWeight)) / 100

      // Load efficiency trash threshold
      this.efficiencyTrashThreshold = getNum('quality_efficiency_trash_threshold', 60)

      // Load efficiency allowances
      this.losslessAudioAllowance = getNum('quality_efficiency_lossless_allowance', 4000)
      this.hdrOverheadMultiplier = getNum('quality_efficiency_hdr_overhead', 1.10)

      // Load music quality thresholds
      this.musicThresholds = {
        lowBitrate: getNum('quality_music_low_bitrate', DEFAULT_MUSIC_THRESHOLDS.lowBitrate),
        highBitrate: getNum('quality_music_high_bitrate', DEFAULT_MUSIC_THRESHOLDS.highBitrate),
        hiResSampleRate: getNum('quality_music_hires_samplerate', DEFAULT_MUSIC_THRESHOLDS.hiResSampleRate),
        hiResBitDepth: getNum('quality_music_hires_bitdepth', DEFAULT_MUSIC_THRESHOLDS.hiResBitDepth),
      }

      this.thresholdsLoaded = true
    } catch (error) {
      getLoggingService().error('[QualityAnalyzer]', 'Failed to load quality thresholds:', error)
    }
  }

  /**
   * Force reload of thresholds from database (call when settings change)
   */
  invalidateThresholdsCache(): void {
    this.thresholdsLoaded = false
  }

  /**
   * Get codec efficiency multiplier
   */
  private getCodecEfficiency(codec: string): number {
    const codecLower = codec.toLowerCase()
    for (const [key, efficiency] of Object.entries(this.codecEfficiency)) {
      if (codecLower.includes(key)) return efficiency
    }
    return 1.0
  }

  /**
   * Calculate total bitrate of audio tracks that are dubs (not original language).
   */
  private calculateDubBitrate(item: MediaItem): number {
    if (!item.audio_tracks || !item.original_language) return 0

    try {
      const tracks: AudioTrack[] = JSON.parse(item.audio_tracks)
      if (!Array.isArray(tracks)) return 0

      const origLang = item.original_language.toLowerCase()
      let dubBitrate = 0

      for (const track of tracks) {
        if (track.language) {
          const trackLang = track.language.toLowerCase()
          // If language is known and NOT the original language, it's a dub
          if (trackLang !== origLang && trackLang !== 'und' && trackLang !== 'unk') {
            dubBitrate += track.bitrate || 0
          }
        }
      }

      return dubBitrate
    } catch {
      return 0
    }
  }

  /**
   * Detect lossless audio codec
   */
  private isLosslessAudio(codec: string): boolean {
    const lossless = ['truehd', 'dts-hd ma', 'dtshd_ma', 'flac', 'alac', 'pcm']
    const codecLower = codec.toLowerCase()
    return lossless.some(lc => codecLower.includes(lc))
  }

  /**
   * Calculate audio quality score for ranking tracks
   * Higher score = better quality
   */
  private calculateAudioTrackQualityScore(track: AudioTrack): number {
    let score = 0
    const channels = track.channels || 2
    const bitrate = track.bitrate || 0
    const isLossless = this.isLosslessAudio(track.codec)

    // Sanity check: lossy tracks with suspiciously low bitrate per channel are likely
    // corrupt or placeholder tracks — skip codec/channel bonuses entirely
    const minBitratePerChannel = 32 // kbps — real AC3 5.1 is 64+ per channel
    const isSuspiciouslyLow = !isLossless && !track.hasObjectAudio &&
      bitrate > 0 && bitrate < channels * minBitratePerChannel

    if (isSuspiciouslyLow) {
      // Only score on raw bitrate — no codec/channel bonuses
      return bitrate
    }

    // Object audio (Atmos, DTS:X) gets highest priority
    if (track.hasObjectAudio) {
      score += 10000
    }

    // Lossless codecs get high priority
    if (isLossless) {
      score += 5000
    }

    // Premium lossy codecs
    const codecLower = track.codec.toLowerCase()
    if (codecLower.includes('eac3') || codecLower.includes('e-ac-3') || codecLower.includes('dd+')) {
      score += 3000
    } else if (codecLower.includes('ac3') || codecLower.includes('ac-3') || codecLower.includes('dts')) {
      score += 2000
    } else if (codecLower.includes('aac')) {
      score += 1000
    }

    // More channels = better (7.1 > 5.1 > stereo)
    score += channels * 100

    // Higher bitrate = better
    score += bitrate

    return score
  }

  /**
   * Find the best audio track from media data.
   * Returns the track with highest quality score, or fallback to primary audio fields.
   */
  private getBestAudioTrack(input: QualityScoringInput): {
    codec: string
    channels: number
    bitrate: number
    hasObjectAudio: boolean
  } {
    // Default to the primary audio fields
    const fallback = {
      codec: input.audio_codec || '',
      channels: input.audio_channels || 2,
      bitrate: input.audio_bitrate || 0,
      hasObjectAudio: input.has_object_audio || false,
    }

    // Try to parse audio_tracks
    if (!input.audio_tracks) {
      return fallback
    }

    try {
      const tracks: AudioTrack[] = JSON.parse(input.audio_tracks)
      if (!Array.isArray(tracks) || tracks.length === 0) {
        return fallback
      }

      // Filter out commentary tracks for best-track selection
      const nonCommentary = tracks.filter(t => !t.title?.toLowerCase().includes('commentary'))
      const candidates = nonCommentary.length > 0 ? nonCommentary : tracks

      // Find the track with the highest quality score
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
        codec: bestTrack.codec || fallback.codec,
        channels: bestTrack.channels || fallback.channels,
        bitrate: bestTrack.bitrate || fallback.bitrate,
        hasObjectAudio: bestTrack.hasObjectAudio || false,
      }
    } catch (e) {
      // JSON parse failed, return fallback
      return fallback
    }
  }

  /**
   * Calculate continuous video tier score (0-100) based on effective bitrate
   * relative to the tier's medium/high thresholds
   */
  private calculateVideoTierScore(effectiveBitrate: number, tier: QualityTier): number {
    if (effectiveBitrate <= 0) return 0
    const { medium, high } = this.videoThresholds[tier]
    if (effectiveBitrate >= high) return 100
    if (effectiveBitrate < medium) {
      return Math.round((effectiveBitrate / medium) * 50)
    }
    return 50 + Math.round(((effectiveBitrate - medium) / (high - medium)) * 49)
  }

  /**
   * Calculate continuous audio tier score (0-100) from audio characteristics.
   * Pure bitrate-based scoring against tier thresholds — no codec bonuses.
   */
  private calculateAudioTierScore(
    bestAudio: { codec: string; channels: number; bitrate: number; hasObjectAudio: boolean },
    tier: QualityTier
  ): number {
    // Object audio = perfect
    if (bestAudio.hasObjectAudio) return 100
    // Lossless = perfect
    if (this.isLosslessAudio(bestAudio.codec)) return 100

    if (bestAudio.bitrate <= 0) return 0

    const { medium, high } = this.audioThresholds[tier]
    if (bestAudio.bitrate >= high) return 100
    if (bestAudio.bitrate < medium) {
      return Math.round((bestAudio.bitrate / medium) * 50)
    }
    return 50 + Math.round(((bestAudio.bitrate - medium) / (high - medium)) * 49)
  }

  /**
   * Format bitrate for display - uses kbps for low values, Mbps for high values
   */
  private formatBitrate(kbps: number): string {
    if (kbps >= 1000) {
      return `${(kbps / 1000).toFixed(1)} Mbps`
    }
    return `${kbps} kbps`
  }

  /**
   * Core quality scoring logic shared by analyzeMediaItem and analyzeVersion.
   */
  private scoreQuality(input: QualityScoringInput): {
    qualityTier: QualityTier
    tierQuality: TierQuality
    tierScore: number
    bitrateTierScore: number
    audioTierScore: number
    effectiveBitrate: number
    bestAudio: { codec: string; channels: number; bitrate: number; hasObjectAudio: boolean }
  } {
    const qualityTier = this.classifyTier(input.resolution || 'SD', input.height || 0)
    const codecEfficiency = this.getCodecEfficiency(input.video_codec || '')
    const effectiveBitrate = (input.video_bitrate || 0) * codecEfficiency

    const bestAudio = this.getBestAudioTrack(input)
    const bitrateTierScore = this.calculateVideoTierScore(effectiveBitrate, qualityTier)
    const audioTierScore = this.calculateAudioTierScore(bestAudio, qualityTier)
    const tierScore = Math.round(bitrateTierScore * this.videoWeight + audioTierScore * (1 - this.videoWeight))
    // Derive tier quality from weighted score, not from worst-of video/audio
    const tierQuality: TierQuality = tierScore >= 75 ? 'HIGH' : tierScore >= 50 ? 'MEDIUM' : 'LOW'
    return { qualityTier, tierQuality, tierScore, bitrateTierScore, audioTierScore, effectiveBitrate, bestAudio }
  }

  /**
   * Analyze a media item version and return lightweight quality scores.
   * Used during scan and retroactive analysis to populate per-version quality data.
   */
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

  /**
   * Analyze a single media item and calculate quality scores
   */
  async analyzeMediaItem(mediaItem: MediaItem): Promise<QualityScore> {
    const { qualityTier, tierQuality, tierScore, bitrateTierScore, audioTierScore, effectiveBitrate, bestAudio } =
      this.scoreQuality(mediaItem as any)

    // Efficiency Metrics
    const efficiencyScore = this.calculateEfficiencyScore(mediaItem, qualityTier)
    const storageDebtBytes = this.calculateStorageDebt(mediaItem, qualityTier)

    // Identify issues
    const issues: string[] = []
    const { medium: mediumThreshold } = this.videoThresholds[qualityTier]

    const codecEfficiency = this.getCodecEfficiency(mediaItem.video_codec || '')
    if (effectiveBitrate < mediumThreshold && (mediaItem.video_bitrate || 0) > 0) {
      const codecName = codecEfficiency > 1.0 ? ` (${mediaItem.video_codec})` : ''
      issues.push(
        `Low bitrate for ${qualityTier}: ${this.formatBitrate(mediaItem.video_bitrate || 0)}${codecName}`
      )
    } else if ((mediaItem.video_bitrate || 0) === 0) {
      issues.push(`Bitrate unknown for ${qualityTier}`)
    }

    if (storageDebtBytes > 2 * 1024 * 1024 * 1024) { // > 2GB debt
      const debtGb = (storageDebtBytes / (1024 * 1024 * 1024)).toFixed(1)
      issues.push(`Bloated file: ${debtGb} GB potential savings via modern codec`)
    } else if (efficiencyScore < this.efficiencyTrashThreshold && efficiencyScore > 0) {
      issues.push(`Low efficiency score (${efficiencyScore}%): bitrate is high for this tier`)
    }

    // HDR missing for 4K
    if (qualityTier === '4K' && (!mediaItem.hdr_format || mediaItem.hdr_format === 'None')) {
      issues.push('4K content without HDR')
    }

    // 8-bit for 4K content
    if (qualityTier === '4K' &&
        (!mediaItem.color_bit_depth || mediaItem.color_bit_depth < 10)) {
      issues.push('8-bit color (10-bit recommended)')
    }

    // Audio issues (check best audio track)
    const { medium: audioMedium } = this.audioThresholds[qualityTier]
    if (bestAudio.channels < 2) {
      issues.push(`Mono audio`)
    } else if (bestAudio.channels === 2 && bestAudio.bitrate < audioMedium) {
      issues.push(`Low audio quality: ${bestAudio.bitrate} kbps`)
    }

    // Dubbed audio check
    if (this.calculateDubBitrate(mediaItem) > 500) { // Significant dub bloat
      issues.push(`Dubbed audio bloat: ${this.formatBitrate(this.calculateDubBitrate(mediaItem))} from non-original language tracks`)
    }

    // Determine if needs upgrade (LOW quality only)
    const isLowQuality = tierQuality === 'LOW'
    const needsUpgrade = tierQuality === 'LOW'

    return {
      media_item_id: mediaItem.id || 0,
      quality_tier: qualityTier,
      tier_quality: tierQuality,
      tier_score: tierScore,
      bitrate_tier_score: bitrateTierScore,
      audio_tier_score: audioTierScore,
      overall_score: tierScore,
      resolution_score: qualityTier === '4K' ? 100 : qualityTier === '1080p' ? 80 : qualityTier === '720p' ? 60 : 40,
      bitrate_score: bitrateTierScore,
      audio_score: audioTierScore,
      efficiency_score: efficiencyScore,
      storage_debt_bytes: storageDebtBytes,
      is_low_quality: isLowQuality,
      needs_upgrade: needsUpgrade,
      issues: JSON.stringify(issues),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }
  }

  /**
   * Calculate Efficiency Score (0-100) based on grounded tier targets.
   * Rewards modern codecs achieving high quality at efficient bitrates.
   * Grants allowances for high-value features (Lossless Audio, HDR, 10-bit).
   * Penalizes over-encoding (bloat) beyond visually transparent thresholds.
   */
  private calculateEfficiencyScore(item: MediaItem, tier: QualityTier): number {
    const bitrate = item.video_bitrate || 0
    if (bitrate === 0) return 0

    const efficiencyMult = this.getCodecEfficiency(item.video_codec || '')
    const isLossless = this.isLosslessAudio(item.audio_codec || '') || (item.audio_tracks?.toLowerCase().includes('truehd') || item.audio_tracks?.toLowerCase().includes('dts-hd'))
    const isHdr = item.hdr_format && item.hdr_format !== 'None'
    const is10Bit = item.color_bit_depth && item.color_bit_depth >= 10

    // Deduct audio allowance from bitrate for analysis (don't penalize high-quality audio)
    const audioAllowance = isLossless ? this.losslessAudioAllowance : 0
    // Penalize dubs: bitrates from non-original language tracks are considered pure bloat
    const analysisBitrate = Math.max(500, bitrate - audioAllowance + this.calculateDubBitrate(item))

    const effectiveBitrate = analysisBitrate * efficiencyMult
    const targetKbps = this.efficiencyThresholds[tier]

    // HDR requires slightly more bitrate for the same visual transparency
    const bloatKbps = this.bloatThresholds[tier] * (isHdr ? this.hdrOverheadMultiplier : 1.0)

    let score = 0

    // 1. Perfect efficiency: achieves HIGH quality target with modern codec
    if (analysisBitrate <= targetKbps && efficiencyMult >= 2.0) {
      score = 100
    }
    // 2. Good efficiency: achieves target quality but slightly higher bitrate or older codec
    else if (effectiveBitrate <= targetKbps) {
      score = Math.round(100 - (Math.max(0, analysisBitrate - targetKbps) / targetKbps) * 15)
    }
    // 3. Diminishing returns: bitrate exceeds efficient target but below bloat threshold
    else if (analysisBitrate <= bloatKbps) {
      const range = bloatKbps - targetKbps
      const offset = analysisBitrate - targetKbps
      score = Math.round(85 - (offset / range) * 25) // Drops from 85 to 60
    }
    // 4. Bloated: bitrate exceeds the visually transparent limit
    else {
      const overage = analysisBitrate - bloatKbps
      score = Math.max(0, Math.round(60 - (overage / bloatKbps) * 100))
    }

    // 10-bit bonus: 10-bit is more efficient at preventing artifacts
    if (is10Bit && score < 100 && score > 0) {
      score = Math.min(100, score + 5)
    }

    return score
  }

  /**
   * Calculate Storage Debt in bytes.
   * Identifies potential savings if the file were re-encoded to an efficient HIGH quality HEVC target.
   * Factors in allowances for lossless audio and HDR.
   */
  private calculateStorageDebt(item: MediaItem, tier: QualityTier): number {
    if (!item.file_size || !item.duration) return 0

    const isLossless = this.isLosslessAudio(item.audio_codec || '') || (item.audio_tracks?.toLowerCase().includes('truehd') || item.audio_tracks?.toLowerCase().includes('dts-hd'))
    const isHdr = item.hdr_format && item.hdr_format !== 'None'

    // Efficient target for this tier
    let targetKbps = this.efficiencyThresholds[tier]

    // Add allowances to the target (so we don't count these high-value bits as debt)
    if (isLossless) targetKbps += this.losslessAudioAllowance
    if (isHdr) targetKbps *= this.hdrOverheadMultiplier

    const durationSec = item.duration / 1000
    // Target size = (Target Bitrate * 1000 * Duration) / 8 bits
    const targetSizeBytes = (targetKbps * 1000 * durationSec) / 8

    // Debt only exists if current file is > 20% larger than target AND at least 500MB difference
    const bufferMult = 1.2
    if (item.file_size <= targetSizeBytes * bufferMult) return 0
    if (item.file_size - targetSizeBytes < 500 * 1024 * 1024) return 0

    return Math.round(item.file_size - targetSizeBytes)
  }

  /**
   * Classify media into quality tier using resolution string
   */
  private classifyTier(resolution: string, height?: number): QualityTier {
    const resLower = resolution.toLowerCase()

    if (resLower.includes('4k') || resLower.includes('2160p')) {
      return '4K'
    }
    if (resLower.includes('1080p') || resLower.includes('1080i')) {
      return '1080p'
    }
    if (resLower.includes('720p') || resLower.includes('720i')) {
      return '720p'
    }

    // Parse WxH format (e.g., "1920x1080")
    const wxhMatch = resolution.match(/(\d+)\s*x\s*(\d+)/i)
    if (wxhMatch) {
      const h = parseInt(wxhMatch[2], 10)
      if (h >= 2160) return '4K'
      if (h >= 1080) return '1080p'
      if (h >= 720) return '720p'
      return 'SD'
    }

    // Fallback to height field if available
    if (height) {
      if (height >= 2160) return '4K'
      if (height >= 1080) return '1080p'
      if (height >= 720) return '720p'
    }

    return 'SD'
  }

  /**
   * Analyze all media items in the database
   */
  async analyzeAllMediaItems(
    onProgress?: (current: number, total: number) => void
  ): Promise<number> {
    const db = getDatabase()
    const mediaItems = db.getMediaItems()

    let analyzed = 0
    const tierCounts: Record<string, number> = {}
    const qualityCounts: Record<string, number> = {}

    getLoggingService().verbose('[QualityAnalyzer]', `Starting analysis of ${mediaItems.length} items`)

    for (const item of mediaItems) {
      try {
        const qualityScore = await this.analyzeMediaItem(item)
        await db.upsertQualityScore(qualityScore)

        // Track distribution for verbose summary
        const tier = qualityScore.quality_tier || 'SD'
        const quality = qualityScore.tier_quality || 'MEDIUM'
        tierCounts[tier] = (tierCounts[tier] || 0) + 1
        qualityCounts[quality] = (qualityCounts[quality] || 0) + 1

        // Score individual versions and update best version selection
        if (item.id && item.version_count && item.version_count > 1) {
          const versions = db.getMediaItemVersions(item.id)
          for (const version of versions) {
            if (version.id) {
              const vScore = this.analyzeVersion(version)
              db.updateMediaItemVersionQuality(version.id, vScore)
            }
          }
          db.updateBestVersion(item.id)
        }

        analyzed++

        if (onProgress) {
          onProgress(analyzed, mediaItems.length)
        }
      } catch (error) {
        getLoggingService().error('[QualityAnalyzer]', `Failed to analyze item ${item.id}:`, error)
      }
    }

    const tierSummary = Object.entries(tierCounts).map(([t, c]) => `${t}:${c}`).join(', ')
    const qualSummary = Object.entries(qualityCounts).map(([q, c]) => `${q}:${c}`).join(', ')
    getLoggingService().verbose('[QualityAnalyzer]',
      `Analysis complete: ${analyzed}/${mediaItems.length} items — Tiers: ${tierSummary} — Quality: ${qualSummary}`)

    return analyzed
  }

  /**
   * Get quality summary statistics
   */
  getQualityDistribution(): {
    byTier: {
      [tier: string]: { low: number; medium: number; high: number }
    }
    byQuality: {
      low: number
      medium: number
      high: number
    }
  } {
    const db = getDatabase()
    const scores = db.getQualityScores()

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
      const tier = (score.quality_tier || 'SD') as QualityTier
      const quality = (score.tier_quality || 'MEDIUM').toLowerCase() as 'low' | 'medium' | 'high'

      if (distribution.byTier[tier]) {
        distribution.byTier[tier][quality]++
      }
      distribution.byQuality[quality]++
    })

    return distribution
  }

  /**
   * Get recommended format for upgrade based on current quality
   */
  getRecommendedFormat(mediaItem: MediaItem, currentScore: number): string {
    const height = mediaItem.height || 0
    if (height >= 2160 && currentScore >= 90) {
      return 'No upgrade needed'
    }
    if (height >= 1080 && currentScore < 80) {
      return '4K UHD Blu-ray'
    }
    if (height < 1080) {
      return 'Blu-ray'
    }
    return 'Blu-ray'
  }

  // ============================================================================
  // MUSIC QUALITY ANALYSIS
  // ============================================================================

  /**
   * Analyze a music album's quality
   */
  analyzeMusicAlbum(album: MusicAlbum, tracks: MusicTrack[]): MusicQualityScore {
    const issues: string[] = []

    const qualityTier = this.determineMusicQualityTier(album, tracks)
    const codecScore = this.calculateMusicCodecScore(album, tracks)
    const bitrateScore = this.calculateMusicBitrateScore(album, qualityTier)
    const tierScore = Math.round((codecScore + bitrateScore) / 2)

    // Determine tier quality based on tier score
    let tierQuality: 'LOW' | 'MEDIUM' | 'HIGH'
    if (tierScore >= 75) {
      tierQuality = 'HIGH'
    } else if (tierScore >= 40) {
      tierQuality = 'MEDIUM'
    } else {
      tierQuality = 'LOW'
    }

    if (qualityTier === 'LOSSY_LOW') {
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

    const needsUpgrade = qualityTier === 'LOSSY_LOW' ||
      qualityTier === 'LOSSY_MID'

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
    const hasHiRes = tracks.some(t => t.is_hi_res)
    if (hasHiRes) {
      return 'HI_RES'
    }

    const allLossless = tracks.length > 0 && tracks.every(t => t.is_lossless)
    if (allLossless) {
      return 'LOSSLESS'
    }

    const losslessRatio = tracks.length > 0
      ? tracks.filter(t => t.is_lossless).length / tracks.length
      : 0
    if (losslessRatio > 0.5) {
      return 'LOSSLESS'
    }

    const avgBitrate = album.avg_audio_bitrate || 0

    if (avgBitrate >= this.musicThresholds.highBitrate) {
      return 'LOSSY_HIGH'
    } else if (avgBitrate >= this.musicThresholds.lowBitrate) {
      return 'LOSSY_MID'
    } else {
      return 'LOSSY_LOW'
    }
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

    let totalScore = 0
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

      totalScore += codecScore
    }

    return Math.round(totalScore / tracks.length)
  }

  /**
   * Calculate bitrate score for music (0-100)
   */
  private calculateMusicBitrateScore(album: MusicAlbum, tier: MusicQualityTier): number {
    const avgBitrate = album.avg_audio_bitrate || 0

    if (tier === 'HI_RES') {
      return 100
    }
    if (tier === 'LOSSLESS') {
      if (avgBitrate >= 1000) return 100
      if (avgBitrate >= 800) return 90
      if (avgBitrate >= 600) return 80
      return 70
    }

    if (avgBitrate >= 320) return 95
    if (avgBitrate >= 256) return 85
    if (avgBitrate >= 192) return 70
    if (avgBitrate >= 160) return 55
    if (avgBitrate >= 128) return 40
    return 25
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
    }
    return displays[tier] || tier
  }

  /**
   * Get recommended music format for upgrade
   */
  getRecommendedMusicFormat(_album: MusicAlbum, score: MusicQualityScore): string {
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

// Export singleton instance
let analyzerInstance: QualityAnalyzer | null = null

export function getQualityAnalyzer(): QualityAnalyzer {
  if (!analyzerInstance) {
    analyzerInstance = new QualityAnalyzer()
  }
  return analyzerInstance
}
