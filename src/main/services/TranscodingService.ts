
import { spawn } from 'child_process'
import * as fs from 'fs/promises'
import { existsSync } from 'fs'
import { app } from 'electron'
import { APP_CONFIG } from '@main/config'
import { createHash, randomUUID } from 'node:crypto'
import { createReadStream, type Stats } from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { getDatabase } from '@main/database/getDatabase'
import { formatMediaDisplayName } from '@shared/mediaDisplayName'
import { getLoggingService } from '@main/services/LoggingService'
import { getMediaFileAnalyzer } from '@main/services/MediaFileAnalyzer'
import { PathUtils } from '@main/services/utils/PathUtils'
import { GpuDetector, type GpuInfo } from '@main/services/utils/GpuDetector'
import { TranscodeCommandFactory } from './transcoding/TranscodeCommandFactory'
import { validateHdrTranscode } from './transcoding/HdrTranscodingPolicy'
import { buildTranscodingCapabilities, ENCODER_PROBES, getHardwareEncoder, TranscodingCapabilities } from './TranscodingCapabilities'
import type { FileAnalysisResult } from './MediaFileAnalyzer'
import type { StreamSelectionPolicy } from './transcoding/StreamSelectionPlan'
import { buildStreamSelectionPlan, getPlannedAudioStreams, type PlannedAudioStream } from './transcoding/StreamSelectionPlan'
import { MediaPathAuthorization } from './MediaPathAuthorization'
import { TaskType, MediaItem } from '@main/types/database'
import type { QueuedTask } from '@main/types/taskQueue'
import { getStatsCacheService } from './StatsCacheService'
import { getQualityAnalyzer } from './QualityAnalyzer'
import { OptimizationCandidateService, type OptimizationCandidateReason } from './OptimizationCandidateService'
import type { MediaSourceTier } from './transcoding/TrashSourceClassifier'
import { buildCandidateLadder, candidateDeviceKey, candidateFamilyKey, candidateEncodingKey, nextCandidateSearch, getNonDominatedMeasuredCandidates, selectMeasuredCandidate, MeasuredQualityError, MAX_MEASURED_CANDIDATES_PER_PRESET, MEASUREMENT_VERSION, OPTIMIZATION_SEARCH_VERSION, SHOW_PREFLIGHT_SETTING_PREFIX, MEASUREMENT_SETTING_PREFIX, scopedCalibrationEntries, type CachedMeasurement, type CandidateEncodingParameters, type OptimizationQualityProfile, type OptimizationCalibrationEntry } from './MeasuredOptimizationPolicy'
import { readOptimizationCalibrationProfile, writeOptimizationCalibrationProfile } from './OptimizationCalibrationProfile'
import { buildTargetTranscodePlan, validateTargetTranscodeBitrate, type TargetTranscodePlan } from './transcoding/TargetTranscodePlan'
import type { MeasuredCandidate, MeasuredCandidateSample } from './MeasuredOptimizationPolicy'
import { ChildProcessMeasurementRunner, MeasuredOptimizationService, VMAF_MODEL_VERSION, type MeasurementSourcePreparation } from './MeasuredOptimizationService'
import { getErrorMessage } from '@main/services/utils/errorUtils'
import { evaluatePlaybackTarget, getPlaybackTargetContainers, recommendPlaybackTargetContainer, type PlaybackTargetEvaluation, type PlaybackTargetProfile } from '@main/types/playbackTarget'
import { getTaskQueueService } from './TaskQueueService'
import { buildOptimizationSavingsBreakdown, calculateBitrateSavingsBytes, projectMeasuredOutputBytes, projectMeasuredSavingsBytes, sumMeasuredStreamBytes, type OptimizationSavingsCoverage, type OptimizationSavingsOperation } from './OptimizationSavingsService'
import { normalizeAudioCodec, normalizeVideoCodec } from './MediaNormalizer'
import { DEFAULT_OPTIMIZATION_VIDEO_CODEC, getOptimizationVideoCodec, type OptimizationVideoCodec } from './transcoding/OptimizationCodecPolicy'
import { isMeasuredSoftwareEncoder, measuredOptimizationEncoderSpec, verifiedOptimizationDevices } from './transcoding/OptimizationEncoderPolicy'
import { ValidatedFileAnalysisCache } from './transcoding/ValidatedFileAnalysisCache'
import { OperationFileHasher } from './transcoding/OperationFileHasher'
import { fileIdentity, matchesFileIdentity } from './utils/FileIdentity'
import { pruneMeasuredSampleCache } from './transcoding/MeasuredSampleCacheRetention'
import { aggregateShowOptimizationMetrics } from './ShowOptimizationMetricsService'
import { SETTING_KEYS } from '@shared/settingKeys'

export class TranscodeError extends Error {
  constructor(message: string, public readonly exitCode?: number, public readonly stderr?: string) {
    super(message)
    this.name = 'TranscodeError'
  }
}

export interface TranscodeOptions {
  playbackPolicy?: 'allow-transcoding' | 'avoid-video-transcoding' | 'direct-play'
  targetProfileMode?: 'advisory'
  targetCodec?: OptimizationVideoCodec
  streamSelection?: StreamSelectionPolicy
  outputMode?: 'copy' | 'quarantine-replace' | 'replace'
  tempDirectory?: string
  priority?: 'low' | 'normal' | 'high'
  useGpu?: boolean
  encoder?: string
  crf?: number
  preset?: string
  customArgs?: string
  gpuId?: string
  gpuDeviceSelector?: GpuInfo['encoderDeviceSelector']
  transcodingEngine?: 'ffmpeg'
  targetSize?: string
  maxOutputBytes?: number
  optimizationMode?: 'smart' | 'remux_only' | 'transcode'
  qualityProfile?: 'transparent' | 'balanced' | 'maximum_savings'
  encoderPolicy?: 'automatic' | 'hardware' | 'software' | 'compare'
  targetProfileId?: string | null
  targetContainer?: 'mkv' | 'mp4'
  targetContainerSelection?: 'automatic' | 'user-selected'
  targetAudioCodec?: 'aac' | 'ac3' | 'eac3'
  audioConversions?: Array<{ sourceIndex: number; codec: string; bitrateKbps: number }>
  /** Internal: the measurement candidate decodes an FFV1 lossless reference. */
  measurementReferenceInput?: boolean
  targetHdrFormat?: 'SDR' | 'HDR10'
  targetConversion?: TargetTranscodePlan
  /** Internal calibration control; normal optimization uses the configured sample duration. */
  measurementSampleDurationSeconds?: number
  /** Internal calibration control; normal optimization uses the configured search budget. */
  measurementCandidateBudget?: number
  measurementSamplePositions?: readonly number[]
}

function resolveOutputExtension(filePath: string, options: TranscodeOptions): string {
  const container = options.targetConversion?.container ?? options.targetContainer
  return container === 'mp4' ? '.mp4' : container === 'mkv' ? '.mkv' : path.extname(filePath)
}

async function sha256File(filePath: string): Promise<string> {
  const hash = createHash('sha256')
  const stream = createReadStream(filePath)
  for await (const chunk of stream) hash.update(chunk as Buffer)
  return hash.digest('hex')
}

export interface QueuedTranscodePayload {
  batchId?: string
  preflightId?: string
  sourceSize: number
  sourceMtimeMs: number
  sourceSha256?: string
  params?: TranscodingParams
  sourceAnalysis?: FileAnalysisResult
  targetProfile?: PlaybackTargetProfile
  samplePaths?: string[]
  sampleRepresentativeMediaItemId?: number
  capabilityFingerprint?: string
}

export interface TranscodeProgress {
  percent: number
  phase?: string
  fps?: number
  eta?: string
  speed?: string
  status: 'initializing' | 'encoding' | 'muxing' | 'verifying' | 'complete' | 'failed' | 'cancelled'
  error?: string
}

export interface TranscodingParams {
  summary: string
  ffmpegArgs?: string[]
  expectedSizeReduction?: string
  warnings?: string[]
  encoder?: string
  crf?: number
  preset?: string
  measuredCandidate?: MeasuredCandidate
  sourceHdrFormat?: string
  expectedAudioCount?: number
  expectedSubtitleCount?: number
  audioTracks?: FileAnalysisResult['audioTracks']
  subtitleTracks?: FileAnalysisResult['subtitleTracks']
}


export interface ShowTranscodeRequest {
  mediaItemId?: number
  seasonNumber?: number
  representativeMediaItemId?: number
  representativeMediaItemIds?: Record<string, number>
  selectedMediaItemIds?: number[]
  remeasure?: boolean
  seriesTitle?: string
  seriesIdentityKey?: string
  sourceId: string
  libraryId?: string
  options: TranscodeOptions
}

export interface OptimizationDiscoveryGroup {
  id: string
  seasonNumber?: number
  mediaItemIds: number[]
  mediaItemLabels: Record<number, string>
  representativeMediaItemId: number
  representativeLabel: string
  technicalProfile: string
  targetCodec?: OptimizationVideoCodec
  candidateReasons: string[]
  candidateReasonsByMediaItemId: Record<number, string[]>
  estimatedSavingsByMediaItemId: Record<number, number | null>
  estimatedSavingsBytes: number | null
}

export interface OtherOperationCandidate {
  mediaItemId: number
  label: string
  candidateReasons: string[]
  estimatedSavingsBytes: number | null
}

export interface OptimizationCandidateScanSummary {
  candidateCount: number
  estimatedSavingsBytes: number | null
  candidatesWithoutEstimate: number
  reasonCounts: Partial<Record<OptimizationCandidateReason, number>>
}

export interface ShowOptimizationDiscovery {
  candidateCount: number
  groups: OptimizationDiscoveryGroup[]
  otherOperationMediaItemIds: number[]
  otherOperationCandidates: OtherOperationCandidate[]
}

function getPreflightSamplingProfileKey(episode: MediaItem, options: TranscodeOptions, analysis?: FileAnalysisResult): string | undefined {
  const video = analysis?.video
  const seasonNumber = episode.season_number
  const codec = video?.codec ?? episode.video_codec
  const width = video?.width ?? episode.width
  const height = video?.height ?? episode.height
  const bitDepth = video?.bitDepth ?? episode.color_bit_depth
  const frameRate = video?.frameRate ?? episode.video_frame_rate
  const colorSpace = video?.colorSpace ?? episode.color_space
  const rawHdrFormat = video?.hdrFormat ?? episode.hdr_format
  const normalizedHdrFormat = rawHdrFormat?.trim().toLowerCase()
  const knownSdrTransfer = ['bt709', 'smpte170m', 'gamma22', 'gamma28'].includes(video?.colorTransfer?.toLowerCase() ?? '')
  const hdrFormat = normalizedHdrFormat && ['none', 'sdr'].includes(normalizedHdrFormat)
    ? 'sdr'
    : normalizedHdrFormat ?? (colorSpace?.toLowerCase().includes('bt709') || knownSdrTransfer ? 'sdr' : undefined)
  const container = analysis?.container ?? episode.container
  if (!Number.isInteger(seasonNumber) || !codec?.trim() || !width || width <= 0 || !height || height <= 0 || !bitDepth || bitDepth <= 0 || !frameRate || frameRate <= 0 || !hdrFormat || !container?.trim()) return undefined

  const normalizedContainer = container.split(',')[0].trim().toLowerCase()
  const containerFamily = normalizedContainer === 'mkv' || normalizedContainer === 'matroska' ? 'matroska'
    : normalizedContainer === 'm4v' || normalizedContainer === 'mov' || normalizedContainer === 'mp4' ? 'mp4'
      : normalizedContainer
  return JSON.stringify([
    seasonNumber,
    normalizeVideoCodec(codec),
    (video?.profile ?? episode.video_profile ?? '').toLowerCase(),
    video?.level ?? episode.video_level ?? null,
    width,
    height,
    bitDepth,
    Math.round(frameRate * 100) / 100,
    hdrFormat,
    (colorSpace ?? '').toLowerCase(),
    containerFamily,
    options.targetCodec,
    options.encoderPolicy,
    options.gpuId ?? null,
    options.targetConversion && {
      width: options.targetConversion.width,
      height: options.targetConversion.height,
      bitDepth: options.targetConversion.bitDepth,
      hdrFormat: options.targetConversion.hdrFormat,
      videoFilter: options.targetConversion.videoFilter,
    },
  ])
}

function isCompatibleWithPlaybackPolicy(
  policy: NonNullable<TranscodeOptions['playbackPolicy']>,
  evaluation?: PlaybackTargetEvaluation,
): boolean {
  if (policy === 'allow-transcoding') return true
  if (!evaluation) return false
  if (policy === 'direct-play') return evaluation.overall === 'compatible'
  return [evaluation.findings.video, evaluation.findings.hdr, evaluation.findings.network, evaluation.findings.subtitle]
    .every(finding => finding.status !== 'incompatible')
}

export interface QuarantinedShowFile {
  mediaItemId: number
  label: string
  path: string
  size: number
  modifiedAt: string
  owned: boolean
}

function buildAudioConversions(analysis: FileAnalysisResult, options: TranscodeOptions): NonNullable<TranscodeOptions['audioConversions']> {
  if (!options.targetAudioCodec) return []
  const codec = options.targetAudioCodec
  const selected = new Set(buildStreamSelectionPlan(analysis, options).audioStreamIndexes)
  return analysis.audioTracks.flatMap(track => {
    const protectedTrack = track.hasObjectAudio || track.isCommentary || track.isAudioDescription || track.isAccessibility
    if (!selected.has(track.index) || protectedTrack || normalizeAudioCodec(track.codec, track.profile) === normalizeAudioCodec(codec)) return []
    const bitrateKbps = track.channels >= 6 ? APP_CONFIG.transcoding.audioSurroundTargetBitrateKbps : APP_CONFIG.transcoding.audioStereoTargetBitrateKbps
    return [{ sourceIndex: track.index, codec, bitrateKbps }]
  })
}

function estimateAudioConversionSavings(analysis: FileAnalysisResult, conversions: NonNullable<TranscodeOptions['audioConversions']>): number | null {
  if (analysis.durationMs == null || analysis.durationMs <= 0) return null
  let total = 0
  for (const conversion of conversions) {
    const source = analysis.audioTracks.find(track => track.index === conversion.sourceIndex)
    if (source?.bitrateKbps == null || !Number.isFinite(source.bitrateKbps) || source.bitrateKbps <= 0) return null
    total += calculateBitrateSavingsBytes(source.bitrateKbps, conversion.bitrateKbps, analysis.durationMs / 1000)
  }
  return total
}

export type PlannedOptimizationOperation = 'video_transcode' | 'audio_transcode' | 'stream_pruning' | 'subtitle_pruning' | 'container_change'

export interface OptimizationQualityChoice {
  profile: OptimizationQualityProfile
  status: 'available' | 'quality_threshold_unmet' | 'no_positive_savings' | 'incompatible' | 'measurement_incomplete'
  estimatedSavingsBytes?: number
  candidate?: Pick<MeasuredCandidate, 'encoder' | 'preset' | 'quality' | 'outputBytes' | 'sampledDurationSeconds' | 'vmafMean' | 'vmafP5' | 'cambiMean' | 'encodingDurationMs' | 'sourceSelfVmaf' | 'sourceCambiMean' | 'searchSummary'>
  alternatives?: Array<Pick<MeasuredCandidate, 'encoder' | 'preset' | 'quality' | 'outputBytes' | 'sampledDurationSeconds' | 'vmafMean' | 'vmafP5' | 'cambiMean' | 'encodingDurationMs' | 'sourceSelfVmaf' | 'sourceCambiMean'>>
}

function plannedNonVideoBytesPerSecond(analysis: FileAnalysisResult, options: TranscodeOptions): number {
  const plan = buildStreamSelectionPlan(analysis, options)
  const conversions = options.targetConversion?.audio ?? options.audioConversions ?? []
  const durationSeconds = analysis.durationMs! / 1000
  const totalBytes = [...plan.audioStreamIndexes, ...plan.subtitleStreamIndexes].reduce((total, index) => {
    const conversion = conversions.find(track => track.sourceIndex === index)
    const bytes = conversion?.bitrateKbps !== undefined
      ? conversion.bitrateKbps * 1000 * durationSeconds / 8
      : analysis.streamBytes?.[index]
    if (bytes === undefined) throw new Error(`Measured stream byte accounting is required for retained stream ${index}`)
    return total + bytes
  }, 0)
  return totalBytes / durationSeconds
}

function getOptimizationQualityChoices(
  sourceSize: number,
  sourceDurationSeconds: number,
  nonVideoBytesPerSecond: number,
  cachedMeasurement?: CachedMeasurement,
  searchedProfile?: OptimizationQualityProfile,
): OptimizationQualityChoice[] {
  if (!cachedMeasurement) return []
  return (['transparent', 'balanced', 'maximum_savings'] as const).map(profile => {
    if (!cachedMeasurement.complete || profile !== searchedProfile) return { profile, status: 'measurement_incomplete' }
    try {
      const maximumOutputBytesPerSecond = sourceSize / sourceDurationSeconds - nonVideoBytesPerSecond
      const candidate = selectMeasuredCandidate(profile, cachedMeasurement.candidates, maximumOutputBytesPerSecond)
      const alternatives = getNonDominatedMeasuredCandidates(profile, cachedMeasurement.candidates, maximumOutputBytesPerSecond)
      return {
        profile,
        status: 'available',
        estimatedSavingsBytes: projectMeasuredSavingsBytes(sourceSize, sourceDurationSeconds, candidate.outputBytes + nonVideoBytesPerSecond * candidate.sampledDurationSeconds, candidate.sampledDurationSeconds),
        candidate: {
          encoder: candidate.encoder,
          preset: candidate.preset,
          quality: candidate.quality,
          outputBytes: candidate.outputBytes,
          sampledDurationSeconds: candidate.sampledDurationSeconds,
          vmafMean: candidate.vmafMean,
          vmafP5: candidate.vmafP5,
          cambiMean: candidate.cambiMean,
          encodingDurationMs: candidate.encodingDurationMs,
          sourceSelfVmaf: candidate.sourceSelfVmaf,
          sourceCambiMean: candidate.sourceCambiMean,
          searchSummary: candidate.searchSummary,
        },
        alternatives: alternatives.map(alternative => ({
          encoder: alternative.encoder,
          preset: alternative.preset,
          quality: alternative.quality,
          outputBytes: alternative.outputBytes,
          sampledDurationSeconds: alternative.sampledDurationSeconds,
          vmafMean: alternative.vmafMean,
          vmafP5: alternative.vmafP5,
          cambiMean: alternative.cambiMean,
          encodingDurationMs: alternative.encodingDurationMs,
          sourceSelfVmaf: alternative.sourceSelfVmaf,
          sourceCambiMean: alternative.sourceCambiMean,
        })),
      }
    } catch (error) {
      if (!(error instanceof MeasuredQualityError)) throw error
      return { profile, status: error.decisionStatus }
    }
  })
}

export interface ShowTranscodePreflight {
  measurementVersion?: number
  searchVersion?: number
  measurementModel?: string
  preflightId: string
  batchId: string
  createdAt?: string
  seriesTitle: string
  episodeCount: number
  compatible: boolean
  capabilityFingerprint?: string
  userApproved?: boolean
  approvedAt?: string
  approvalFingerprint?: string
  sampleGroupApprovalFingerprints?: Record<string, string>
  approvedSampleGroupIds?: string[]
  episodes: Array<{
    mediaItemId: number
    label: string
    compatible: boolean
    reason?: string
    hdrFormat: string
    sourceSize: number
    sourceMtimeMs: number
    operations: PlannedOptimizationOperation[]
    decisionStatus?: 'actionable' | 'already_optimized' | 'sample_required' | 'insufficient_evidence' | 'incompatible' | 'quality_threshold_unmet' | 'no_positive_savings' | 'no_savings' | 'measurement_failed'
    evidenceStatus?: 'measured' | 'estimated' | 'insufficient'
    savingsCoverage?: OptimizationSavingsCoverage
    confidence?: 'high' | 'medium' | 'low' | 'none'
    estimatedSavingsBytes?: number | null
    qualityChoices?: OptimizationQualityChoice[]
    savingsBasis?: string
    sourceTier?: MediaSourceTier
    adviceReason?: string
    targetCompatibility?: PlaybackTargetEvaluation
    measuredParameters?: Pick<TranscodingParams, 'encoder' | 'crf' | 'preset'> & Pick<TranscodeOptions, 'gpuId'>
    sourceSha256?: string
    options?: TranscodeOptions
    params?: TranscodingParams
    sourceAnalysis?: FileAnalysisResult
    audioPlan?: PlannedAudioStream[]
    sourceCambiMean?: number
    sourceSelfVmaf?: number
    targetProfile?: PlaybackTargetProfile
    samplingRole?: 'measured' | 'projected'
    samplingGroupKey?: string
    sampleRepresentativeMediaItemId?: number
    sampleRepresentativeLabel?: string
    samplePaths?: string[]
    sampleHashes?: string[]
    changes?: string[]
  }>
  estimatedSavingsBytes?: number | null
  savingsCoverage?: OptimizationSavingsCoverage
  savingsBasis?: 'sample_based_projection' | 'mixed_sample_projection' | 'representative_sample_projection' | 'mixed_representative_sample_projection' | 'planned_operations'
  queuedAt?: string
  queuedMediaItemIds?: number[]
  queuedTaskIds?: string[]
}

interface TranscodingCapabilitiesCacheRecord {
  fingerprint: string
  detectedAt: string
  deviceEncoders: Record<string, string[]>
}

export interface ShowTranscodeEpisodeCheckpoint {
  version: 1
  optionsFingerprint: string
  capabilityFingerprint?: string
  plan: ShowTranscodePreflight['episodes'][number]
}

/**
 * TranscodingService
 *
 * Coordinates FFmpeg transcoding from explicit parameters.
 */
export class TranscodingService {
  private static readonly CAPABILITIES_CACHE_KEY = 'transcoding.capabilities.snapshot.v2'
  private activeJobs = new Map<number, { controller: AbortController; committing: boolean }>()
  private initializedPromise: Promise<void> | null = null
  private capabilitiesPromise: Promise<TranscodingCapabilities> | null = null
  private capabilitiesCachedAt = 0
  private analysisCache = new ValidatedFileAnalysisCache<Awaited<ReturnType<ReturnType<typeof getMediaFileAnalyzer>['analyzeFile']>>>()
  private showPreflights = new Map<string, { request: ShowTranscodeRequest; result: ShowTranscodePreflight }>()
  private measuredOptimizationService = new MeasuredOptimizationService()
  private optimizationCandidateService = new OptimizationCandidateService()
  private activePreflights = 0
  private sampleCacheLastPrunedAt = 0
  private sampleCachePrunePromise: Promise<void> | null = null
  private readonly sampleCacheUsers = new Map<string, number>()

  constructor() {
    // Initialization is deferred until first use to allow DB to be ready
  }


  invalidate(): void {
    this.initializedPromise = null
    this.capabilitiesPromise = null
    this.capabilitiesCachedAt = 0
    this.analysisCache.clear()
    this.showPreflights.clear()
    getLoggingService().debug('[TranscodingService]', 'TranscodingService invalidated caches')
  }

  cancel(mediaItemId?: number): boolean {
    return this.cancelTranscode(mediaItemId)
  }

  cancelTranscode(mediaItemId?: number): boolean {
    let cancelled = false
    for (const [id, job] of this.activeJobs) {
      if ((mediaItemId !== undefined && mediaItemId !== id) || job.committing || job.controller.signal.aborted) continue
      job.controller.abort()
      cancelled = true
      getLoggingService().info('[TranscodingService]', `Cancelled transcode job for media item ${id}`)
    }
    return cancelled
  }

  abortAll(): void {
    this.cancelTranscode()
  }

  async discoverShowOptimization(request: ShowTranscodeRequest): Promise<ShowOptimizationDiscovery> {
    if (!request.sourceId.trim()) throw new Error('Source ID is required')
    if (request.mediaItemId === undefined && (!request.seriesTitle?.trim() || !request.seriesIdentityKey?.trim() || !request.libraryId?.trim())) throw new Error('TV series identity and library are required')
    const discoveryStartedAt = performance.now()
    const items: MediaItem[] = request.mediaItemId === undefined
      ? getDatabase().getMediaItems({ type: 'episode', sourceId: request.sourceId, libraryId: request.libraryId })
        .filter(item => item.series_identity_key === request.seriesIdentityKey &&
          (request.seasonNumber === undefined || item.season_number === request.seasonNumber))
      : [getDatabase().getMediaItem(request.mediaItemId)].filter((item): item is MediaItem => item !== null)
    const capabilities = await this.getCapabilities()
    await getQualityAnalyzer().loadThresholdsFromDatabase()
    const av1CodecCapabilities = capabilities.encodingMatrix.codecs.find(codec => codec.codec === 'av1')
    const av1HardwareEncodingAvailable = capabilities.encodingMatrix.devices.some((device, index) =>
      device.kind === 'hardware' && av1CodecCapabilities?.capabilities[index] === true)
    const streamSelection = request.options.streamSelection as {
      audio?: 'all' | 'original-and-protected' | string
      originalLanguage?: string
      subtitleLanguageWhitelist?: string[]
    } | undefined
    const evidence = (await Promise.all(items.map(async item => {
      if (item.id === undefined) return []
      const candidate = await this.optimizationCandidateService.discover(item, {
        av1HardwareEncodingAvailable,
        targetCodec: request.options.targetCodec,
        audioPruningEnabled: streamSelection?.audio === 'original-and-protected',
        originalAudioLanguage: streamSelection?.originalLanguage,
        subtitleLanguageWhitelist: streamSelection?.subtitleLanguageWhitelist ?? [],
      })
      return candidate.reasons.length ? [{ item: item as MediaItem & { id: number }, ...candidate }] : []
    }))).flat()
    const candidateById = new Map(evidence.map(candidate => [candidate.item.id, candidate]))
    const videoCandidates = evidence.filter(candidate => candidate.reasons.includes('h264_video_transcode') || candidate.reasons.includes('hevc_to_av1'))
    const otherOperationCandidates: OtherOperationCandidate[] = evidence
      .filter(candidate => !videoCandidates.some(video => video.item.id === candidate.item.id) && candidate.reasons.some(reason => reason === 'audio_stream_pruning' || reason === 'subtitle_stream_pruning' || reason === 'dolby_vision_profile_5_mp4_remux'))
      .map(candidate => ({
        mediaItemId: candidate.item.id,
        label: candidate.item.title,
        candidateReasons: candidate.reasons.filter(reason => reason !== 'h264_video_transcode' && reason !== 'hevc_to_av1'),
        estimatedSavingsBytes: candidate.estimatedSavingsBytes,
      }))
    const otherOperationMediaItemIds = otherOperationCandidates.map(candidate => candidate.mediaItemId)
    const groups = new Map<string, Array<MediaItem & { id: number }>>()
    for (const candidate of videoCandidates) {
      const item = candidate.item
      const hasBitrate = Number.isFinite(item.video_bitrate_kbps) && item.video_bitrate_kbps! > 0
      const targetCodec = candidate.targetCodec ?? request.options.targetCodec ?? 'hevc'
      const technicalProfile = item.type === 'movie' || !hasBitrate ? undefined : getPreflightSamplingProfileKey(item, { ...request.options, targetCodec })
      const id = `${targetCodec}:${technicalProfile ?? `media-item:${item.id}`}`
      groups.set(id, [...(groups.get(id) ?? []), item])
    }
    const discoveryGroups = [...groups].map(([id, members]) => {
      const ordered = [...members].sort((left, right) => (left.video_bitrate_kbps ?? Number.POSITIVE_INFINITY) - (right.video_bitrate_kbps ?? Number.POSITIVE_INFINITY) || left.id - right.id)
      const bitrates = ordered.map(item => item.video_bitrate_kbps).filter((bitrate): bitrate is number => Number.isFinite(bitrate) && bitrate > 0).sort((left, right) => left - right)
      const medianBitrate = bitrates.length ? bitrates[Math.floor((bitrates.length - 1) / 2)] : undefined
      const representative = medianBitrate === undefined
        ? ordered[0]
        : [...ordered].sort((left, right) => Math.abs((left.video_bitrate_kbps ?? Number.POSITIVE_INFINITY) - medianBitrate) - Math.abs((right.video_bitrate_kbps ?? Number.POSITIVE_INFINITY) - medianBitrate) || left.id - right.id)[0]
      const first = members[0]
      const findings = members.map(member => candidateById.get(member.id)!)
      const reasonCodes = findings[0].reasons.filter(reason => findings.every(finding => finding.reasons.includes(reason)))
      const targetCodec = findings[0].targetCodec
      const hasBitrate = Number.isFinite(first.video_bitrate_kbps) && first.video_bitrate_kbps! > 0
      const technicalProfileKey = first.type === 'movie' || !hasBitrate
        ? undefined
        : getPreflightSamplingProfileKey(first, { ...request.options, targetCodec: targetCodec ?? request.options.targetCodec ?? 'hevc' })
      const savings = findings.map(finding => finding.estimatedSavingsBytes)
      const estimatedSavingsBytes = savings.every(value => value !== null)
        ? savings.reduce<number>((sum, value) => sum + value!, 0)
        : null
      return {
        id,
        seasonNumber: first.type === 'movie' ? undefined : first.season_number ?? undefined,
        mediaItemIds: members.map(item => item.id),
        mediaItemLabels: Object.fromEntries(members.map(item => [item.id, item.title])),
        representativeMediaItemId: representative.id,
        representativeLabel: representative.title,
        targetCodec,
        candidateReasons: reasonCodes,
        candidateReasonsByMediaItemId: Object.fromEntries(findings.map(finding => [finding.item.id, finding.reasons])),
        estimatedSavingsByMediaItemId: Object.fromEntries(findings.map(finding => [finding.item.id, finding.estimatedSavingsBytes])),
        estimatedSavingsBytes,
        technicalProfile: first.type === 'movie' ? 'Film — individual analysis' : !(Number.isFinite(first.video_bitrate_kbps) && first.video_bitrate_kbps! > 0)
          ? 'Saved bitrate unavailable — individual analysis'
          : technicalProfileKey === undefined ? 'Technical profile incomplete — individual analysis'
            : first.width && first.height
          ? `${first.width}×${first.height} · ${first.video_codec ?? 'H.264'} · ${first.color_bit_depth ?? 'unknown'}-bit`
          : 'Technical profile incomplete — individual analysis',
      }
    })
    getLoggingService().info('[TVOptimization]', 'Metadata-only optimization discovery completed', {
      sourceId: request.sourceId,
      libraryId: request.libraryId,
      seriesIdentityKey: request.seriesIdentityKey,
      seasonNumber: request.seasonNumber,
      scopedItemCount: items.length,
      candidateCount: evidence.length,
      groupCount: discoveryGroups.length,
      durationMs: Math.round(performance.now() - discoveryStartedAt),
      groups: discoveryGroups.map(group => ({ id: group.id, memberIds: group.mediaItemIds, representativeMediaItemId: group.representativeMediaItemId })),
      otherOperationMediaItemIds,
    })
    return { candidateCount: evidence.length, groups: discoveryGroups, otherOperationMediaItemIds, otherOperationCandidates }
  }

  async discoverLibraryOptimizationCandidates(sourceId: string, libraryId: string): Promise<OptimizationCandidateScanSummary> {
    if (!sourceId.trim() || !libraryId.trim()) throw new Error('Source and library are required for optimization candidate discovery')
    const database = getDatabase()
    return this.summarizeOptimizationCandidates(database.media.getItems({ sourceId, libraryId }))
  }

  async discoverSourceOptimizationCandidates(sourceId: string): Promise<OptimizationCandidateScanSummary> {
    if (!sourceId.trim()) throw new Error('Source is required for optimization candidate discovery')
    return this.summarizeOptimizationCandidates(getDatabase().media.getItems({ sourceId }))
  }

  private async summarizeOptimizationCandidates(items: MediaItem[]): Promise<OptimizationCandidateScanSummary> {
    const capabilities = await this.getCapabilities()
    await getQualityAnalyzer().loadThresholdsFromDatabase()
    const av1CodecCapabilities = capabilities.encodingMatrix.codecs.find(codec => codec.codec === 'av1')
    const av1HardwareEncodingAvailable = capabilities.encodingMatrix.devices.some((device, index) =>
      device.kind === 'hardware' && av1CodecCapabilities?.capabilities[index] === true)
    const qualityAnalyzer = getQualityAnalyzer()
    const subtitleLanguageWhitelist = await qualityAnalyzer.getSubtitleLanguageWhitelist()
    const reasonCounts: OptimizationCandidateScanSummary['reasonCounts'] = {}
    const candidates = (await Promise.all(items.map(async item => {
      const candidate = await this.optimizationCandidateService.discover(item, {
        av1HardwareEncodingAvailable,
        targetCodec: DEFAULT_OPTIMIZATION_VIDEO_CODEC,
        audioPruningEnabled: true,
        originalAudioLanguage: item.original_language ?? undefined,
        subtitleLanguageWhitelist,
      })
      if (candidate.reasons.length === 0) return []
      for (const reason of candidate.reasons) reasonCounts[reason] = (reasonCounts[reason] ?? 0) + 1
      return [candidate]
    }))).flat()
    const measuredSavings = candidates.map(candidate => candidate.estimatedSavingsBytes).filter((value): value is number => value !== null)
    return {
      candidateCount: candidates.length,
      estimatedSavingsBytes: measuredSavings.length === candidates.length
        ? measuredSavings.reduce((total, value) => total + value, 0)
        : null,
      candidatesWithoutEstimate: candidates.length - measuredSavings.length,
      reasonCounts,
    }
  }

  /** At most once per day, prune old completed or orphaned sample artifacts.
   * Cached files referenced by reviews or active work must remain available.
   */
  private async pruneMeasuredSamples(failOnError = false): Promise<void> {
    if (this.activePreflights > 0) return
    if (Date.now() - this.sampleCacheLastPrunedAt < APP_CONFIG.transcoding.measuredSampleCache.pruneIntervalMs) return
    if (this.sampleCachePrunePromise) return this.sampleCachePrunePromise
    const prune = (async () => {
      const db = getDatabase()
      const root = path.join(app.getPath('userData'), 'transcoding-samples', 'cache')
      const [records, reviews] = await Promise.all([
        db.getSettingsByPrefix(MEASUREMENT_SETTING_PREFIX),
        db.getSettingsByPrefix(SHOW_PREFLIGHT_SETTING_PREFIX),
      ])
      const protectedKeys = new Set<string>()
      const retainPath = (samplePath: string) => {
        const relative = path.relative(root, path.resolve(samplePath))
        if (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative)) {
          const key = relative.split(path.sep)[0]
          if (/^[a-f0-9]{64}$/.test(key)) protectedKeys.add(key)
        }
      }
      for (const raw of Object.values(reviews)) {
        // Corrupt reviews are not proof samples are unused. Fail closed.
        const review = JSON.parse(raw) as { result?: { episodes?: Array<{ samplePaths?: string[]; sourceAnalysis?: { optimizationMeasurement?: { cacheKey?: string } } }> } }
        if (!Array.isArray(review.result?.episodes)) throw new Error('Unrecognized stored review; sample-cache eviction deferred')
        for (const episode of review.result.episodes) {
          const key = episode.sourceAnalysis?.optimizationMeasurement?.cacheKey
          if (key) protectedKeys.add(key)
          for (const sample of episode.samplePaths ?? []) retainPath(sample)
        }
      }
      for (const task of getTaskQueueService().getTasks()) {
        const samples = (task.options as TranscodeOptions & { queuePayload?: QueuedTranscodePayload } | undefined)?.queuePayload?.samplePaths
        for (const sample of samples ?? []) retainPath(sample)
      }
      const removed = await pruneMeasuredSampleCache({
        root, records, protectedKeys,
        settingPrefix: MEASUREMENT_SETTING_PREFIX,
        deleteRecord: async key => { await db.deleteSetting(key) },
        isActive: key => this.activePreflights > 0 || (this.sampleCacheUsers.get(key) ?? 0) > 0,
      })
      this.sampleCacheLastPrunedAt = Date.now()
      if (removed.removed) getLoggingService().info('[TVOptimization]', `Pruned ${removed.removed} unused sample-cache entries (${removed.reclaimedBytes} bytes)`)
    })().catch(error => {
      getLoggingService().warn('[TVOptimization]', `Sample-cache retention deferred: ${getErrorMessage(error)}`)
      if (failOnError) throw error
    }).finally(() => {
      this.sampleCachePrunePromise = null
    })
    this.sampleCachePrunePromise = prune
    return this.sampleCachePrunePromise
  }

  async cleanupMeasuredSamples(): Promise<void> {
    if (this.activePreflights > 0 || this.activeJobs.size > 0) throw new Error('Optimization artifacts cannot be cleaned while an optimization review or execution is running')
    const activeOptimizationTask = getTaskQueueService().getTasks().find(task => task.type === 'optimization-preflight' || task.type === 'optimization-calibration')
    if (activeOptimizationTask) throw new Error(`Optimization artifacts cannot be cleaned while ${activeOptimizationTask.label.toLowerCase()} is running`)
    if (this.sampleCachePrunePromise) await this.sampleCachePrunePromise
    const db = getDatabase()
    const root = path.resolve(app.getPath('userData'), 'transcoding-samples')
    const cacheRoot = path.join(root, 'cache')
    const records = await db.getSettingsByPrefix(MEASUREMENT_SETTING_PREFIX)
    const removedCache = await pruneMeasuredSampleCache({
      root: cacheRoot,
      records,
      protectedKeys: new Set(),
      settingPrefix: MEASUREMENT_SETTING_PREFIX,
      deleteRecord: async key => { await db.deleteSetting(key) },
      isActive: key => (this.sampleCacheUsers.get(key) ?? 0) > 0,
      force: true,
    })
    let removedTransientEntries = 0
    try {
      const entries = await fs.readdir(root, { withFileTypes: true })
      for (const entry of entries) {
        await fs.rm(path.join(root, entry.name), { recursive: true, force: true })
        removedTransientEntries += 1
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    const settings = await db.getAllSettings()
    const artifactSettingPrefixes = [
      MEASUREMENT_SETTING_PREFIX,
      SHOW_PREFLIGHT_SETTING_PREFIX,
      'optimization.calibration.',
      'transcoding.backgroundPreflight.',
      'transcoding.preflightCheckpoint.',
    ]
    const artifactSettings = Object.keys(settings).filter(key => artifactSettingPrefixes.some(prefix => key.startsWith(prefix)))
    for (const key of artifactSettings) await db.deleteSetting(key)
    await this.saveOptimizationCalibration([])
    this.showPreflights.clear()
    this.sampleCacheUsers.clear()
    this.sampleCacheLastPrunedAt = 0
    getLoggingService().info('[TVOptimization]', 'Optimization artifacts cleaned', {
      cacheEntries: removedCache.removed,
      reclaimedBytes: removedCache.reclaimedBytes,
      transientEntries: removedTransientEntries,
      settings: artifactSettings.length,
    })
  }

  async saveOptimizationCalibration(entries: OptimizationCalibrationEntry[]): Promise<void> {
    await writeOptimizationCalibrationProfile(path.join(app.getPath('userData'), 'optimization-profile.json'), entries)
  }

  private async loadOptimizationCalibration(): Promise<OptimizationCalibrationEntry[]> {
    return readOptimizationCalibrationProfile(path.join(app.getPath('userData'), 'optimization-profile.json'))
  }

  async preflightShowTranscode(request: ShowTranscodeRequest, operation?: {
    signal: AbortSignal
    beginCommit: () => void
    waitUntilRunning: () => Promise<void>
    update: (update: { phase?: string; progress?: { percentage?: number; current?: number; total?: number; currentItem?: string } }) => void
    preflightId?: string
    batchId?: string
    loadEpisodeCheckpoint?: (mediaItemId: number) => Promise<ShowTranscodeEpisodeCheckpoint | undefined>
    saveEpisodeCheckpoint?: (mediaItemId: number, checkpoint: ShowTranscodeEpisodeCheckpoint) => Promise<void>
    calibration?: boolean
    parameterPreview?: boolean
    onMeasuredCandidates?: (candidates: MeasuredCandidate[], complete: boolean, calibrationScopeKey?: string, maximumRate?: number, rateLimit?: number) => Promise<void>
  }): Promise<ShowTranscodePreflight> {
    // Run cache maintenance after preflight, never on the critical response path.
    // If a prior maintenance sweep is deleting entries, wait for it before reading.
    if (this.sampleCachePrunePromise) await this.sampleCachePrunePromise
    this.activePreflights++
    try {
    operation?.signal.throwIfAborted()
    if (!request.sourceId.trim()) throw new Error('Source ID is required')
    if (request.mediaItemId === undefined && (!request.seriesTitle?.trim() || !request.seriesIdentityKey?.trim() || !request.libraryId?.trim())) throw new Error('TV series identity and library are required')
    const profileId = request.options.targetProfileId === undefined
      ? await getDatabase().getSetting('optimization_default_target_profile_id')
      : request.options.targetProfileId
    const targetProfile = profileId == null ? undefined : (await getDatabase().playbackTargetProfiles.get(profileId) ?? undefined)
    if (profileId != null && !targetProfile) throw new Error(`Playback target profile ${profileId} was not found`)
    if (!targetProfile && request.options.targetHdrFormat && request.options.optimizationMode !== 'remux_only') throw new Error('HDR format conversion requires a selected playback target.')
    const scopedItems: MediaItem[] = request.mediaItemId === undefined
      ? getDatabase().getMediaItems({ type: 'episode', sourceId: request.sourceId, libraryId: request.libraryId })
        .filter(item => item.series_identity_key === request.seriesIdentityKey &&
          (request.seasonNumber === undefined || item.season_number === request.seasonNumber))
      : [getDatabase().getMediaItem(request.mediaItemId)].filter((item): item is MediaItem => item !== null)
    const selectedMediaItemIds = request.selectedMediaItemIds === undefined ? undefined : new Set(request.selectedMediaItemIds)
    const episodes = selectedMediaItemIds ? scopedItems.filter(item => item.id !== undefined && selectedMediaItemIds.has(item.id)) : scopedItems
    if (selectedMediaItemIds && episodes.length !== selectedMediaItemIds.size) throw new Error('One or more selected optimization candidates no longer belong to this scope. Discover candidates again.')
    if (episodes.length === 0) throw new Error(request.seasonNumber === undefined ? 'No local episodes were found for the selected show' : `No local episodes were found for season ${request.seasonNumber}`)
    if (request.mediaItemId !== undefined && (
      episodes[0].source_id !== request.sourceId ||
      (request.libraryId !== undefined && episodes[0].library_id !== request.libraryId) ||
      (request.seriesIdentityKey !== undefined && episodes[0].series_identity_key !== request.seriesIdentityKey)
    )) {
      throw new Error('The selected episode does not belong to the requested series and source')
    }
    const scope = request.mediaItemId === undefined ? request.seasonNumber === undefined ? 'series' : 'season' : episodes[0].type === 'movie' ? 'movie' : 'episode'
    getLoggingService().info('[TVOptimization]', `Preflight started: scope=${scope}, series=${request.seriesIdentityKey ?? 'n/a'}, season=${request.seasonNumber ?? 'all'}, mediaItem=${request.mediaItemId ?? 'all'}, source=${request.sourceId}, library=${request.libraryId ?? 'n/a'}, mode=${request.options.optimizationMode ?? 'unspecified'}, codec=${request.options.targetCodec ?? 'unspecified'}, qualityProfile=${request.options.qualityProfile ?? 'unspecified'}, encoderPolicy=${request.options.encoderPolicy ?? 'unspecified'}, container=${request.options.targetContainer ?? 'automatic'}, containerSelection=${request.options.targetContainerSelection ?? 'unspecified'}, gpu=${request.options.gpuId ?? 'selected'}`)
    const batchId = operation?.batchId ?? `batch_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
    const preflightId = operation?.preflightId ?? `${batchId}_preflight`
    const needsHardwareSnapshot = request.options.optimizationMode !== 'remux_only'
    const activeCalibration = operation?.calibration || request.options.optimizationMode === 'remux_only' ? [] : await this.loadOptimizationCalibration()
    const calibrationFingerprint = createHash('sha256').update(JSON.stringify(activeCalibration)).digest('hex')
    const optionsFingerprint = createHash('sha256').update(JSON.stringify({ measurementVersion: MEASUREMENT_VERSION, searchVersion: OPTIMIZATION_SEARCH_VERSION, calibrationFingerprint, qualityGates: APP_CONFIG.transcoding.qualityGates, sampleQualityDomains: APP_CONFIG.transcoding.sampleQualityDomains, samplePositions: APP_CONFIG.transcoding.samplePositions, sampleDurationSeconds: APP_CONFIG.transcoding.sampleDurationSeconds, options: request.options, representativeMediaItemId: request.representativeMediaItemId, representativeMediaItemIds: request.representativeMediaItemIds, selectedMediaItemIds: request.selectedMediaItemIds })).digest('hex')
    const queuedMediaIds = new Set((await getTaskQueueService().getTasks()).filter(task => task.type === TaskType.Transcode && ['queued', 'running'].includes(task.status)).map(task => task.mediaItemId).filter((id): id is number => id !== undefined))
    const sourceHasher = new OperationFileHasher(sha256File, APP_CONFIG.transcoding.measuredSampleCache.maxConcurrentHashReads)
    // The hash is reused only inside this preflight, keyed by complete file identity.
    // Recheck identity on every reuse; queue/execute still require fresh verification.
    const hashSource = async (filePath: string): Promise<string> => {
      const before = await fs.stat(filePath)
      const digest = await sourceHasher.hash(filePath, JSON.stringify([filePath, fileIdentity(before)]))
      if (!matchesFileIdentity(before, await fs.stat(filePath))) {
        throw new Error('Source file changed during preflight hashing; retry after it settles')
      }
      return digest
    }

    let completedEpisodes = 0
    let completedInspections = 0
    const activeEpisodeSteps = new Map<number, string>()
    const getActiveEpisodeSummary = () => {
      const active = [...activeEpisodeSteps.values()]
      const currentItem = active.slice(0, 3).join(' · ')
      const additionalCount = active.length - 3
      return additionalCount > 0 ? `${currentItem} · +${additionalCount} more` : currentItem
    }
    const publishInspectionProgress = () => operation?.update({
      phase: `Inspecting ${completedInspections} of ${episodes.length} episodes`,
      progress: { current: completedInspections, total: episodes.length, currentItem: getActiveEpisodeSummary() },
    })
    const publishPreflightProgress = (episode: typeof episodes[number], phase: string) => {
      activeEpisodeSteps.set(episode.id ?? 0, `${formatMediaDisplayName(episode, request.seriesTitle)}: ${phase}`)
      operation?.update({
        phase: `Episode ${Math.min(completedEpisodes + 1, episodes.length)} of ${episodes.length}`,
        progress: {
        current: completedEpisodes,
        total: episodes.length,
          currentItem: getActiveEpisodeSummary(),
        },
      })
    }

    type PreparedEpisode =
      | { episode: typeof episodes[number]; status: 'ready'; stat: Stats; analysis: FileAnalysisResult & { video: NonNullable<FileAnalysisResult['video']> } }
      | { episode: typeof episodes[number]; status: 'failed'; error: unknown }
    type SamplingGroupState = {
      sampleAttemptedEpisodeLabel?: string
      sampleAttemptedPlan?: ShowTranscodePreflight['episodes'][number]
      representative?: { plan: ShowTranscodePreflight['episodes'][number]; profileKey?: string }
    }

    const inspectEpisode = async (episode: typeof episodes[number]): Promise<PreparedEpisode> => {
      activeEpisodeSteps.set(episode.id ?? 0, `${formatMediaDisplayName(episode, request.seriesTitle)}: Inspecting source and playback compatibility`)
      publishInspectionProgress()
      try {
        await operation?.waitUntilRunning()
        operation?.signal.throwIfAborted()
        if (!episode.id || !episode.file_path || !episode.source_id) throw new Error(`Episode "${formatMediaDisplayName(episode, request.seriesTitle)}" has no local source identity`)
        if (queuedMediaIds.has(episode.id)) throw new Error(`Episode "${formatMediaDisplayName(episode, request.seriesTitle)}" already has a queued or running transcode`)
        await this.assertAuthorizedItem(episode.id)
        const stat = await fs.stat(episode.file_path)
        const { analysis } = await getQualityAnalyzer().analyzeMediaItemFileEvidence(episode, operation?.signal, operation?.calibration || operation?.parameterPreview ? { persist: false } : {})
        const video = analysis.video
        operation?.signal.throwIfAborted()
        if (!analysis.success || analysis.filePath !== episode.file_path || analysis.fileSizeBytes !== stat.size || !video) {
          throw new Error(`File analysis is incomplete or stale for "${formatMediaDisplayName(episode, request.seriesTitle)}"`)
        }
        this.analysisCache.set(episode.file_path, stat, analysis)
        return { episode, status: 'ready', stat, analysis: { ...analysis, video } }
      } catch (error) {
        if (operation?.signal?.aborted) throw error
        return { episode, status: 'failed', error }
      } finally {
        activeEpisodeSteps.delete(episode.id ?? 0)
        completedInspections++
        publishInspectionProgress()
      }
    }

    const CONCURRENCY = 4
    const preparedEpisodes: PreparedEpisode[] = []
    for (let offset = 0; offset < episodes.length; offset += CONCURRENCY) {
      const chunk = episodes.slice(offset, offset + CONCURRENCY)
      const results = await Promise.allSettled(chunk.map(inspectEpisode))
      const rejected = results.find((result): result is PromiseRejectedResult => result.status === 'rejected')
      if (rejected) throw rejected.reason
      for (const result of results) preparedEpisodes.push((result as PromiseFulfilledResult<PreparedEpisode>).value)
      operation?.signal?.throwIfAborted()
    }
    const capabilityFingerprint = needsHardwareSnapshot && preparedEpisodes.some(prepared => prepared.status === 'ready')
      ? this.getCapabilitySnapshotFingerprint(await this.getCapabilities())
      : undefined

    const samplingGroups = new Map<string, PreparedEpisode[]>()
    let unclassifiedSamplingProfiles = 0
    for (const prepared of preparedEpisodes) {
      const profileKey = prepared.status === 'ready' ? getPreflightSamplingProfileKey(prepared.episode, request.options, prepared.analysis) : undefined
      if (!profileKey) unclassifiedSamplingProfiles++
      const key = profileKey ?? `unclassified:${prepared.episode.id ?? prepared.episode.file_path}`
      samplingGroups.set(key, [...(samplingGroups.get(key) ?? []), prepared])
    }
    getLoggingService().info('[TVOptimization]', 'Sampling groups selected', {
      preflightId,
      candidateCount: episodes.length,
      samplingGroups: [...samplingGroups].map(([profileKey, group]) => ({
        profileKey,
        mediaItemIds: group.map(prepared => prepared.episode.id),
        selectedRepresentativeMediaItemId: request.representativeMediaItemIds?.[profileKey] ?? (group.some(prepared => prepared.episode.id === request.representativeMediaItemId) ? request.representativeMediaItemId : undefined),
        policy: 'one-per-season-and-technical-profile',
      })),
      unclassifiedProfiles: unclassifiedSamplingProfiles,
    })

    const processEpisode = async (prepared: PreparedEpisode, samplingState: SamplingGroupState): Promise<ShowTranscodePreflight['episodes'][number]> => {
      const episode = prepared.episode
      const label = formatMediaDisplayName(episode, request.seriesTitle)
      const fallbackMediaItemId = episode.id || 0
      const mediaItemId = episode.id ?? fallbackMediaItemId
      const samplingGroupKey = prepared.status === 'ready'
        ? getPreflightSamplingProfileKey(episode, request.options, prepared.analysis) ?? `unclassified:${mediaItemId}`
        : `unclassified:${mediaItemId}`
      let cachedMeasurement: CachedMeasurement | undefined
      let audioPlan: PlannedAudioStream[] | undefined
      const toInsufficientPlan = (error: unknown): ShowTranscodePreflight['episodes'][number] => {
        if (operation?.signal?.aborted) throw error
        const errorMsg = getErrorMessage(error)
        const decisionStatus = error instanceof MeasuredQualityError ? error.decisionStatus : 'measurement_failed'
        const measuredOutcome = error instanceof MeasuredQualityError
        getLoggingService().warn('[TVOptimization]', `Episode preflight outcome: preflight=${preflightId}, mediaItem=${mediaItemId}, label="${label}", outcome=${decisionStatus}, reason=${errorMsg}`)
        return {
          mediaItemId: fallbackMediaItemId,
          label,
          samplingGroupKey,
          audioPlan,
          compatible: measuredOutcome && decisionStatus !== 'incompatible',
          reason: errorMsg,
          hdrFormat: 'Unknown',
          sourceSize: prepared.status === 'ready' ? prepared.stat.size : 0,
          sourceMtimeMs: prepared.status === 'ready' ? prepared.stat.mtimeMs : 0,
          sourceAnalysis: prepared.status === 'ready' ? prepared.analysis : undefined,
          operations: [],
          decisionStatus,
          qualityChoices: prepared.status === 'ready' && cachedMeasurement ? getOptimizationQualityChoices(prepared.stat.size, prepared.analysis.durationMs! / 1000, plannedNonVideoBytesPerSecond(prepared.analysis, request.options), cachedMeasurement, request.options.qualityProfile) : undefined,
          evidenceStatus: measuredOutcome ? 'measured' : 'insufficient',
          confidence: measuredOutcome ? 'high' : 'none',
          savingsCoverage: measuredOutcome ? 'complete' : 'insufficient',
          savingsBasis: measuredOutcome ? 'video_sample_encode' : 'insufficient_data',
        }
      }
      if (prepared.status === 'failed') return toInsufficientPlan(prepared.error)
      try {
        await operation?.waitUntilRunning()
        operation?.signal?.throwIfAborted()
        const { stat, analysis } = prepared
        publishPreflightProgress(episode, 'Planning streams and target compatibility')
        const actualSamplingProfileKey = getPreflightSamplingProfileKey(episode, request.options, analysis)
        const representativePlan = samplingState.representative
        const reusableRepresentativePlan = !request.remeasure && representativePlan && actualSamplingProfileKey !== undefined && representativePlan.profileKey === actualSamplingProfileKey &&
          representativePlan.plan.compatible &&
          representativePlan.plan.decisionStatus === 'sample_required' &&
          representativePlan.plan.params?.measuredCandidate &&
          representativePlan.plan.measuredParameters
          ? representativePlan.plan
          : undefined
        const advice = await getQualityAnalyzer().getOptimizationAdvice(episode, analysis, request.options.targetCodec)
        const sourcePlan = buildStreamSelectionPlan(analysis, request.options)
        audioPlan = getPlannedAudioStreams(analysis, sourcePlan)
        const removedAudioTracks = analysis.audioTracks.filter(track => !sourcePlan.audioStreamIndexes.includes(track.index))
        const removedSubtitleTracks = analysis.subtitleTracks.filter(track => !sourcePlan.subtitleStreamIndexes.includes(track.index))
        const audioStreamsChanged = removedAudioTracks.length > 0
        const subtitleStreamsChanged = removedSubtitleTracks.length > 0
        const streamsChanged = audioStreamsChanged || subtitleStreamsChanged
        const selectedAnalysis = { ...analysis, audioTracks: analysis.audioTracks.filter(track => sourcePlan.audioStreamIndexes.includes(track.index)), subtitleTracks: analysis.subtitleTracks.filter(track => sourcePlan.subtitleStreamIndexes.includes(track.index)) }
        if (request.options.targetAudioCodec && targetProfile && !targetProfile.definition.audio.codecs.some(codec => normalizeAudioCodec(codec) === normalizeAudioCodec(request.options.targetAudioCodec))) {
          throw new Error(`Audio codec ${request.options.targetAudioCodec} is not supported by ${targetProfile.name}`)
        }
        const plannedAudioConversions = buildAudioConversions(selectedAnalysis, request.options)
        audioPlan = getPlannedAudioStreams(analysis, sourcePlan, plannedAudioConversions)
        const compatibleAudioTracks = selectedAnalysis.audioTracks.map(track => {
          const conversion = plannedAudioConversions.find(item => item.sourceIndex === track.index)
          return conversion ? { ...track, codec: conversion.codec, bitrate: conversion.bitrateKbps } : track
        })
        const allowedTargetContainers = targetProfile ? getPlaybackTargetContainers(targetProfile, analysis.video) : undefined
        const sourceContainerNames = analysis.container?.split(',').map(container => container.trim().toLowerCase()) ?? []
        const requiresDolbyVisionMp4Remux = analysis.video.dolbyVisionProfile === 5 && !sourceContainerNames.some(container => ['mp4', 'm4v'].includes(container))
        const advisoryTargetProfile = request.options.targetProfileMode === 'advisory'
        const recommendedTargetContainer = targetProfile && (request.options.playbackPolicy !== 'allow-transcoding' || advisoryTargetProfile)
          ? recommendPlaybackTargetContainer(targetProfile, analysis.video, analysis.container)
          : undefined
        let plannedContainer: string | undefined
        if (requiresDolbyVisionMp4Remux) {
          plannedContainer = 'mp4'
        } else if (request.options.targetContainerSelection === 'automatic' && targetProfile && request.options.playbackPolicy !== 'allow-transcoding') {
          if (recommendedTargetContainer) plannedContainer = recommendedTargetContainer === 'mp4' ? 'mp4' : 'matroska'
          else if (!advisoryTargetProfile) throw new Error(`Playback target ${targetProfile.name} has no supported MKV or MP4 container for this episode's video format`)
          else plannedContainer = sourceContainerNames[0] === 'mp4' || sourceContainerNames[0] === 'm4v' ? 'mp4' : 'matroska'
        } else if (request.options.targetContainerSelection === 'automatic') {
          const sourceContainer = sourceContainerNames[0]
          plannedContainer = sourceContainer === 'mkv' || sourceContainer === 'matroska' ? 'matroska'
            : sourceContainer === 'mp4' || sourceContainer === 'm4v' ? 'mp4'
              : request.options.targetContainer === 'mp4' ? 'mp4' : 'matroska'
        } else {
          plannedContainer = request.options.targetContainer === 'mp4' ? 'mp4'
            : request.options.targetContainer === 'mkv' ? 'matroska'
              : analysis.container
          if (targetProfile && request.options.playbackPolicy !== 'allow-transcoding' && !advisoryTargetProfile && (!plannedContainer || !allowedTargetContainers?.some(container => container.toLowerCase() === plannedContainer!.toLowerCase()))) {
            throw new Error(`Container ${plannedContainer ?? 'unspecified'} is not allowed by ${targetProfile.name}'s matching video/container rule`)
          }
        }
        const containerChanged = !analysis.container?.split(',').includes(plannedContainer!)
        const sourceCompatibility = targetProfile
          ? evaluatePlaybackTarget(targetProfile, { ...selectedAnalysis, audioTracks: compatibleAudioTracks, container: plannedContainer })
          : undefined
        const playbackCompatible = isCompatibleWithPlaybackPolicy(request.options.playbackPolicy ?? 'allow-transcoding', sourceCompatibility)
        const preserveDynamicHdr = ['Dolby Vision', 'HDR10+'].includes(analysis.video.hdrFormat ?? '')
        const preserveCompatibleHevc = normalizeVideoCodec(analysis.video.codec) === 'HEVC' && normalizeVideoCodec(request.options.targetCodec) === 'HEVC' && playbackCompatible
        const shouldEncode = request.options.optimizationMode === 'transcode' || (request.options.optimizationMode === 'smart' && !preserveDynamicHdr && !preserveCompatibleHevc && (advice.action === 'video_transcode' || !playbackCompatible && request.options.playbackPolicy === 'direct-play'))
        const options: TranscodeOptions = { ...request.options, targetProfileId: targetProfile?.id, targetContainer: plannedContainer === 'mp4' ? 'mp4' : 'mkv', optimizationMode: shouldEncode ? 'transcode' : 'remux_only', audioConversions: shouldEncode && targetProfile ? undefined : plannedAudioConversions, encoderPolicy: request.options.encoderPolicy, useGpu: shouldEncode && request.options.encoderPolicy !== 'software', gpuId: shouldEncode && request.options.encoderPolicy !== 'software' ? request.options.gpuId : undefined }
        if (!shouldEncode && !streamsChanged && !containerChanged && plannedAudioConversions.length === 0) {
          const compatible = playbackCompatible
          return { mediaItemId, label, compatible, audioPlan, reason: compatible ? undefined : 'Retained streams do not satisfy the selected playback profile', hdrFormat: analysis.video.hdrFormat || 'SDR', sourceSize: stat.size, sourceMtimeMs: stat.mtimeMs, operations: [], decisionStatus: compatible ? 'already_optimized' : 'incompatible', targetCompatibility: sourceCompatibility, sourceTier: advice.sourceTier, adviceReason: preserveCompatibleHevc ? 'Compatible H.265 video is preserved; no same-codec recompression was measured.' : advice.reason }
        }
        if (shouldEncode) {
          options.maxOutputBytes = stat.size
          if (targetProfile && request.options.playbackPolicy !== 'allow-transcoding' && request.options.targetProfileMode !== 'advisory') options.targetConversion = buildTargetTranscodePlan(analysis, targetProfile, options)
        }
        if (shouldEncode && samplingState.sampleAttemptedEpisodeLabel && !reusableRepresentativePlan) {
          const representativePlan = samplingState.sampleAttemptedPlan
          const outcome = representativePlan?.decisionStatus ? ` Its recorded outcome was ${representativePlan.decisionStatus}.` : ''
          const detail = representativePlan?.reason ? ` Representative reason: ${representativePlan.reason}.` : ''
          const reason = `Not sampled: the season/profile sample attempt was made from "${samplingState.sampleAttemptedEpisodeLabel}".${outcome}${detail} The representative result does not establish the outcome for this episode.`
          return {
            mediaItemId,
            label,
            compatible: false,
            audioPlan,
            reason,
            hdrFormat: analysis.video.hdrFormat || 'SDR',
            sourceSize: stat.size,
            sourceMtimeMs: stat.mtimeMs,
            operations: [],
            decisionStatus: 'insufficient_evidence',
            evidenceStatus: 'insufficient',
            savingsCoverage: 'insufficient',
            confidence: 'none',
            savingsBasis: 'insufficient_data',
            sourceTier: advice.sourceTier,
            targetCompatibility: sourceCompatibility,
            sourceAnalysis: analysis,
            targetProfile,
          }
        }
        const audioConversions = options.targetConversion?.audio.flatMap(track => track.bitrateKbps === undefined ? [] : [{ sourceIndex: track.sourceIndex, codec: track.codec, bitrateKbps: track.bitrateKbps }]) ?? options.audioConversions ?? []
        audioPlan = getPlannedAudioStreams(analysis, sourcePlan, audioConversions)
        const audioConversionSavings = estimateAudioConversionSavings(analysis, audioConversions)
        const audioPruningSavings = sumMeasuredStreamBytes(analysis.streamBytes, removedAudioTracks.map(track => track.index))
        const subtitlePruningSavings = sumMeasuredStreamBytes(analysis.streamBytes, removedSubtitleTracks.map(track => track.index))
        await operation?.waitUntilRunning()
        const sourceSha256 = await hashSource(episode.file_path)
        const measurementOptions = {
          targetCodec: options.targetCodec,
          qualityProfile: options.qualityProfile,
          targetProfileId: options.targetProfileId,
          playbackPolicy: options.playbackPolicy,
          maxOutputBytes: options.maxOutputBytes,
          encoderPolicy: options.encoderPolicy,
          gpuId: options.gpuId,
          customArgs: options.customArgs,
          targetHdrFormat: options.targetHdrFormat,
          targetProfileMode: options.targetProfileMode,
          measurementCandidateBudget: options.measurementCandidateBudget,
          targetContainer: options.targetContainer,
          streamSelection: options.streamSelection,
          audioConversions: options.targetConversion?.audio ?? options.audioConversions,
          videoTransformation: options.targetConversion && {
            width: options.targetConversion.width,
            height: options.targetConversion.height,
            bitDepth: options.targetConversion.bitDepth,
            profile: options.targetConversion.profile,
            level: options.targetConversion.level,
            hdrFormat: options.targetConversion.hdrFormat,
            videoFilter: options.targetConversion.videoFilter,
            inputArgs: options.targetConversion.inputArgs,
            maximumVideoBitrate: options.targetConversion.maximumVideoBitrate,
          },
        }
        const measurementFingerprint = shouldEncode
          ? await this.measuredOptimizationService.getMeasurementFingerprint()
          : undefined
        const measurementCacheKey = shouldEncode
          ? createHash('sha256').update(JSON.stringify({
              version: MEASUREMENT_VERSION,
              searchVersion: OPTIMIZATION_SEARCH_VERSION,
              sourceSha256,
              sourceId: episode.source_id,
              libraryId: episode.library_id,
              mediaType: episode.type,
              qualityGates: APP_CONFIG.transcoding.qualityGates,
              targetProfile,
              options: measurementOptions,
              capabilityFingerprint,
              calibrationFingerprint,
              measurementFingerprint,
              samplePlan: {
                positions: options.measurementSamplePositions ?? APP_CONFIG.transcoding.samplePositions,
                durationSeconds: options.measurementSampleDurationSeconds ?? APP_CONFIG.transcoding.sampleDurationSeconds,
              },
              sampleQualityDomains: APP_CONFIG.transcoding.sampleQualityDomains,
              ...(request.remeasure ? { remeasurement: preflightId } : {}),
            })).digest('hex')
          : undefined
        const sampleDirectory = operation?.calibration
          ? path.join(app.getPath('userData'), 'transcoding-samples', preflightId, String(episode.id))
          : measurementCacheKey
          ? path.join(app.getPath('userData'), 'transcoding-samples', 'cache', measurementCacheKey)
          : path.join(app.getPath('userData'), 'transcoding-samples', preflightId, String(episode.id))
        if (measurementCacheKey && !operation?.calibration) {
          analysis.optimizationMeasurement = {
            cacheKey: reusableRepresentativePlan ? reusableRepresentativePlan.sourceAnalysis!.optimizationMeasurement!.cacheKey : measurementCacheKey,
            qualityProfile: options.qualityProfile!, targetCodec: options.targetCodec!, nonVideoBytesPerSecond: plannedNonVideoBytesPerSecond(analysis, options), sourceSize: stat.size, sourceMtimeMs: stat.mtimeMs,
            samplingRole: reusableRepresentativePlan ? 'projected' : 'measured',
          }
        }
        let params: TranscodingParams
        let targetCompatibility = sourceCompatibility
        let measurementCacheHit = false
        let measurementCacheStored = false
        if (measurementCacheKey) this.sampleCacheUsers.set(measurementCacheKey, (this.sampleCacheUsers.get(measurementCacheKey) ?? 0) + 1)
        try {
          if (shouldEncode) {
            if (reusableRepresentativePlan) {
              publishPreflightProgress(episode, `Using measured settings from ${reusableRepresentativePlan.label}`)
              Object.assign(options, reusableRepresentativePlan.measuredParameters)
            } else {
              samplingState.sampleAttemptedEpisodeLabel = label
              cachedMeasurement = request.remeasure
                ? undefined
                : await this.getCachedMeasurement(measurementCacheKey!, sourceSha256, sampleDirectory, (options.measurementSamplePositions ?? APP_CONFIG.transcoding.samplePositions).length)
              if (cachedMeasurement?.complete) {
                measurementCacheHit = true
                publishPreflightProgress(episode, 'Reusing verified encode samples from cache')
                Object.assign(options, await this.selectMeasuredParameters(
                  episode.file_path,
                  options,
                  sampleDirectory,
                  operation?.signal,
                  async phase => {
                    publishPreflightProgress(episode, phase)
                    await operation?.waitUntilRunning()
                  },
                  async () => undefined,
                  cachedMeasurement.candidates,
                  true,
                  cachedMeasurement.partialSamples,
                ))
              } else {
                publishPreflightProgress(episode, 'Measuring encode samples for this episode')
                let partialSamples = cachedMeasurement?.partialSamples ?? []
                let sourcePreparation = cachedMeasurement?.sourcePreparation ?? { samples: [] }
                const persistMeasurement = async (candidates: MeasuredCandidate[], complete: boolean, samples: MeasuredCandidateSample[], rewrittenPath?: string) => {
                  if (operation?.calibration) return
                  const savedHashes = new Map<string, string>()
                  cachedMeasurement?.candidates.forEach((candidate, candidateIndex) => {
                    candidate.samplePaths?.forEach((samplePath, index) => {
                      savedHashes.set(samplePath, cachedMeasurement!.sampleHashes[candidateIndex][index])
                    })
                  })
                  cachedMeasurement?.partialSamples.forEach((sample, index) => {
                    savedHashes.set(sample.samplePath, cachedMeasurement!.partialSampleHashes[index])
                  })
                  if (rewrittenPath !== undefined) savedHashes.delete(rewrittenPath)
                  const hashSnapshot = new OperationFileHasher(sha256File, APP_CONFIG.transcoding.measuredSampleCache.maxConcurrentHashReads)
                  const getSampleHash = (samplePath: string) => savedHashes.get(samplePath) ?? hashSnapshot.hash(samplePath)
                  const completedPaths = new Set(candidates.flatMap(candidate => candidate.samplePaths ?? []))
                  const pendingSamples = samples.filter(sample => !completedPaths.has(sample.samplePath))
                  const checkpoint = { preflightId, mediaItemId, cacheKey: measurementCacheKey, candidates: candidates.length, pendingSamples: pendingSamples.length, complete }
                  getLoggingService().debug('[TVOptimization]', 'Hashing measurement checkpoint', checkpoint)
                  const cacheRecord: CachedMeasurement = {
                    version: MEASUREMENT_VERSION,
                    searchVersion: OPTIMIZATION_SEARCH_VERSION,
                    cacheKey: measurementCacheKey!,
                    sourceSha256,
                    complete,
                    candidates,
                    sampleHashes: await Promise.all(candidates.map(candidate => Promise.all((candidate.samplePaths ?? []).map(getSampleHash)))),
                    sourcePreparation,
                    partialSamples: pendingSamples,
                    partialSampleHashes: await Promise.all(pendingSamples.map(sample => getSampleHash(sample.samplePath))),
                  }
                  getLoggingService().debug('[TVOptimization]', 'Writing measurement checkpoint', checkpoint)
                  await getDatabase().setSetting(`${MEASUREMENT_SETTING_PREFIX}${measurementCacheKey}`, JSON.stringify(cacheRecord))
                  getLoggingService().debug('[TVOptimization]', 'Measurement checkpoint saved', checkpoint)
                  cachedMeasurement = cacheRecord
                  measurementCacheStored = true
                }
                const measuredParameters = await this.selectMeasuredParameters(
                  episode.file_path,
                  options,
                  sampleDirectory,
                  operation?.signal,
                  async phase => {
                    publishPreflightProgress(episode, phase)
                    await operation?.waitUntilRunning()
                  },
                  async (candidates, complete, calibrationScopeKey, maximumRate, rateLimit) => {
                    await operation?.onMeasuredCandidates?.(candidates, complete, calibrationScopeKey, maximumRate, rateLimit)
                    await persistMeasurement(candidates, complete, partialSamples)
                    if (!operation?.calibration) getLoggingService().info('[TVOptimization]', `Measured candidates cached: mediaItem=${episode.id}, cacheKey=${measurementCacheKey}, candidates=${candidates.length}`)
                  },
                  cachedMeasurement?.candidates,
                  false,
                  partialSamples,
                  async sample => {
                    partialSamples = [...partialSamples.filter(existing => existing.samplePath !== sample.samplePath), sample]
                    await persistMeasurement(cachedMeasurement?.candidates ?? [], false, partialSamples, sample.samplePath)
                  },
                  sourcePreparation,
                  async preparation => {
                    sourcePreparation = preparation
                    await persistMeasurement(cachedMeasurement?.candidates ?? [], false, partialSamples)
                  },
                  { preflightId, batchId, mediaItemId, groupKey: actualSamplingProfileKey, sourceId: episode.source_id, libraryId: episode.library_id, mediaType: episode.type, activeCalibration, calibration: operation?.calibration },
                  sourceSha256,
                )
                Object.assign(options, measuredParameters)
              }
            }
            options.useGpu = !isMeasuredSoftwareEncoder(options.encoder ?? '')
            if (!options.useGpu) options.gpuId = undefined
          }
          params = await this.getTranscodeParameters(episode.file_path, options)
          if (shouldEncode) {
            params.measuredCandidate = reusableRepresentativePlan
              ? { ...reusableRepresentativePlan.params!.measuredCandidate!, samplePaths: undefined }
              : (options as TranscodeOptions & { measuredCandidate?: MeasuredCandidate }).measuredCandidate
            const samplePaths = params.measuredCandidate!.samplePaths ?? []
            for (let sampleIndex = 0; sampleIndex < samplePaths.length; sampleIndex++) {
              const samplePath = samplePaths[sampleIndex]
              await operation?.waitUntilRunning()
              publishPreflightProgress(episode, `Verifying measured sample ${sampleIndex + 1} of ${samplePaths.length}`)
              operation?.signal.throwIfAborted()
              const sample = await getMediaFileAnalyzer().analyzeCompleteFile(samplePath, { scanBitrate: true, detectVolume: false, signal: operation?.signal })
              this.verifyPlannedVideo(sample, options)
              if (targetProfile) {
                targetCompatibility = evaluatePlaybackTarget(targetProfile, this.withPlannedSampleStreams(analysis, sample, options))
                if (!isCompatibleWithPlaybackPolicy(options.playbackPolicy ?? 'allow-transcoding', targetCompatibility)) throw new Error(`Measured sample is incompatible: ${Object.values(targetCompatibility.findings).filter(finding => finding.status === 'incompatible').map(finding => finding.rule).join('; ')}`)
              }
            }
            if (!operation?.calibration && !reusableRepresentativePlan && !measurementCacheHit && !measurementCacheStored) {
              throw new Error(`Measured candidates were not cached for ${formatMediaDisplayName(episode, request.seriesTitle)}`)
            }
          }
        } catch (error) {
          if (!measurementCacheHit && !measurementCacheStored) await fs.rm(sampleDirectory, { recursive: true, force: true })
          throw error
        } finally {
          if (measurementCacheKey) {
            const users = this.sampleCacheUsers.get(measurementCacheKey) ?? 1
            if (users <= 1) this.sampleCacheUsers.delete(measurementCacheKey)
            else this.sampleCacheUsers.set(measurementCacheKey, users - 1)
          }
        }
        const measuredPlanSavingsBytes = shouldEncode
          ? projectMeasuredSavingsBytes(
              stat.size, analysis.durationMs! / 1000,
              params.measuredCandidate!.outputBytes + plannedNonVideoBytesPerSecond(analysis, options) * params.measuredCandidate!.sampledDurationSeconds,
              params.measuredCandidate!.sampledDurationSeconds,
            )
          : undefined
        if (shouldEncode && measuredPlanSavingsBytes !== undefined && measuredPlanSavingsBytes <= 0) {
          return {
            mediaItemId, label, compatible: playbackCompatible, audioPlan, hdrFormat: analysis.video.hdrFormat || 'SDR',
            samplingGroupKey,
            sourceSize: stat.size, sourceMtimeMs: stat.mtimeMs, sourceSha256, sourceAnalysis: analysis, sourceCambiMean: reusableRepresentativePlan ? undefined : params.measuredCandidate?.sourceCambiMean, sourceSelfVmaf: reusableRepresentativePlan ? undefined : params.measuredCandidate?.sourceSelfVmaf, targetProfile,
            qualityChoices: reusableRepresentativePlan?.qualityChoices ?? getOptimizationQualityChoices(stat.size, analysis.durationMs! / 1000, plannedNonVideoBytesPerSecond(analysis, options), cachedMeasurement, request.options.qualityProfile),
            options, params, operations: [], decisionStatus: 'no_savings', estimatedSavingsBytes: 0,
            evidenceStatus: 'estimated', confidence: 'medium', savingsCoverage: 'complete', savingsBasis: 'video_sample_encode',
            samplingRole: reusableRepresentativePlan ? 'projected' : 'measured',
            samplePaths: params.measuredCandidate?.samplePaths,
            sampleHashes: params.measuredCandidate?.samplePaths ? await Promise.all(params.measuredCandidate.samplePaths.map(sha256File)) : undefined,
            reason: 'The tested encodes that meet the selected quality requirement do not project storage savings. Other encoders or settings may differ.',
          }
        }
        if (!operation?.calibration && targetCompatibility && !isCompatibleWithPlaybackPolicy(options.playbackPolicy ?? 'allow-transcoding', targetCompatibility)) throw new Error('Selected streams are incompatible with the playback policy')
        const plannedSavingsOperations: OptimizationSavingsOperation[] = [
          ...(shouldEncode ? ['video_transcode' as const] : []),
          ...(audioStreamsChanged ? ['audio_pruning' as const] : []),
          ...(subtitleStreamsChanged ? ['subtitle_pruning' as const] : []),
          ...(audioConversions.length > 0 ? ['audio_transcode' as const] : []),
        ]
        const savingsBreakdown = buildOptimizationSavingsBreakdown({
          totalBytes: stat.size,
          videoSavingsBytes: null,
          audioPruningBytes: audioPruningSavings,
          audioTranscodeBytes: audioConversionSavings,
          subtitlePruningBytes: subtitlePruningSavings,
          plannedOperations: plannedSavingsOperations,
          measuredPlanSavingsBytes,
        })
        const evidenceStatus = savingsBreakdown.coverage === 'insufficient'
          ? 'insufficient'
          : shouldEncode || audioConversions.length > 0 ? 'estimated' : 'measured'
        const savingsBasis = shouldEncode
          ? reusableRepresentativePlan ? 'representative_video_sample_projection' : 'video_sample_encode'
          : plannedSavingsOperations.length === 0 ? 'insufficient_data'
          : audioConversions.length > 0 ? 'audio_transcode_model'
          : 'audio_stream_removal'
        getLoggingService().debug('[TVOptimization]', `Episode planned: mediaItem=${episode.id}, label="${label}", compatible=true, container=${plannedContainer}, containerSelection=${request.options.targetContainerSelection ?? 'explicit'}, dynamicHdrPreserved=${preserveDynamicHdr && !shouldEncode}, operations=${plannedSavingsOperations.join(',') || 'none'}, decision=${shouldEncode ? 'sample_required' : 'actionable'}, savingsBytes=${savingsBreakdown.totalEstimatedSavingsBytes ?? 'unknown'}, coverage=${savingsBreakdown.coverage}, encoder=${params.encoder}`)
        const samplePaths = params.measuredCandidate?.samplePaths
        return {
          mediaItemId, label, compatible: true, audioPlan, hdrFormat: analysis.video.hdrFormat || 'SDR', sourceSize: stat.size, sourceMtimeMs: stat.mtimeMs, sourceSha256, sourceCambiMean: reusableRepresentativePlan ? undefined : params.measuredCandidate?.sourceCambiMean, sourceSelfVmaf: reusableRepresentativePlan ? undefined : params.measuredCandidate?.sourceSelfVmaf,
          operations: [
            ...(audioStreamsChanged ? ['stream_pruning' as const] : []),
            ...(subtitleStreamsChanged ? ['subtitle_pruning' as const] : []),
            ...(containerChanged ? ['container_change' as const] : []),
            ...(shouldEncode ? ['video_transcode' as const] : []),
            ...(audioConversions.length > 0 ? ['audio_transcode' as const] : []),
          ],
          decisionStatus: shouldEncode ? 'sample_required' : 'actionable', evidenceStatus, savingsCoverage: reusableRepresentativePlan ? 'partial' : savingsBreakdown.coverage, confidence: evidenceStatus === 'measured' ? 'high' : evidenceStatus === 'estimated' ? 'medium' : 'none',
          samplingGroupKey,
          estimatedSavingsBytes: savingsBreakdown.totalEstimatedSavingsBytes,
          qualityChoices: reusableRepresentativePlan?.qualityChoices ?? getOptimizationQualityChoices(stat.size, analysis.durationMs! / 1000, plannedNonVideoBytesPerSecond(analysis, options), cachedMeasurement, request.options.qualityProfile),
          savingsBasis, sourceTier: advice.sourceTier, adviceReason: preserveDynamicHdr && !shouldEncode
            ? playbackCompatible ? 'Dynamic HDR source video is preserved; only the container or selected streams are remuxed.' : 'Dynamic HDR source video is preserved, but the selected playback policy is not satisfied by the source and allowed remux operations.'
            : shouldEncode
              ? reusableRepresentativePlan
                ? `Representative sample from ${reusableRepresentativePlan.label} passed the selected quality gates; savings are projected for this episode.`
                : 'Measured encoding passed the selected quality gates. Review the samples before approval.'
              : preserveCompatibleHevc ? 'Compatible H.265 video is preserved; only selected stream or container changes are applied.' : advice.reason,
          targetCompatibility, options, params, sourceAnalysis: analysis, targetProfile,
          samplingRole: shouldEncode ? reusableRepresentativePlan ? 'projected' : 'measured' : undefined,
          sampleRepresentativeMediaItemId: reusableRepresentativePlan?.mediaItemId,
          sampleRepresentativeLabel: reusableRepresentativePlan?.label,
          samplePaths, sampleHashes: samplePaths ? await Promise.all(samplePaths.map(sha256File)) : undefined, changes: [...(options.targetConversion?.changes ?? []), ...audioConversions.map(track => `Convert audio stream ${track.sourceIndex} to ${track.codec.toUpperCase()} at ${track.bitrateKbps} kbps`), ...(removedSubtitleTracks.length ? [`Remove ${removedSubtitleTracks.length} subtitle stream${removedSubtitleTracks.length === 1 ? '' : 's'} excluded by the selected language policy`] : [])],
          measuredParameters: { encoder: params.encoder, crf: params.crf, preset: params.preset, gpuId: options.gpuId },
        }
      } catch (error) {
        return toInsufficientPlan(error)
      }
    }

    const episodeResults = new Map<number, ShowTranscodePreflight['episodes'][number]>()
    const orderedSamplingGroups = [...samplingGroups.values()].flatMap(group => {
      const withBitrate = group.filter((prepared): prepared is Extract<PreparedEpisode, { status: 'ready' }> =>
        prepared.status === 'ready' && Number.isFinite(prepared.analysis.video.bitrateKbps) && prepared.analysis.video.bitrateKbps! > 0)
      const withoutBitrate = group.filter(prepared => prepared.status !== 'ready' || !Number.isFinite(prepared.analysis.video.bitrateKbps) || prepared.analysis.video.bitrateKbps! <= 0)
      if (!withBitrate.length) return group.map(prepared => [prepared])
      const ordered = [...withBitrate].sort((left, right) =>
        (left.episode.episode_number ?? left.episode.id ?? 0) - (right.episode.episode_number ?? right.episode.id ?? 0)
      )
      const bitrates = withBitrate.map(prepared => prepared.analysis.video.bitrateKbps!).sort((left, right) => left - right)
      const medianBitrate = bitrates[Math.floor((bitrates.length - 1) / 2)]
      const orderedByMedian = [...ordered].sort((left, right) =>
        Math.abs(left.analysis.video.bitrateKbps! - medianBitrate) - Math.abs(right.analysis.video.bitrateKbps! - medianBitrate) ||
        (left.episode.episode_number ?? left.episode.id ?? 0) - (right.episode.episode_number ?? right.episode.id ?? 0)
      )
      const profileKey = getPreflightSamplingProfileKey(ordered[0].episode, request.options, ordered[0].analysis)
      const requestedRepresentativeId = profileKey ? request.representativeMediaItemIds?.[profileKey] : undefined
      const selectedRepresentative = ordered.find(prepared => prepared.episode.id === (requestedRepresentativeId ?? request.representativeMediaItemId))
      const representative = selectedRepresentative ?? orderedByMedian[0]
      return [[representative, ...ordered.filter(prepared => prepared !== representative)], ...withoutBitrate.map(prepared => [prepared])]
    })
    const requestedRepresentatives = new Set([request.representativeMediaItemId, ...Object.values(request.representativeMediaItemIds ?? {})].filter((id): id is number => id !== undefined))
    for (const representativeMediaItemId of requestedRepresentatives) if (!preparedEpisodes.some(prepared => prepared.status === 'ready' && prepared.episode.id === representativeMediaItemId)) {
      throw new Error(`Selected representative episode ${representativeMediaItemId} is not available for sampling in this scope`)
    }
    const processSamplingGroup = async (group: PreparedEpisode[]) => {
      const samplingState: SamplingGroupState = {}
      for (const prepared of group) {
        const { episode } = prepared
        let plan: ShowTranscodePreflight['episodes'][number] | undefined
        if (prepared.status === 'ready' && episode.id && operation?.loadEpisodeCheckpoint) {
          const saved = await operation.loadEpisodeCheckpoint(episode.id)
          if (saved && saved.optionsFingerprint === optionsFingerprint && saved.capabilityFingerprint === capabilityFingerprint && saved.plan.sourceSha256 &&
            saved.plan.sourceSize === prepared.stat.size && saved.plan.sourceMtimeMs === prepared.stat.mtimeMs &&
            JSON.stringify(saved.plan.targetProfile) === JSON.stringify(targetProfile)) {
            const sourceHash = await hashSource(episode.file_path!)
            const samples = saved.plan.samplePaths ?? []
            let sampleHashes: string[] = []
            try {
              sampleHashes = samples.length ? await Promise.all(samples.map(sha256File)) : []
            } catch (error) {
              if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
              getLoggingService().warn('[TVOptimization]', `Discarding preflight checkpoint with missing sample: mediaItem=${episode.id}`)
            }
            if (sourceHash === saved.plan.sourceSha256 && sampleHashes.length === (saved.plan.sampleHashes?.length ?? 0) &&
              sampleHashes.every((hash, index) => hash === saved.plan.sampleHashes![index])) plan = saved.plan
            else getLoggingService().info('[TVOptimization]', `Preflight checkpoint no longer matches source or samples: mediaItem=${episode.id}`)
          } else if (saved) {
            getLoggingService().info('[TVOptimization]', `Preflight checkpoint invalidated by options, source, profile, or capability changes: mediaItem=${episode.id}`)
          }
        }
        plan ??= await processEpisode(prepared, samplingState)
        if (plan.samplingRole === 'measured' && plan.decisionStatus === 'sample_required') samplingState.sampleAttemptedEpisodeLabel = plan.label
        if (samplingState.sampleAttemptedEpisodeLabel === plan.label) samplingState.sampleAttemptedPlan = plan
        episodeResults.set(episode.id ?? 0, plan)
        if (!samplingState.representative && samplingState.sampleAttemptedEpisodeLabel === plan.label && plan.compatible &&
          plan.decisionStatus === 'sample_required' && plan.params?.measuredCandidate && plan.measuredParameters) {
          samplingState.representative = {
            plan,
            profileKey: plan.sourceAnalysis ? getPreflightSamplingProfileKey(episode, request.options, plan.sourceAnalysis) : undefined,
          }
        }
        completedEpisodes++
        if (episode.id && operation?.saveEpisodeCheckpoint) {
          await operation.saveEpisodeCheckpoint(episode.id, { version: 1, optionsFingerprint, capabilityFingerprint, plan })
        }
        activeEpisodeSteps.delete(episode.id ?? 0)
        operation?.update({
          phase: `Reviewed ${completedEpisodes} of ${episodes.length} episodes`,
          progress: { current: completedEpisodes, total: episodes.length, currentItem: 'Episode checks complete for this sample group' },
        })
      operation?.signal.throwIfAborted()
      }
    }
    for (let offset = 0; offset < orderedSamplingGroups.length; offset += CONCURRENCY) {
      const groups = orderedSamplingGroups.slice(offset, offset + CONCURRENCY)
      const firstEpisode = completedEpisodes + 1
      const lastEpisode = completedEpisodes + groups.reduce((count, group) => count + group.length, 0)
      operation?.update({
        phase: `Starting sample groups for episodes ${firstEpisode}–${lastEpisode} of ${episodes.length}`,
        progress: { current: completedEpisodes, total: episodes.length, currentItem: 'Preparing episode plans and measured samples' },
      })
      const results = await Promise.allSettled(groups.map(processSamplingGroup))
      const rejected = results.find((result): result is PromiseRejectedResult => result.status === 'rejected')
      if (rejected) throw rejected.reason
    }

    const results = episodes.map(episode => {
      const result = episodeResults.get(episode.id ?? 0)
      if (!result) throw new Error(`Preflight did not produce a result for episode ${formatMediaDisplayName(episode, request.seriesTitle)}`)
      return result
    })

    const planMetrics = aggregateShowOptimizationMetrics(results
      .filter(episode => episode.compatible && (episode.operations.length > 0 || episode.decisionStatus === 'no_savings' || episode.decisionStatus === 'no_positive_savings'))
      .map(episode => ({
        sizeBytes: episode.sourceSize,
        estimatedSavingsBytes: episode.estimatedSavingsBytes,
        savingsCoverage: episode.savingsCoverage,
      })))
    operation?.update({
      phase: 'Saving optimization review',
      progress: { percentage: 100, currentItem: 'Writing the measured review plan' },
    })
    const result: ShowTranscodePreflight = {
      measurementVersion: MEASUREMENT_VERSION,
      searchVersion: OPTIMIZATION_SEARCH_VERSION,
      measurementModel: VMAF_MODEL_VERSION,
      preflightId,
      batchId,
      createdAt: new Date().toISOString(),
      seriesTitle: request.seriesTitle || episodes[0]?.title || 'Selected media',
      episodeCount: episodes.length,
      compatible: results.some(episode => episode.compatible),
      capabilityFingerprint,
      userApproved: false,
      episodes: results,
      estimatedSavingsBytes: planMetrics.totalEstimatedSavingsBytes,
      savingsCoverage: planMetrics.coverage,
      savingsBasis: results.some(episode => episode.savingsBasis === 'representative_video_sample_projection')
        ? results.some(episode => episode.savingsBasis === 'video_sample_encode')
          ? 'mixed_representative_sample_projection'
          : 'representative_sample_projection'
        : results.some(episode => episode.savingsBasis === 'video_sample_encode')
          ? results.filter(episode => episode.compatible && episode.operations.length > 0).every(episode => episode.savingsBasis === 'video_sample_encode')
            ? 'sample_based_projection'
            : 'mixed_sample_projection'
          : 'planned_operations',
    }
    if (operation?.calibration || operation?.parameterPreview) return result
    const priorReview = await this.findLatestShowPreflight({ sourceId: request.sourceId, libraryId: request.libraryId, seriesIdentityKey: request.seriesIdentityKey, seriesTitle: request.seriesTitle, mediaItemId: request.mediaItemId, seasonNumber: request.seasonNumber })
    if (priorReview) {
      const priorApprovals = priorReview.result.sampleGroupApprovalFingerprints ?? {}
      result.sampleGroupApprovalFingerprints = Object.fromEntries([...this.getSampleGroupFingerprints(result)].filter(([groupId, fingerprint]) => priorApprovals[groupId] === fingerprint))
    }
    getLoggingService().info('[TVOptimization]', `Preflight completed: preflight=${preflightId}, batch=${batchId}, series=${request.seriesIdentityKey ?? 'episode'}, episodes=${episodes.length}, samplingGroupsSelected=${samplingGroups.size}, unclassifiedProfiles=${unclassifiedSamplingProfiles}, measuredSampleRepresentatives=${results.filter(episode => episode.samplingRole === 'measured').length}, projectedEpisodes=${results.filter(episode => episode.samplingRole === 'projected').length}, insufficientEvidence=${results.filter(episode => episode.decisionStatus === 'insufficient_evidence').length}, compatible=${results.filter(episode => episode.compatible).length}, actionable=${results.filter(episode => episode.compatible && episode.operations.length > 0).length}, savingsBytes=${planMetrics.totalEstimatedSavingsBytes ?? 'unknown'}, coverage=${planMetrics.coverage}`)
    await operation?.waitUntilRunning()
      operation?.signal.throwIfAborted()
    operation?.beginCommit()
    this.retainPreflight(preflightId, { request, result })
    await getDatabase().setSetting(`${SHOW_PREFLIGHT_SETTING_PREFIX}${preflightId}`, JSON.stringify({ request, result }))
    const measuredResults = results.filter(plan => plan.sourceAnalysis && (plan.samplingRole || plan.decisionStatus === 'quality_threshold_unmet' || plan.decisionStatus === 'measurement_failed' || plan.decisionStatus === 'incompatible'))
    for (const plan of measuredResults) {
      const analysis = plan.sourceAnalysis!
      await getDatabase().media.updateDeepAnalysisByPath(analysis.filePath, analysis, new Date().toISOString())
      const item = episodes.find(item => item.id === plan.mediaItemId)!
      await getDatabase().media.upsertQualityScore(await getQualityAnalyzer().analyzeMediaItem(item, analysis))
    }
    if (measuredResults.length) getStatsCacheService().invalidate()
    return result
    } finally {
      this.activePreflights--
      if (operation?.calibration && operation.preflightId) await fs.rm(path.join(app.getPath('userData'), 'transcoding-samples', operation.preflightId), { recursive: true, force: true })
      if (this.activePreflights === 0) void this.pruneMeasuredSamples()
    }
  }

  async preflightRemux(mediaItemId: number): Promise<ShowTranscodePreflight> {
    const item = await getDatabase().media.getItemById(mediaItemId)
    if (!item?.source_id || !item.library_id) throw new Error('Media item has no local source and library identity')
    await this.assertAuthorizedItem(mediaItemId)
    const file = item.file_path
    if (!file) throw new Error('Media item has no local file path')
    const stat = await fs.stat(file)
    if (!item.deep_analysis) throw new Error('Persisted file analysis is missing; analyze the item before stream pruning')
    const analysis = JSON.parse(item.deep_analysis) as FileAnalysisResult
    if (!analysis.success || analysis.filePath !== file || analysis.fileSizeBytes !== stat.size || !analysis.audioTracks.length) throw new Error('Persisted file analysis is stale; analyze the item before stream pruning')
    const retained = analysis.audioTracks.filter(track => track.isDefault || track.isCommentary || track.isAudioDescription || track.isAccessibility || track.hasObjectAudio).map(track => track.index)
    if (retained.length === 0) throw new Error('No audio stream is safe to retain automatically; choose retained streams in the review plan.')
    if (retained.length === analysis.audioTracks.length) throw new Error('No safe stream pruning operation is available; every audio stream must be retained')
    const streamSelection: StreamSelectionPolicy = { audio: 'explicit', audioIndexes: retained, subtitle: 'all' }
    // The preflight stores the explicit retained stream indexes as reviewed evidence.
    const retainedAudioIndexes = retained
    const options: TranscodeOptions = { optimizationMode: 'remux_only', targetCodec: (analysis.video?.codec || 'h264') as TranscodeOptions['targetCodec'], outputMode: 'quarantine-replace', useGpu: false, gpuId: '', encoder: 'copy', preset: '', customArgs: '', transcodingEngine: 'ffmpeg', targetSize: '', streamSelection }
    const id = `remux_${Date.now()}_${randomUUID()}`
    const fingerprint = await sha256File(file)
    const result: ShowTranscodePreflight = {
      preflightId: id,
      batchId: id,
      createdAt: new Date().toISOString(),
      seriesTitle: item.title,
      episodeCount: 1,
      compatible: true,
      userApproved: false,
      episodes: [{ mediaItemId, label: item.title, compatible: true, hdrFormat: analysis.video?.hdrFormat || 'SDR', sourceSize: stat.size, sourceMtimeMs: stat.mtimeMs, sourceSha256: fingerprint, operations: ['stream_pruning'], decisionStatus: 'actionable', evidenceStatus: 'measured', confidence: 'high', savingsBasis: `retained audio streams: ${retainedAudioIndexes.join(', ')}`, adviceReason: 'Review explicit retained audio streams before queueing.', options, sourceAnalysis: analysis, audioPlan: getPlannedAudioStreams(analysis, buildStreamSelectionPlan(analysis, options)) }],
    }
    const request: ShowTranscodeRequest = { mediaItemId, sourceId: item.source_id, libraryId: item.library_id, options }
    this.retainPreflight(id, { request, result })
    await getDatabase().setSetting(`${SHOW_PREFLIGHT_SETTING_PREFIX}${id}`, JSON.stringify({ request, result }))
    return result
  }

  /** Retains a small hot set; authoritative reviews are persisted in the database. */
  private retainPreflight(id: string, value: { request: ShowTranscodeRequest; result: ShowTranscodePreflight }): void {
    this.showPreflights.delete(id)
    this.showPreflights.set(id, value)
    while (this.showPreflights.size > 32) this.showPreflights.delete(this.showPreflights.keys().next().value!)
  }

  async queueShowTranscode(preflightId: string): Promise<{ batchId: string; queuedMediaItemIds: number[]; queuedTaskIds: string[] }> {
    let preflight = this.showPreflights.get(preflightId)
    if (!preflight) {
      const saved = await getDatabase().getSetting(`${SHOW_PREFLIGHT_SETTING_PREFIX}${preflightId}`)
      if (saved) {
        try {
          preflight = JSON.parse(saved) as { request: ShowTranscodeRequest; result: ShowTranscodePreflight }
        } catch {
          throw new Error(`Stored show transcode preflight ${preflightId} is invalid; run preflight again`)
        }
      }
    }
    if (!preflight) throw new Error('Show transcode preflight was not found')
    if ((preflight.result.measurementVersion !== MEASUREMENT_VERSION || preflight.result.searchVersion !== OPTIMIZATION_SEARCH_VERSION) && preflight.result.episodes.some(episode => episode.params?.measuredCandidate)) throw new Error('Measurement or search policy changed; run preflight again before queuing this plan')
    const retryableMediaItemIds = preflight.result.queuedAt
      ? (() => {
          const state = getTaskQueueService().getQueueState()
          const activeTasks = [state.currentTask, ...state.queue].filter((task): task is NonNullable<typeof task> => task !== null)
          const activeMediaItemIds = new Set(activeTasks.filter(task => task.batchId === preflight!.result.batchId).map(task => task.mediaItemId).filter((id): id is number => id !== undefined))
          const latestTaskByMediaItemId = new Map<number, (typeof state.completedTasks)[number]>()
          for (const task of [...state.completedTasks].filter(task => task.batchId === preflight!.result.batchId).sort((left, right) => right.createdAt.localeCompare(left.createdAt))) {
            if (task.mediaItemId !== undefined && !latestTaskByMediaItemId.has(task.mediaItemId)) latestTaskByMediaItemId.set(task.mediaItemId, task)
          }
          return new Set((preflight!.result.queuedMediaItemIds ?? []).filter(mediaItemId =>
            !activeMediaItemIds.has(mediaItemId) && ['failed', 'cancelled'].includes(latestTaskByMediaItemId.get(mediaItemId)?.status ?? '')
          ))
        })()
      : undefined
    if (retryableMediaItemIds?.size === 0) return { batchId: preflight.result.batchId, queuedMediaItemIds: [], queuedTaskIds: [] }
    if (preflight.result.capabilityFingerprint) {
      const currentFingerprint = this.getCapabilitySnapshotFingerprint(await this.getCapabilities())
      if (currentFingerprint !== preflight.result.capabilityFingerprint) throw new Error('Hardware capabilities changed after review; run preflight again')
    }
    const currentSampleApprovals = this.withCurrentSampleApprovals(preflight.result)
    const requiredSampleGroupIds = [...this.getSampleGroupFingerprints(preflight.result).keys()]
    if (requiredSampleGroupIds.some(groupId => !currentSampleApprovals.approvedSampleGroupIds?.includes(groupId))) {
      throw new Error('Review and approve every measured sample group before queueing this plan')
    }
    const queueableEpisodes = preflight.result.episodes.filter(episode =>
      episode.compatible && (episode.decisionStatus === 'actionable' || (episode.decisionStatus === 'sample_required' && preflight?.result.userApproved === true)) &&
      (retryableMediaItemIds === undefined || retryableMediaItemIds.has(episode.mediaItemId))
    )
    if (queueableEpisodes.length === 0) {
      throw new Error('No episodes have sufficient evidence for a safe optimization action.')
    }
    if (preflight.result.userApproved && preflight.result.approvalFingerprint !== this.preflightFingerprint(preflight.result)) throw new Error('Approved show plan changed; run preflight again')
    for (const episode of queueableEpisodes) {
      if (!episode.sourceSha256) throw new Error(`Reviewed plan for ${episode.label} has no source fingerprint; run preflight again`)
      const item = await this.assertAuthorizedItem(episode.mediaItemId)
      const stat = await fs.stat(item.file_path!)
      if (stat.size !== episode.sourceSize || Math.abs(stat.mtimeMs - episode.sourceMtimeMs) > 1000) {
        throw new Error(`Source file changed after reviewing ${episode.label}; run preflight again`)
      }
      if (episode.targetProfile && JSON.stringify(await getDatabase().playbackTargetProfiles.get(episode.targetProfile.id)) !== JSON.stringify(episode.targetProfile)) throw new Error('Playback profile changed after review; run preflight again')
      if (episode.samplePaths && (await Promise.all(episode.samplePaths.map(sha256File))).some((hash, index) => hash !== episode.sampleHashes![index])) throw new Error('Reviewed samples changed; run preflight again')
    }
    const tasks = queueableEpisodes.map(episode => ({
      type: TaskType.Transcode,
      label: episode.label,
      mediaItemId: episode.mediaItemId,
      batchId: preflight.result.batchId,
      sourceId: preflight.request.sourceId,
      libraryId: preflight.request.libraryId,
      options: { ...episode.options, queuePayload: { batchId: preflight.result.batchId, preflightId, sourceSize: episode.sourceSize, sourceMtimeMs: episode.sourceMtimeMs, sourceSha256: episode.sourceSha256, params: episode.params, sourceAnalysis: episode.sourceAnalysis, targetProfile: episode.targetProfile, samplePaths: episode.samplePaths, sampleRepresentativeMediaItemId: episode.sampleRepresentativeMediaItemId ?? episode.mediaItemId, capabilityFingerprint: preflight.result.capabilityFingerprint } }
    }))
    getLoggingService().info('[TVOptimization]', `Queue requested: preflight=${preflightId}, batch=${preflight.result.batchId}, eligibleEpisodes=${queueableEpisodes.length}, userApproved=${preflight.result.userApproved}`)
    const taskIds = await getTaskQueueService().addTasks(tasks)
    if (taskIds.length !== tasks.length || taskIds.some(id => id.length === 0)) throw new Error('The task queue could not accept every episode in this optimization plan')
    const queued = {
      ...preflight.result,
      queuedAt: new Date().toISOString(),
      queuedMediaItemIds: [...new Set([...(preflight.result.queuedMediaItemIds ?? []), ...queueableEpisodes.map(episode => episode.mediaItemId)])],
      queuedTaskIds: [...new Set([...(preflight.result.queuedTaskIds ?? []), ...taskIds])],
    }
    this.retainPreflight(preflightId, { ...preflight, result: queued })
    await getDatabase().setSetting(`${SHOW_PREFLIGHT_SETTING_PREFIX}${preflightId}`, JSON.stringify({ ...preflight, result: queued }))
    getLoggingService().info('[TVOptimization]', `Queue completed: preflight=${preflightId}, batch=${preflight.result.batchId}, queuedMediaItems=${queueableEpisodes.length}`)
    return { batchId: preflight.result.batchId, queuedMediaItemIds: queueableEpisodes.map(episode => episode.mediaItemId), queuedTaskIds: taskIds }
  }

  async getShowPreflight(preflightId: string): Promise<{ request: ShowTranscodeRequest; result: ShowTranscodePreflight } | undefined> {
    const raw = await getDatabase().getSetting(`${SHOW_PREFLIGHT_SETTING_PREFIX}${preflightId}`)
    if (!raw) return undefined
    const preflight = JSON.parse(raw) as { request: ShowTranscodeRequest; result: ShowTranscodePreflight }
    return { ...preflight, result: this.withCurrentSampleApprovals(preflight.result) }
  }

  private getSampleGroupFingerprints(result: ShowTranscodePreflight): Map<string, string> {
    const groups = new Map<string, ShowTranscodePreflight['episodes']>()
    for (const episode of result.episodes) {
      if (episode.decisionStatus !== 'sample_required' || !episode.params?.measuredCandidate || !episode.samplePaths?.length) continue
      const representativeId = episode.sampleRepresentativeMediaItemId ?? episode.mediaItemId
      const groupId = JSON.stringify([representativeId, episode.sampleHashes ?? []])
      groups.set(groupId, [...(groups.get(groupId) ?? []), episode])
    }
    return new Map([...groups].map(([groupId, episodes]) => {
      const fingerprintContent = [...episodes].sort((left, right) => left.mediaItemId - right.mediaItemId).map(episode => ({
        mediaItemId: episode.mediaItemId,
        sourceSha256: episode.sourceSha256,
        params: episode.params && {
          encoder: episode.params.encoder,
          crf: episode.params.crf,
          preset: episode.params.preset,
          measuredCandidate: episode.params.measuredCandidate && {
            encoder: episode.params.measuredCandidate.encoder,
            preset: episode.params.measuredCandidate.preset,
            quality: episode.params.measuredCandidate.quality,
            outputBytes: episode.params.measuredCandidate.outputBytes,
            sampledDurationSeconds: episode.params.measuredCandidate.sampledDurationSeconds,
            vmafMean: episode.params.measuredCandidate.vmafMean,
            vmafP5: episode.params.measuredCandidate.vmafP5,
            cambiMean: episode.params.measuredCandidate.cambiMean,
          },
        },
        options: episode.options,
        targetProfile: episode.targetProfile,
        operations: episode.operations,
        changes: episode.changes,
      }))
      return [groupId, createHash('sha256').update(JSON.stringify(fingerprintContent)).digest('hex')]
    }))
  }

  private withCurrentSampleApprovals(result: ShowTranscodePreflight): ShowTranscodePreflight {
    const current = this.getSampleGroupFingerprints(result)
    const approvedSampleGroupIds = [...current].filter(([groupId, fingerprint]) => result.sampleGroupApprovalFingerprints?.[groupId] === fingerprint).map(([groupId]) => groupId)
    return { ...result, approvedSampleGroupIds }
  }

  async setShowSampleApproval(preflightId: string, groupId: string, approved: boolean): Promise<string[]> {
    let preflight = this.showPreflights.get(preflightId)
    if (!preflight) {
      const saved = await getDatabase().getSetting(`${SHOW_PREFLIGHT_SETTING_PREFIX}${preflightId}`)
      if (saved) preflight = JSON.parse(saved) as { request: ShowTranscodeRequest; result: ShowTranscodePreflight }
    }
    if (!preflight) throw new Error('Show transcode preflight was not found')
    const fingerprint = this.getSampleGroupFingerprints(preflight.result).get(groupId)
    if (!fingerprint) throw new Error('The sample group is no longer part of this review')
    const sampleGroupApprovalFingerprints = { ...preflight.result.sampleGroupApprovalFingerprints }
    if (approved) sampleGroupApprovalFingerprints[groupId] = fingerprint
    else delete sampleGroupApprovalFingerprints[groupId]
    const result = { ...preflight.result, sampleGroupApprovalFingerprints }
    if (!approved && result.userApproved) {
      result.userApproved = false
      delete result.approvedAt
      delete result.approvalFingerprint
    }
    this.retainPreflight(preflightId, { ...preflight, result })
    await getDatabase().setSetting(`${SHOW_PREFLIGHT_SETTING_PREFIX}${preflightId}`, JSON.stringify({ ...preflight, result }))
    getLoggingService().info('[TVOptimization]', 'Sample group approval updated', {
      event: approved ? 'sample-group.approved' : 'sample-group.approval-revoked',
      preflightId,
      batchId: result.batchId,
      groupId,
      memberMediaItemIds: result.episodes.filter(episode => JSON.stringify([episode.sampleRepresentativeMediaItemId ?? episode.mediaItemId, episode.sampleHashes ?? []]) === groupId).map(episode => episode.mediaItemId),
    })
    return this.withCurrentSampleApprovals(result).approvedSampleGroupIds ?? []
  }

  async findLatestShowPreflight(identity: Pick<ShowTranscodeRequest, 'sourceId' | 'libraryId' | 'seriesIdentityKey' | 'seriesTitle' | 'mediaItemId' | 'seasonNumber'>): Promise<{ request: ShowTranscodeRequest; result: ShowTranscodePreflight } | undefined> {
    const savedPreflights = await getDatabase().getSettingsByPrefix(SHOW_PREFLIGHT_SETTING_PREFIX)
    const matches = Object.entries(savedPreflights)
      .flatMap(([key, raw]) => {
        try {
          const preflight = JSON.parse(raw) as { request: ShowTranscodeRequest; result: ShowTranscodePreflight }
          const request = preflight.request
          return request.sourceId === identity.sourceId && request.libraryId === identity.libraryId &&
            request.seriesIdentityKey === identity.seriesIdentityKey && request.mediaItemId === identity.mediaItemId &&
            request.seasonNumber === identity.seasonNumber
            ? [preflight]
            : []
        } catch (error) {
          getLoggingService().warn('[TVOptimization]', `Ignoring unreadable saved preflight ${key}: ${getErrorMessage(error)}`)
          return []
        }
      })
    const episodes: MediaItem[] = identity.mediaItemId === undefined
      ? getDatabase().getMediaItems({ type: 'episode', sourceId: identity.sourceId, libraryId: identity.libraryId })
        .filter(item => item.series_identity_key === identity.seriesIdentityKey &&
          (identity.seasonNumber === undefined || item.season_number === identity.seasonNumber))
      : [getDatabase().getMediaItem(identity.mediaItemId)].filter((item): item is MediaItem => item !== null)
    let capabilityFingerprint: string | undefined
    for (const preflight of matches.sort((left, right) => (right.result.createdAt ?? '').localeCompare(left.result.createdAt ?? ''))) {
      if ((preflight.result.measurementVersion !== MEASUREMENT_VERSION || preflight.result.searchVersion !== OPTIMIZATION_SEARCH_VERSION) && preflight.request.options.optimizationMode !== 'remux_only') continue
      const expectedEpisodes = preflight.request.selectedMediaItemIds
        ? episodes.filter(episode => episode.id !== undefined && preflight.request.selectedMediaItemIds!.includes(episode.id))
        : episodes
      const savedMediaItemIds = preflight.result.episodes.map(plan => plan.mediaItemId).sort((left, right) => left - right)
      const expectedMediaItemIds = expectedEpisodes.map(episode => episode.id!).sort((left, right) => left - right)
      if (preflight.request.selectedMediaItemIds && expectedEpisodes.length !== preflight.request.selectedMediaItemIds.length ||
        preflight.result.episodeCount !== expectedEpisodes.length || preflight.result.episodes.length !== expectedEpisodes.length ||
        savedMediaItemIds.some((mediaItemId, index) => mediaItemId !== expectedMediaItemIds[index])) {
        getLoggingService().info('[TVOptimization]', `Saved preflight does not match current episode membership: preflight=${preflight.result.preflightId}`)
        continue
      }
      const savedProfile = preflight.result.episodes.find(plan => plan.targetProfile)?.targetProfile
      const currentProfile = savedProfile ? await getDatabase().playbackTargetProfiles.get(savedProfile.id) : undefined
      if (JSON.stringify(savedProfile) !== JSON.stringify(currentProfile)) {
        getLoggingService().info('[TVOptimization]', `Saved preflight does not match the current playback profile: preflight=${preflight.result.preflightId}`)
        continue
      }
      if (preflight.result.capabilityFingerprint) {
        capabilityFingerprint ??= this.getCapabilitySnapshotFingerprint(await this.getCapabilities())
        if (preflight.result.capabilityFingerprint !== capabilityFingerprint) {
          getLoggingService().info('[TVOptimization]', `Saved preflight does not match current encoder capabilities: preflight=${preflight.result.preflightId}`)
          continue
        }
      }
      const plans = new Map(preflight.result.episodes.map(plan => [plan.mediaItemId, plan]))
      let sameData = plans.size === expectedEpisodes.length
      for (const episode of expectedEpisodes) {
        if (!sameData || !episode.id) break
        const plan = plans.get(episode.id)
        if (!plan || plan.sourceSize <= 0) {
          sameData = false
          break
        }
        const item = await this.assertAuthorizedItem(episode.id)
        const stat = await fs.stat(item.file_path!)
        sameData = stat.size === plan.sourceSize && Math.abs(stat.mtimeMs - plan.sourceMtimeMs) <= 1000
      }
      if (sameData) return { ...preflight, result: this.withCurrentSampleApprovals(preflight.result) }
      getLoggingService().info('[TVOptimization]', `Saved preflight does not match current episode data: preflight=${preflight.result.preflightId}`)
    }
    return undefined
  }

  private async assertAuthorizedItem(mediaItemId: number): Promise<MediaItem> {
    const db = getDatabase()
    const item = db.getMediaItem(mediaItemId)
    if (!item?.file_path || !item.source_id) throw new Error('Media item has no local source path')
    const source = await db.getMediaSource(item.source_id)
    if (!source) throw new Error('Media source was not found')
    MediaPathAuthorization.assertMediaAuthorized(item, source)
    return item
  }

  private async writeActivationJournal(mediaItemId: number, state: Record<string, unknown>): Promise<void> {
    await getDatabase().setSetting(`transcoding.activation.${mediaItemId}`, JSON.stringify({ mediaItemId, ...state, updatedAt: new Date().toISOString() }))
  }

  private async ensureInitialized(): Promise<void> {
    if (this.initializedPromise) return this.initializedPromise
    this.initializedPromise = this.initializePaths()
    return this.initializedPromise
  }

  private async initializePaths() {
    const db = getDatabase()
    if (!db.isInitialized) {
      throw new Error('Database not initialized. Cannot load transcoding tool paths.')
    }

    getLoggingService().debug('[TranscodingService]', 'FFmpeg-only transcoding paths initialized')
    await this.recoverActivationJournals()
  }

  private async verifyActivationOutput(filePath: string, analysis: FileAnalysisResult): Promise<void> {
    const fingerprint = analysis.sourceFingerprint
    if (!analysis.success || !fingerprint || (await fs.stat(filePath)).size !== fingerprint.size || await sha256File(filePath) !== fingerprint.sha256) {
      throw new Error(`Activation output differs from verified evidence: ${filePath}`)
    }
  }

  private async publishActivationOutput(tempPath: string, targetPath: string): Promise<void> {
    // A same-volume hard link publishes the verified output without replacing any
    // existing destination. If interrupted between link and unlink, resume only
    // when both names reference the same file.
    try {
      await fs.link(tempPath, targetPath)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      const [temp, target] = await Promise.all([fs.stat(tempPath), fs.lstat(targetPath)])
      if (!target.isFile() || temp.dev !== target.dev || temp.ino !== target.ino) throw error
    }
    await fs.unlink(tempPath)
  }

  private async recoverActivationJournals(): Promise<void> {
    const db = getDatabase()
    const journals = await db.getSettingsByPrefix('transcoding.activation.')
    for (const [key, value] of Object.entries(journals)) {
      const journal = JSON.parse(value as string) as {
        mediaItemId: number
        phase: string
        inputPath: string
        tempPath?: string
        targetPath?: string
        quarantinePath?: string
        mode?: TranscodeOptions['outputMode']
        outputStats?: FileAnalysisResult
      }
      if (!journal.mediaItemId || !journal.phase || !journal.inputPath) throw new Error(`Invalid transcoding activation journal: ${key}`)
      const exists = async (filePath: string | undefined): Promise<boolean> => {
        if (!filePath) return false
        try { await fs.access(filePath); return true } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error }
      }
      const inputExists = await exists(journal.inputPath)
      let targetExists = await exists(journal.targetPath)
      let quarantineExists = await exists(journal.quarantinePath)
      let tempExists = await exists(journal.tempPath)

      const job = await db.mediaRemuxJobs.getLatest(journal.mediaItemId)
      if (!job || job.sourcePath !== journal.inputPath || (job.quarantinePath !== null && job.quarantinePath !== journal.quarantinePath)) {
        throw new Error(`Activation recovery cannot identify the original job for media item ${journal.mediaItemId}`)
      }
      if (quarantineExists && await sha256File(journal.quarantinePath!) !== job.sourceSha256) throw new Error('Quarantined source differs from its recorded fingerprint')

      if ((journal.phase === 'prepared' || journal.phase === 'source_quarantined') && tempExists && journal.targetPath && journal.quarantinePath && journal.outputStats?.success && journal.mode) {
        await this.verifyActivationOutput(journal.tempPath!, journal.outputStats)
        if (!quarantineExists) {
          if (path.resolve(journal.inputPath) !== path.resolve(journal.targetPath) && targetExists) throw new Error('Activation destination already exists')
          if (await sha256File(journal.inputPath) !== job.sourceSha256) throw new Error('Source changed before activation recovery')
          await db.mediaRemuxJobs.update(job.id, { quarantinePath: journal.quarantinePath })
          await fs.rename(journal.inputPath, journal.quarantinePath)
        }
        await this.publishActivationOutput(journal.tempPath!, journal.targetPath)
        targetExists = true
        quarantineExists = true
        tempExists = false
      }

      // Crash occurred after source was quarantined but before target was placed
      if ((journal.phase === 'source_quarantined' || journal.phase === 'prepared') && !targetExists && quarantineExists && !inputExists) {
        await this.publishActivationOutput(journal.quarantinePath!, journal.inputPath)
        if (tempExists) await fs.unlink(journal.tempPath!)
        await db.mediaRemuxJobs.update(job.id, { status: 'failed', quarantinePath: null, error: 'Activation interrupted; original restored' })
        await db.deleteSetting(key)
        getLoggingService().info('[TranscodingService]', `Rollback completed for media item ${journal.mediaItemId} from quarantine`)
        continue
      }

      // Crash occurred after target file was successfully placed/activated
      if ((journal.phase === 'output_activated' || journal.phase === 'source_quarantined' || (journal.phase === 'prepared' && quarantineExists && !tempExists)) && targetExists && journal.targetPath) {
        // Ensure database points to the newly activated target path
        const analysis = journal.outputStats
        if (!analysis) throw new Error('Activation recovery requires recorded verified output analysis')
        await this.verifyActivationOutput(journal.targetPath, analysis)
        await db.media.updatePathAndStats(journal.mediaItemId, journal.targetPath, { ...analysis, filePath: journal.targetPath })
        this.analysisCache.delete(journal.inputPath)
        this.analysisCache.delete(journal.targetPath)
        getStatsCacheService().invalidate()
        if (job.quarantinePath !== journal.quarantinePath && !quarantineExists) throw new Error('Activation recovery has no matching quarantine evidence')
        const verifiedJobOutput = job.outputAnalysis ? JSON.parse(job.outputAnalysis) as { qualityVerification?: unknown } : undefined
        const encodedReductionBytes = job.sourceSize - analysis.sourceFingerprint!.size
        const retainedOriginalBytes = journal.mode === 'replace' ? 0 : job.sourceSize
        await db.mediaRemuxJobs.update(job.id, { status: 'promoted', error: null, actualOutputBytes: analysis.sourceFingerprint!.size, bytesSaved: encodedReductionBytes, outputDurationMs: analysis.durationMs, outputAnalysis: JSON.stringify({ ...analysis, filePath: journal.targetPath, encodedReductionBytes, retainedOriginalBytes, physicallyReclaimedBytes: journal.mode === 'replace' ? encodedReductionBytes : 0, qualityVerification: verifiedJobOutput?.qualityVerification }) })
        if (journal.mode === 'replace' && quarantineExists) {
          await this.verifyActivationOutput(journal.targetPath, analysis)
          if (await sha256File(journal.quarantinePath!) !== job.sourceSha256) throw new Error('Quarantined source changed before removal')
          await fs.unlink(journal.quarantinePath!)
        }
        await db.deleteSetting(key)
        getLoggingService().info('[TranscodingService]', `Committed forward activation recovery for media item ${journal.mediaItemId}`)
        continue
      }

      // Crash in prepared phase where neither source was quarantined nor target placed
      if (journal.phase === 'prepared' && inputExists && !quarantineExists) {
        if (tempExists) await fs.unlink(journal.tempPath!)
        await db.mediaRemuxJobs.update(job.id, { status: 'failed', quarantinePath: null, error: 'Activation interrupted before source quarantine' })
        await db.deleteSetting(key)
        getLoggingService().info('[TranscodingService]', `Discarded prepared activation journal for media item ${journal.mediaItemId}`)
        continue
      }

      throw new Error(`Unresolved transcoding activation journal for media item ${journal.mediaItemId}; manual recovery is required`)
    }
  }

  /**
   * For testing: Override tool availability
   */
  /**
   * Check which tools are available on the system
   */
  async checkAvailability(): Promise<{ ffmpeg: boolean }> {
    await this.ensureInitialized()

    const analyzer = getMediaFileAnalyzer()
    const ffmpegAvailable = await analyzer.isFFmpegAvailable()

    return { ffmpeg: ffmpegAvailable }
  }

  async getCapabilities(options: { refresh?: boolean } = {}): Promise<TranscodingCapabilities> {
    const cacheFresh = Date.now() - this.capabilitiesCachedAt < 10 * 60 * 1000
    if (this.capabilitiesPromise && !options.refresh && cacheFresh) return this.capabilitiesPromise
    this.capabilitiesCachedAt = Date.now()
    this.capabilitiesPromise = (async () => {
      const [availability, detectedGpus] = await Promise.all([
        this.checkAvailability(),
        GpuDetector.detectGpus({ refresh: options.refresh || !cacheFresh })
      ])
      const gpus = await this.resolveGpuEncoderDevices(detectedGpus)
      const persistedSelection = await getDatabase().getSetting('selected_transcoding_gpu_id')
      const selectedGpuId = persistedSelection && gpus.some(gpu => gpu.id === persistedSelection)
        ? persistedSelection
        : null
      const fingerprint = await this.getCapabilitiesFingerprint(availability.ffmpeg, gpus)
      if (!options.refresh) {
        const cachedSnapshot = await getDatabase().getSetting(TranscodingService.CAPABILITIES_CACHE_KEY)
        if (cachedSnapshot) {
          const cached = JSON.parse(cachedSnapshot) as TranscodingCapabilitiesCacheRecord
          if (cached.fingerprint === fingerprint) {
            getLoggingService().info('[TranscodingService]', `Reusing verified encoder capabilities captured at ${cached.detectedAt}`)
            const capabilities = buildTranscodingCapabilities(availability, gpus, selectedGpuId, cached.deviceEncoders)
            return { ...capabilities, detectedAt: cached.detectedAt, snapshotFingerprint: fingerprint }
          }
          getLoggingService().info('[TranscodingService]', 'Encoder capability environment changed; probing encoders again')
        }
      } else {
        getLoggingService().info('[TranscodingService]', 'Refreshing encoder capability snapshot by request')
      }
      const encoderProbe = await this.probeFfmpegEncoders(gpus)
      if (encoderProbe.failures.length > 0) {
        getLoggingService().warn('[TranscodingService]', `FFmpeg capability detection: ${encoderProbe.failures.join('; ')}`)
      }
      const capabilities = buildTranscodingCapabilities(availability, gpus, selectedGpuId, encoderProbe.deviceEncoders)
      await getDatabase().setSetting(TranscodingService.CAPABILITIES_CACHE_KEY, JSON.stringify({ fingerprint, detectedAt: capabilities.detectedAt, deviceEncoders: capabilities.deviceEncoders } satisfies TranscodingCapabilitiesCacheRecord))
      getLoggingService().info('[TranscodingService]', `Hardware snapshot captured at ${capabilities.detectedAt}: ${gpus.length} GPU(s), device encoders=${JSON.stringify(capabilities.deviceEncoders)}`)
      return { ...capabilities, snapshotFingerprint: fingerprint }
    })().catch(error => {
      this.capabilitiesPromise = null
      throw error
    })
    return this.capabilitiesPromise
  }

  private async getCapabilitiesFingerprint(ffmpegAvailable: boolean, gpus: GpuInfo[]): Promise<string> {
    const ffmpegPath = getMediaFileAnalyzer().getFFmpegPath()
    const ffmpegBuild = ffmpegAvailable ? await new Promise<string>((resolve, reject) => {
      const proc = spawn(PathUtils.resolveExecutablePath(ffmpegPath), ['-hide_banner', '-version'], { windowsHide: true, timeout: 5000 })
      let output = ''
      proc.stdout.on('data', data => { output += data.toString() })
      proc.stderr.on('data', data => { output += data.toString() })
      proc.once('error', reject)
      proc.once('close', code => code === 0 ? resolve(output) : reject(new Error(`FFmpeg version probe exited with code ${code}`)))
    }) : 'unavailable'
    const environment = JSON.stringify({
      ffmpegAvailable,
      platform: process.platform,
      systemRelease: os.release(),
      ffmpegPath: PathUtils.resolveExecutablePath(ffmpegPath),
      ffmpegBuild,
      gpus: [...gpus].sort((a, b) => a.id.localeCompare(b.id)).map(({ id, name, vendor, driverVersion, encoderDeviceSelector, renderDevicePath }) => ({ id, name, vendor, driverVersion, encoderDeviceSelector, renderDevicePath })),
    })
    return createHash('sha256').update(environment).digest('hex')
  }

  private getCapabilitySnapshotFingerprint(capabilities: TranscodingCapabilities): string {
    if (!capabilities.snapshotFingerprint) throw new Error('Transcoding capability snapshot has no environment fingerprint')
    const deviceEncoders = Object.entries(capabilities.deviceEncoders).sort(([a], [b]) => a.localeCompare(b)).map(([id, encoders]) => [id, [...encoders].sort()])
    return createHash('sha256').update(JSON.stringify({ environment: capabilities.snapshotFingerprint, deviceEncoders })).digest('hex')
  }

  private async resolveGpuEncoderDevices(gpus: GpuInfo[]): Promise<GpuInfo[]> {
    if (!gpus.length) return gpus
    const ffmpegPath = getMediaFileAnalyzer().getFFmpegPath()
    if (!ffmpegPath) return gpus
    if (process.platform === 'win32') {
      const adapterResults = await Promise.all(gpus.map(async (_, adapterIndex) => {
        try {
          const result = await this.runCapabilityProcess(ffmpegPath, [
            '-hide_banner', '-loglevel', 'info',
            '-init_hw_device', `d3d11va=adapter:${adapterIndex}`,
            '-f', 'lavfi', '-i', 'color=c=black:s=16x16:d=0.04',
            '-frames:v', '1', '-f', 'null', '-'
          ])
          const match = result.output.match(/Using device [0-9a-f]{4}:[0-9a-f]{4} \((.+)\)\./i)
          return match ? { adapterIndex, name: match[1].trim() } : { adapterIndex, error: result.output || `Adapter probe exited with code ${result.code}` }
        } catch (error) {
          return { adapterIndex, error: getErrorMessage(error) }
        }
      }))
      const validMatches = adapterResults.filter((result): result is { adapterIndex: number; name: string } => 'name' in result)
      const failures = adapterResults.filter((result): result is { adapterIndex: number; error: string } => 'error' in result)
      for (const failure of failures) getLoggingService().warn('[TranscodingService]', `DirectX adapter ${failure.adapterIndex} could not be enumerated: ${failure.error}`)
      return gpus.map(gpu => {
        const osMatches = gpus.filter(candidate => candidate.name.localeCompare(gpu.name, undefined, { sensitivity: 'accent' }) === 0)
        const ffmpegMatches = validMatches.filter(match => match.name.localeCompare(gpu.name, undefined, { sensitivity: 'accent' }) === 0)
        if (osMatches.length !== 1 || ffmpegMatches.length !== 1) {
          getLoggingService().warn('[TranscodingService]', `Physical GPU selector unresolved for ${gpu.name}: OS matches=${osMatches.length}, FFmpeg adapter matches=${ffmpegMatches.length}`)
          return gpu
        }
        getLoggingService().info('[TranscodingService]', `Mapped ${gpu.name} to FFmpeg DirectX adapter ${ffmpegMatches[0].adapterIndex}`)
        return { ...gpu, encoderDeviceSelector: { kind: 'directx', index: ffmpegMatches[0].adapterIndex } }
      })
    }
    if (process.platform === 'linux') return this.resolveLinuxEncoderDevices(gpus, ffmpegPath)
    return gpus
  }

  private async resolveLinuxEncoderDevices(gpus: GpuInfo[], ffmpegPath: string): Promise<GpuInfo[]> {
    const mappedGpus = gpus.map(gpu => gpu.vendor === 'Intel' && gpu.renderDevicePath
      ? { ...gpu, encoderDeviceSelector: { kind: 'drm' as const, path: gpu.renderDevicePath } }
      : gpu)
    const nvidiaGpus = mappedGpus.filter(gpu => gpu.vendor === 'NVIDIA')
    if (!nvidiaGpus.length) return mappedGpus
    let inventory: { code: number | null; output: string }
    try {
      inventory = await this.runCapabilityProcess('nvidia-smi', ['--query-gpu=pci.bus_id,name', '--format=csv,noheader,nounits'])
    } catch (error) {
      getLoggingService().warn('[TranscodingService]', `NVIDIA PCI inventory unavailable: ${getErrorMessage(error)}`)
      return mappedGpus
    }
    if (inventory.code !== 0) {
      getLoggingService().warn('[TranscodingService]', `NVIDIA PCI inventory unavailable: ${inventory.output || `exit code ${inventory.code}`}`)
      return mappedGpus
    }
    const nvidiaDevices = inventory.output.split(/\r?\n/).filter(Boolean).map(line => {
      const [busId, ...name] = line.split(',').map(part => part.trim())
      const [domain, bus, deviceFunction] = busId.split(':')
      const pciAddress = `${domain.slice(-4).padStart(4, '0')}:${bus}:${deviceFunction}`.toLowerCase()
      return { pciAddress, name: name.join(',') }
    })
    let nvencListing: { code: number | null; output: string }
    try {
      nvencListing = await this.runCapabilityProcess(ffmpegPath, [
        '-hide_banner', '-loglevel', 'verbose', '-f', 'lavfi', '-i', 'color=c=black:s=16x16:d=0.04',
        '-frames:v', '1', '-c:v', 'h264_nvenc', '-gpu', 'list', '-f', 'null', '-'
      ])
    } catch (error) {
      getLoggingService().warn('[TranscodingService]', `NVENC device list unavailable: ${getErrorMessage(error)}`)
      return mappedGpus
    }
    const nvencDevices = [...nvencListing.output.matchAll(/GPU #(\d+)\s*-\s*<\s*(.+?)\s*>/gi)]
      .map(match => ({ index: Number(match[1]), name: match[2].trim() }))
    return mappedGpus.map(gpu => {
      if (gpu.vendor !== 'NVIDIA') return gpu
      const pciMatches = nvidiaDevices.filter(device => gpu.id.endsWith(device.pciAddress))
      const nvencMatches = nvencDevices.filter(device => pciMatches.some(pci => {
        const inventoryName = pci.name.replace(/^NVIDIA\s+/i, '').trim()
        return inventoryName.localeCompare(device.name.replace(/^NVIDIA\s+/i, '').trim(), undefined, { sensitivity: 'accent' }) === 0
      }))
      if (pciMatches.length !== 1 || nvencMatches.length !== 1) {
        getLoggingService().warn('[TranscodingService]', `Physical NVENC selector unresolved for ${gpu.name}: PCI matches=${pciMatches.length}, NVENC matches=${nvencMatches.length}`)
        return gpu
      }
      getLoggingService().info('[TranscodingService]', `Mapped ${gpu.name} to NVENC device ${nvencMatches[0].index}`)
      return { ...gpu, encoderDeviceSelector: { kind: 'nvenc', index: nvencMatches[0].index } }
    })
  }

  private runCapabilityProcess(binary: string, args: string[], timeoutMs = 5000): Promise<{ code: number | null; output: string }> {
    return new Promise((resolve, reject) => {
      const child = spawn(PathUtils.resolveExecutablePath(binary), args, { windowsHide: true, timeout: timeoutMs })
      let output = ''
      child.stdout.on('data', data => { output += data.toString() })
      child.stderr.on('data', data => { output += data.toString() })
      child.once('error', reject)
      child.once('close', code => resolve({ code, output }))
    })
  }

  private async probeFfmpegEncoders(gpus: GpuInfo[]): Promise<{ deviceEncoders: Record<string, string[]>; failures: string[] }> {
    const ffmpegPath = getMediaFileAnalyzer().getFFmpegPath()
    if (!ffmpegPath) return {
      deviceEncoders: { software: [], ...Object.fromEntries(gpus.map(gpu => [gpu.id, []])) },
      failures: ['FFmpeg path is unavailable']
    }
    let encoderListing: { code: number | null; output: string }
    try {
      encoderListing = await this.runCapabilityProcess(ffmpegPath, ['-hide_banner', '-encoders'])
    } catch (error) {
      return { deviceEncoders: { software: [], ...Object.fromEntries(gpus.map(gpu => [gpu.id, []])) }, failures: [`Failed to execute ${ffmpegPath}: ${getErrorMessage(error)}`] }
    }
    if (encoderListing.code !== 0) return {
      deviceEncoders: { software: [], ...Object.fromEntries(gpus.map(gpu => [gpu.id, []])) },
      failures: [`FFmpeg encoder probe exited with code ${encoderListing.code}: ${encoderListing.output}`]
    }
    const ffmpegNames = [...encoderListing.output.matchAll(/^\s*[A-Z.]+\s+(\S+)/gm)].map(match => match[1])
    const encoderByFfmpegName = new Map(Object.entries(ENCODER_PROBES).map(([encoder, probe]) => [probe.ffmpegName, encoder]))
    const encoderNames = ffmpegNames.flatMap(name => {
      const encoder = encoderByFfmpegName.get(name)
      return encoder ? [encoder] : []
    })
    getLoggingService().debug('[TranscodingService]', `FFmpeg encoder verification completed: ${ffmpegNames.length} encoders found`)
    const deviceEncoders: Record<string, string[]> = {}
    const failures: string[] = []
    const softwareEncoders: string[] = []
    for (const encoder of encoderNames) {
      const device = ENCODER_PROBES[encoder]
      if (device.vendor) continue
      try {
        const result = await this.runCapabilityProcess(ffmpegPath, ['-v', 'error', '-f', 'lavfi', '-i', `testsrc2=size=${APP_CONFIG.transcoding.encoderProbeWidth}x${APP_CONFIG.transcoding.encoderProbeHeight}`, '-frames:v', '1', '-c:v', device.ffmpegName, ...(device.arguments ?? []), '-f', 'null', '-'], 30000)
        if (result.code !== 0) throw new Error(result.output || `FFmpeg exited with code ${result.code}`)
        softwareEncoders.push(encoder)
      } catch (error) {
        failures.push(`Encoder ${encoder} (software): ${getErrorMessage(error)}`)
      }
    }
    deviceEncoders.software = softwareEncoders

    for (const gpu of gpus) {
      const encoders: string[] = []
      const encoderInitializationArgs = this.getEncoderDeviceInitializationArgs(gpu)
      if (!encoderInitializationArgs) {
        failures.push(`No adapter-pinned FFmpeg device selector is available for ${gpu.name} on ${process.platform}`)
        deviceEncoders[gpu.id] = []
        continue
      }
      for (const encoder of encoderNames) {
        const device = ENCODER_PROBES[encoder]
        if (device.vendor !== gpu.vendor) continue
        try {
          const result = await this.runCapabilityProcess(ffmpegPath, [
            '-v', 'error', ...encoderInitializationArgs,
            '-f', 'lavfi', '-i', `testsrc2=size=${APP_CONFIG.transcoding.encoderProbeWidth}x${APP_CONFIG.transcoding.encoderProbeHeight}`,
            '-frames:v', '1', '-c:v', device.ffmpegName,
            ...(process.platform === 'linux' && gpu.vendor === 'NVIDIA' ? ['-gpu', String(gpu.encoderDeviceSelector?.kind === 'nvenc' ? gpu.encoderDeviceSelector.index : ''), '-vf', 'format=nv12'] : ['-vf', 'format=nv12,hwupload']),
            ...(device.arguments ?? []), '-f', 'null', '-'
          ], 30000)
          if (result.code !== 0) throw new Error(result.output || `FFmpeg exited with code ${result.code}`)
          encoders.push(encoder)
        } catch (error) {
          failures.push(`Encoder ${encoder} on ${gpu.name}: ${getErrorMessage(error)}`)
        }
      }
      deviceEncoders[gpu.id] = encoders
    }
    return { deviceEncoders, failures }
  }

  private getEncoderDeviceInitializationArgs(gpu: GpuInfo): string[] | undefined {
    if (gpu.vendor === 'Apple') return undefined
    if (process.platform === 'linux' && gpu.vendor === 'NVIDIA' && gpu.encoderDeviceSelector?.kind === 'nvenc') return []
    if (process.platform === 'win32') {
      if (gpu.encoderDeviceSelector?.kind !== 'directx') return undefined
      if (gpu.vendor === 'Intel') return ['-init_hw_device', `qsv=selected:hw,child_device=${gpu.encoderDeviceSelector.index},child_device_type=d3d11va`, '-filter_hw_device', 'selected']
      if (gpu.vendor === 'NVIDIA' || gpu.vendor === 'AMD') return ['-init_hw_device', `d3d11va=selected:${gpu.encoderDeviceSelector.index}`, '-filter_hw_device', 'selected']
    }
    if (process.platform === 'linux' && gpu.vendor === 'Intel' && gpu.encoderDeviceSelector?.kind === 'drm') {
      return ['-init_hw_device', `qsv=selected:hw,child_device=${gpu.encoderDeviceSelector.path}`, '-filter_hw_device', 'selected']
    }
    return undefined
  }

  async setSelectedGpu(gpuId: string | null): Promise<TranscodingCapabilities> {
    const capabilities = await this.getCapabilities()
    if (gpuId !== null && !capabilities.gpus.some(gpu => gpu.id === gpuId)) {
      throw new Error(`Requested GPU ID "${gpuId}" is not available.`)
    }
    await getDatabase().setSetting('selected_transcoding_gpu_id', gpuId || '')
    this.capabilitiesPromise = Promise.resolve({ ...capabilities, selectedGpuId: gpuId })
    return this.capabilitiesPromise
  }




  /**
   * Build transcoding parameters from explicit settings or measured samples.
   */
  async getTranscodeParameters(filePath: string, options: TranscodeOptions = {}): Promise<TranscodingParams> {
    if ((options.optimizationMode === 'transcode' || options.optimizationMode === 'smart') && !options.encoder && options.qualityProfile && options.targetCodec && options.encoderPolicy) {
      const item = await getDatabase().media.getItemByPath(filePath)
      if (!item?.id || !item.source_id || !item.library_id) throw new Error('Measured optimization requires an authorized library item')
      const signal = new AbortController().signal
      const result = await this.preflightShowTranscode({ mediaItemId: item.id, sourceId: item.source_id, libraryId: item.library_id, options }, {
        signal, parameterPreview: true, beginCommit: () => undefined, waitUntilRunning: async () => signal.throwIfAborted(), update: () => undefined,
      })
      const plan = result.episodes[0]
      if (!plan?.compatible || !plan.params || !['sample_required', 'actionable'].includes(plan.decisionStatus ?? '')) throw new Error(plan?.reason ?? 'No validated optimization parameters are available')
      return plan.params
    }
    const analyzer = getMediaFileAnalyzer()
    const analysis = await this.analysisCache.get(filePath, () => analyzer.analyzeFile(filePath))
    if (!analysis.success) throw new Error(`Failed to analyze file: ${analysis.error}`)
    const effectiveOptions: TranscodeOptions = { ...options }

    if (effectiveOptions.optimizationMode === 'smart') {
      let itemForAdvice: Partial<MediaItem> | null = null
      const db = getDatabase()
      if (db.isInitialized) {
        itemForAdvice = await db.media.getItemByPath(filePath)
      }
      const itemToAnalyze: Partial<MediaItem> = itemForAdvice || {
        file_path: filePath,
        file_size_bytes: analysis.fileSizeBytes,
        duration_ms: analysis.durationMs,
        video_codec: analysis.video?.codec,
        video_bitrate_kbps: analysis.video?.bitrateKbps,
        resolution: analysis.video ? `${analysis.video.width}x${analysis.video.height}` : undefined,
        height: analysis.video?.height
      }
      await getQualityAnalyzer().loadThresholdsFromDatabase()
      const advice = await getQualityAnalyzer().getOptimizationAdvice(itemToAnalyze as MediaItem, analysis)
      if (advice.action === 'stream_pruning') {
        effectiveOptions.optimizationMode = 'remux_only'
        if (!effectiveOptions.streamSelection) {
          const originalLanguage = itemToAnalyze.original_language
          if (!originalLanguage) throw new Error('Smart stream pruning requires verified original-language metadata')
          effectiveOptions.streamSelection = { audio: 'original-and-protected', originalLanguage, subtitle: 'all' }
        }
      }
    }

    if (effectiveOptions.optimizationMode === 'remux_only' || effectiveOptions.encoder === 'remux' || effectiveOptions.encoder === 'copy') {
      const plan = buildStreamSelectionPlan(analysis, effectiveOptions)
      effectiveOptions.audioConversions ??= buildAudioConversions(analysis, effectiveOptions)
      const ffmpegArgs = TranscodeCommandFactory.buildCommandTemplate(undefined, effectiveOptions, analysis, resolveOutputExtension(filePath, effectiveOptions))
      return {
        summary: effectiveOptions.audioConversions?.length
          ? `Lossless video remux with ${effectiveOptions.audioConversions.length} audio stream conversion${effectiveOptions.audioConversions.length === 1 ? '' : 's'}`
          : 'Lossless container stream remuxing (copy video)',
        ffmpegArgs,
        expectedSizeReduction: effectiveOptions.audioConversions?.length ? 'Estimated from measured audio bitrates' : 'Stream pruning only',
        warnings: [],
        encoder: 'copy',
        sourceHdrFormat: analysis.video?.hdrFormat,
        expectedAudioCount: plan.audioStreamIndexes.length,
        expectedSubtitleCount: plan.subtitleStreamIndexes.length,
        audioTracks: analysis.audioTracks,
        subtitleTracks: analysis.subtitleTracks
      }
    }

    validateHdrTranscode(analysis, effectiveOptions)
    const targetCodec = effectiveOptions.targetCodec
    if (!targetCodec) throw new Error('Target video codec must be explicitly selected.')
    if (!effectiveOptions.qualityProfile) throw new Error('Quality profile must be explicitly selected.')
    if (!effectiveOptions.encoderPolicy) throw new Error('Encoder policy must be explicitly selected.')
    if (effectiveOptions.encoderPolicy === 'compare' && !effectiveOptions.encoder) throw new Error('Compare policy requires measured candidates before a transcode can be submitted.')
    const hasManualOverrides = effectiveOptions.encoder && effectiveOptions.crf !== undefined && effectiveOptions.preset
    const measuredParameters = hasManualOverrides
      ? { encoder: effectiveOptions.encoder!, crf: effectiveOptions.crf!, preset: effectiveOptions.preset! }
      : await this.selectMeasuredParameters(filePath, effectiveOptions)
    if (!hasManualOverrides) Object.assign(effectiveOptions, measuredParameters)

    let selectedVendor: 'NVIDIA' | 'Intel' | 'AMD' | 'Apple' | 'Unknown' = 'Unknown'
    let selectedGpuIdForOptions: string | undefined
    let capabilitiesForOptions: TranscodingCapabilities | undefined
    if (effectiveOptions.useGpu || effectiveOptions.gpuId) {
      const capabilities = await this.getCapabilities()
      capabilitiesForOptions = capabilities
      const selectedGpuId = effectiveOptions.gpuId || capabilities.selectedGpuId
      selectedGpuIdForOptions = selectedGpuId || undefined
      if (!selectedGpuId) {
        throw new Error('GPU acceleration requested, but no GPU is selected. Select a verified GPU or disable GPU acceleration.')
      }
      const matchedGpu = capabilities.gpus.find(gpu => gpu.id === selectedGpuId)
      if (!matchedGpu) {
        throw new Error(`Requested GPU ID "${selectedGpuId}" is not available on the machine.`)
      }
      selectedVendor = matchedGpu.vendor
      if (selectedVendor === 'Unknown') {
        throw new Error(`GPU acceleration is not supported for GPU: "${matchedGpu.name}".`)
      }
    }

    let expectedEncoder = ''
    if (effectiveOptions.useGpu || effectiveOptions.gpuId) {
      expectedEncoder = getHardwareEncoder(selectedVendor, targetCodec) ?? ''
      if (!expectedEncoder) throw new Error(`${selectedVendor} hardware encoding does not support ${targetCodec.toUpperCase()} in this workflow.`)
    } else {
      expectedEncoder = getOptimizationVideoCodec(targetCodec).softwareEncoder
    }
    if (capabilitiesForOptions && !capabilitiesForOptions.deviceEncoders[selectedGpuIdForOptions ?? '']?.includes(expectedEncoder)) {
      throw new Error(`The selected device does not support ${targetCodec.toUpperCase()} encoding.`)
    }

    const summary = 'Explicit measured transcoding parameters'
    const videoCodec = measuredParameters.encoder
    const crf = measuredParameters.crf
    const preset = measuredParameters.preset
    const expectedSizeReduction: string | undefined = undefined
    const warnings: string[] = []

    if (!videoCodec) throw new Error('Video encoder must be explicitly selected.')
    if (crf === undefined) throw new Error('Video quality value must be explicitly selected.')
    if (!preset) throw new Error('Encoder preset must be explicitly selected.')

    const encoderSpec = measuredOptimizationEncoderSpec(videoCodec, targetCodec)
    const qualityDomain = APP_CONFIG.transcoding.sampleQualityDomains[encoderSpec.qualityDomain]
    if (!Number.isInteger(crf) || crf < Math.min(...qualityDomain) || crf > Math.max(...qualityDomain)) throw new Error(`Invalid video quality value: ${String(crf)}`)
    if (!encoderSpec.presets.includes(preset)) throw new Error(`Invalid encoder preset: ${preset}`)
    if (videoCodec !== expectedEncoder) throw new Error(`Selected encoder "${videoCodec}" does not match the verified ${targetCodec} encoder "${expectedEncoder}".`)
    const finalCrf = crf
    const finalPreset = preset
    const usesSelectedHardwareEncoder = Boolean(selectedGpuIdForOptions)

    const resolvedOptions: TranscodeOptions = {
      ...effectiveOptions,
      targetCodec,
      useGpu: usesSelectedHardwareEncoder,
      gpuId: usesSelectedHardwareEncoder ? selectedGpuIdForOptions : undefined,
      gpuDeviceSelector: usesSelectedHardwareEncoder ? capabilitiesForOptions?.gpus.find(gpu => gpu.id === selectedGpuIdForOptions)?.encoderDeviceSelector : undefined,
      encoder: videoCodec,
      crf: finalCrf,
      preset: finalPreset
    }

    const ffmpegArgs = TranscodeCommandFactory.buildCommandTemplate(usesSelectedHardwareEncoder ? selectedVendor : undefined, resolvedOptions, analysis, resolveOutputExtension(filePath, resolvedOptions))

    const plan = buildStreamSelectionPlan(analysis, resolvedOptions)
    const expectedAudioCount = plan.audioStreamIndexes.length
    const expectedSubtitleCount = plan.subtitleStreamIndexes.length

    return {
      summary,
      ffmpegArgs,
      expectedSizeReduction,
      warnings,
      encoder: videoCodec,
      crf: finalCrf,
      preset: finalPreset,
      measuredCandidate: 'measuredCandidate' in measuredParameters ? measuredParameters.measuredCandidate : undefined,
      sourceHdrFormat: analysis.video?.hdrFormat,
      expectedAudioCount,
      expectedSubtitleCount,
      audioTracks: analysis.audioTracks,
      subtitleTracks: analysis.subtitleTracks
    }
  }

  /**
   * Run a transcode job
   */
  async transcode(
    mediaItemId: number,
    options: TranscodeOptions = {},
    onProgress?: (progress: TranscodeProgress) => void,
    beginCommit?: () => void
  ): Promise<boolean> {
    const db = getDatabase()
    const item = await this.assertAuthorizedItem(mediaItemId)

    const availability = await this.checkAvailability()
    const engine = options.transcodingEngine
    if (!engine) {
      throw new Error('Transcoding engine must be explicitly selected.')
    }
    if (engine === 'ffmpeg' && !availability.ffmpeg) {
      throw new Error('FFmpeg is not available on this system.')
    }

    if (await db.getSetting(`transcoding.activation.${mediaItemId}`)) throw new Error('Previous activation must be recovered before starting another transcode')
    if (this.activeJobs.has(mediaItemId)) throw new Error('A transcode is already active for this media item')
    const controller = new AbortController()
    const jobState = { controller, committing: false }
    this.activeJobs.set(mediaItemId, jobState)
    const commit = () => {
      controller.signal.throwIfAborted()
      beginCommit?.()
      jobState.committing = true
    }

    let tempPath: string | undefined
    let activated = false
    let optimizationJobId: number | null = null
    let activation: { inputPath: string; tempPath: string; targetPath: string; quarantinePath: string } | undefined

    try {
      onProgress?.({ percent: 0, status: 'initializing' })

      const inputPath = PathUtils.sanitizeAbsolutePath(item.file_path)
      const sourceStat = await fs.stat(inputPath)
      const sourceSha256 = await sha256File(inputPath)
      const queuePayload = (options as TranscodeOptions & { queuePayload?: QueuedTranscodePayload }).queuePayload
      if (queuePayload) getLoggingService().info('[TVOptimization]', 'Episode execution started', {
        event: 'conversion.started',
        batchId: queuePayload.batchId,
        preflightId: queuePayload.preflightId,
        mediaItemId,
        sampleRepresentativeMediaItemId: queuePayload.sampleRepresentativeMediaItemId,
        sourcePath: inputPath,
        sourceBytes: sourceStat.size,
        encoder: queuePayload.params?.encoder ?? options.encoder ?? 'planned',
      })
      if (queuePayload && (sourceStat.size !== queuePayload.sourceSize || Math.abs(sourceStat.mtimeMs - queuePayload.sourceMtimeMs) > 1000)) {
        throw new Error('Source file changed after show preflight')
      }
      if (queuePayload?.sourceSha256 && sourceSha256 !== queuePayload.sourceSha256) throw new Error('Source file contents changed after show preflight')
      if (queuePayload?.targetProfile && JSON.stringify(await db.playbackTargetProfiles.get(queuePayload.targetProfile.id)) !== JSON.stringify(queuePayload.targetProfile)) throw new Error('Playback profile changed after approval')
      if (queuePayload?.capabilityFingerprint) {
        const currentFingerprint = this.getCapabilitySnapshotFingerprint(await this.getCapabilities())
        if (currentFingerprint !== queuePayload.capabilityFingerprint) throw new Error('Hardware capabilities changed after review; run preflight again')
      }
      if (!queuePayload && (options.optimizationMode === 'transcode' || options.optimizationMode === 'smart')) throw new Error('Optimization execution requires a reviewed library preflight')
      const params = queuePayload?.params ?? await this.getTranscodeParameters(inputPath, options)
      const sourceAnalysis = queuePayload?.sourceAnalysis ?? await getMediaFileAnalyzer().analyzeFile(inputPath)
      const encoderProfile = `${params.encoder}:${params.preset}:${params.crf}`
      const measured = params.measuredCandidate
      const predictedOutputBytes = measured && sourceAnalysis.durationMs && !measured.incompleteMeasurement
        ? projectMeasuredOutputBytes(sourceAnalysis.durationMs / 1000, measured.outputBytes + plannedNonVideoBytesPerSecond(sourceAnalysis, options) * measured.sampledDurationSeconds, measured.sampledDurationSeconds)
        : null
      optimizationJobId = await db.mediaRemuxJobs.create({
        mediaItemId,
        operationKind: 'transcode',
        status: 'planned',
        sourcePath: inputPath,
        sourceSize: sourceStat.size,
        sourceMtimeMs: Math.trunc(sourceStat.mtimeMs),
        sourceSha256,
        decisionSnapshot: JSON.stringify({ options, params }),
        streamSignatures: JSON.stringify({ audio: params.audioTracks, subtitles: params.subtitleTracks }),
        quarantinePath: null,
        error: null,
        predictedOutputBytes,
        actualOutputBytes: null,
        bytesSaved: null,
        sourceDurationMs: item.duration_ms ?? null,
        outputDurationMs: null,
        encoderProfile,
        sourceAnalysis: JSON.stringify({ durationMs: item.duration_ms, fileSizeBytes: sourceStat.size }),
        outputAnalysis: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })
      await db.mediaRemuxJobs.update(optimizationJobId, { status: 'running' })

      const outputExt = resolveOutputExtension(inputPath, options)
      let tempBaseDir = path.dirname(inputPath)
      const configuredTempDir = options.tempDirectory || (await db.getSetting('transcoding_temp_directory'))
      if (configuredTempDir && typeof configuredTempDir === 'string' && configuredTempDir.trim() !== '') {
        const sanitizedTemp = PathUtils.sanitizeAbsolutePath(configuredTempDir.trim())
        if (!existsSync(sanitizedTemp)) throw new Error(`Configured transcoding temporary directory does not exist: ${sanitizedTemp}`)
        const tempDirectoryStat = await fs.stat(sanitizedTemp)
        if (!tempDirectoryStat.isDirectory()) throw new Error(`Configured transcoding temporary path is not a directory: ${sanitizedTemp}`)
        tempBaseDir = sanitizedTemp
      }
      tempPath = PathUtils.sanitizeAbsolutePath(path.join(
        tempBaseDir,
        `.totality_tmp_${Date.now()}_${path.basename(inputPath, path.extname(inputPath))}${outputExt}`
      ))

      const configuredDefaultOutputMode = (await db.getSetting(SETTING_KEYS.transcoding_default_output_mode)) as 'copy' | 'quarantine-replace' | 'replace' | null
      const requestedOutputMode = options.outputMode || configuredDefaultOutputMode
      const effectiveOutputMode = TranscodeCommandFactory.resolveOutputMode(
        requestedOutputMode,
        params.encoder,
        Boolean(options.customArgs?.trim())
      )
      if (effectiveOutputMode === 'quarantine-replace' || effectiveOutputMode === 'replace') {
        const sourceVolume = (await fs.stat(inputPath)).dev
        const tempVolume = (await fs.stat(tempBaseDir)).dev
        if (sourceVolume !== tempVolume) throw new Error('Replacement transcoding requires the temporary directory to be on the same volume as the source file.')
      }
      const maximumOutputBytes = options.maxOutputBytes ?? sourceStat.size
      const available = await fs.statfs(tempBaseDir)
      const availableBytes = Number(available.bavail) * Number(available.bsize)
      const sameVolumeCopy = effectiveOutputMode === 'copy' && (await fs.stat(tempBaseDir)).dev === sourceStat.dev
      const requiredBytes = maximumOutputBytes * (sameVolumeCopy ? 2 : 1)
      if (availableBytes < requiredBytes) throw new Error(`Insufficient free space for the output ceiling and activation: ${requiredBytes} bytes required, ${availableBytes} bytes available.`)
      if (effectiveOutputMode === 'copy' && !sameVolumeCopy) {
        const destination = await fs.statfs(path.dirname(inputPath))
        if (Number(destination.bavail) * Number(destination.bsize) < maximumOutputBytes) throw new Error('Insufficient destination space for the sibling copy')
      }
      options = { ...options, maxOutputBytes: maximumOutputBytes }

      getLoggingService().info('[TranscodingService]', `Starting FFmpeg transcode: ${inputPath} -> ${tempPath}`)
      const success = await this.runFFmpeg(inputPath, tempPath, params, options, (p) => {
          onProgress?.({
            percent: p.percent,
            fps: p.fps,
            speed: p.speed,
            eta: p.eta,
            status: 'encoding'
          })
        }, controller.signal)

      if (!success) {
        if (controller.signal.aborted) {
          onProgress?.({ percent: 0, status: 'cancelled' })
          return false
        }
        throw new Error('FFmpeg encoding failed')
      }

      onProgress?.({ percent: 100, status: 'verifying' })

      // Verify the output file exists and is not empty
      const stats = await fs.stat(tempPath)
      if (stats.size === 0) {
        throw new Error('Transcoded file is empty')
      }
      if (options.maxOutputBytes !== undefined && stats.size > options.maxOutputBytes) {
        throw new Error(`Transcoded output exceeded the configured output ceiling (${stats.size} > ${options.maxOutputBytes} bytes).`)
      }

      const outputAnalysis = await getMediaFileAnalyzer().analyzeCompleteFile(tempPath, { scanBitrate: true, detectVolume: false, signal: controller.signal })
      if (!outputAnalysis.success || !outputAnalysis.video) {
        throw new Error(`Transcoded output verification failed: ${outputAnalysis.error || 'video stream not detected'}`)
      }
      outputAnalysis.sourceFingerprint = { size: stats.size, mtimeMs: stats.mtimeMs, sha256: await sha256File(tempPath) }
      this.verifyPlannedStreams(sourceAnalysis, outputAnalysis, options, params)
      if (!options.targetConversion && params.sourceHdrFormat?.toLowerCase() === 'hdr10' && outputAnalysis.video.hdrFormat?.toLowerCase() !== 'hdr10') {
        throw new Error('Transcoded output verification failed: HDR10 metadata was not preserved')
      }

      const binary = getMediaFileAnalyzer().getFFmpegPath()!
      await new ChildProcessMeasurementRunner().run(binary, ['-v', 'error', '-xerror', '-err_detect', 'explode', '-i', tempPath, '-map', '0:v:0', '-map', '0:a?', '-f', 'null', '-'], controller.signal)
      const sourceVideo = sourceAnalysis.video!, outputVideo = outputAnalysis.video
      if (sourceVideo.durationMs === undefined || outputVideo.durationMs === undefined || sourceVideo.timestampPrecisionMs === undefined || outputVideo.timestampPrecisionMs === undefined) throw new Error('Complete video stream timestamps are required before activation')
      const precisionMs = Math.max(sourceVideo.timestampPrecisionMs, outputVideo.timestampPrecisionMs)
      if (Math.abs(sourceVideo.durationMs - outputVideo.durationMs) > precisionMs) throw new Error('Output video duration does not match the source within stream timestamp precision')
      const streamPlan = buildStreamSelectionPlan(sourceAnalysis, options)
      for (const [index, sourceIndex] of streamPlan.audioStreamIndexes.entries()) {
        const source = sourceAnalysis.audioTracks.find(track => track.index === sourceIndex)!, output = outputAnalysis.audioTracks[index]
        if (source.durationMs === undefined || output.durationMs === undefined) throw new Error(`Audio stream ${sourceIndex} has no complete duration evidence`)
      const converted = (options.targetConversion?.audio.find(track => track.sourceIndex === sourceIndex)?.bitrateKbps ?? options.audioConversions?.find(track => track.sourceIndex === sourceIndex)?.bitrateKbps) !== undefined
        const toleranceMs = converted ? 2 * (output.codec === 'aac' ? 1024 : 1536) * 1000 / output.sampleRate! : Math.max(source.timestampPrecisionMs!, output.timestampPrecisionMs!)
        if (Math.abs(source.durationMs - output.durationMs) > toleranceMs) throw new Error(`Audio stream ${sourceIndex} duration changed beyond its timestamp or coded sample precision`)
      }
      if (queuePayload?.targetProfile && !isCompatibleWithPlaybackPolicy(options.playbackPolicy ?? 'direct-play', evaluatePlaybackTarget(queuePayload.targetProfile, outputAnalysis))) throw new Error('Verified output is incompatible with the approved playback policy')
      controller.signal.throwIfAborted()
      if (await sha256File(inputPath) !== sourceSha256) throw new Error('Source file changed during transcoding')

      let outputQualityVerification: Awaited<ReturnType<MeasuredOptimizationService['verifyOutputQuality']>> | undefined
      if (params.measuredCandidate) {
        if (!options.qualityProfile) throw new Error('Measured optimization has no quality profile')
        if (queuePayload && !queuePayload?.preflightId) throw new Error('Approved measured optimization has no saved review identity')
        if (stats.size >= sourceStat.size) throw new Error(`Verified output has no positive size saving (${stats.size} >= ${sourceStat.size} bytes)`)
        const verificationDirectory = path.join(app.getPath('userData'), 'transcoding-samples', queuePayload?.preflightId ?? randomUUID(), 'output-verification', String(mediaItemId))
        getLoggingService().info('[TVOptimization]', 'Actual output quality verification started', {
          event: 'output-verification.started',
          batchId: queuePayload?.batchId,
          preflightId: queuePayload?.preflightId,
          mediaItemId,
          sampleRepresentativeMediaItemId: queuePayload?.sampleRepresentativeMediaItemId,
          sourceBytes: sourceStat.size,
          outputBytes: stats.size,
          qualityProfile: options.qualityProfile,
        })
        const outputVerificationStartedAt = performance.now()
        outputQualityVerification = await this.measuredOptimizationService.verifyOutputQuality({
          sourcePath: inputPath,
          outputPath: tempPath,
          outputDirectory: verificationDirectory,
          durationMs: sourceVideo.durationMs,
          qualityProfile: options.qualityProfile,
          referenceFilter: options.targetConversion?.videoFilter,
          referenceInputArgs: options.targetConversion?.inputArgs,
          signal: controller.signal,
          onProgress: phase => {
            getLoggingService().info('[TVOptimization]', 'Actual output verification progress', {
              event: 'output-verification.progress',
              batchId: queuePayload?.batchId,
              preflightId: queuePayload?.preflightId,
              mediaItemId,
              sampleRepresentativeMediaItemId: queuePayload?.sampleRepresentativeMediaItemId,
              phase,
            })
            onProgress?.({ percent: 100, status: 'verifying', phase })
          },
        })
        getLoggingService().info('[TVOptimization]', 'Actual output quality verification completed', {
          event: 'output-verification.completed',
          batchId: queuePayload?.batchId,
          preflightId: queuePayload?.preflightId,
          mediaItemId,
          sampleRepresentativeMediaItemId: queuePayload?.sampleRepresentativeMediaItemId,
          durationMs: Math.round(performance.now() - outputVerificationStartedAt),
          outputBytes: stats.size,
          verifiedSavingsBytes: sourceStat.size - stats.size,
          ...outputQualityVerification,
        })
      }

      // Guard against size inflation for replacement modes: if transcoded result is larger than source, abort replacement
      if ((effectiveOutputMode === 'quarantine-replace' || effectiveOutputMode === 'replace') && stats.size > sourceStat.size) {
        throw new Error(`Transcoded output (${Math.round(stats.size / (1024 * 1024))} MB) is larger than original source (${Math.round(sourceStat.size / (1024 * 1024))} MB). Aborting replacement to protect storage.`)
      }
      await db.mediaRemuxJobs.update(optimizationJobId!, { status: 'verified', actualOutputBytes: stats.size, outputDurationMs: outputAnalysis.durationMs, outputAnalysis: JSON.stringify({ ...outputAnalysis, qualityVerification: outputQualityVerification }) })

      const origExt = path.extname(inputPath)
      const origBase = path.basename(inputPath, origExt)
      const targetSamePath = path.join(path.dirname(inputPath), origBase + outputExt)

      if (effectiveOutputMode === 'replace' || effectiveOutputMode === 'quarantine-replace') {
        controller.signal.throwIfAborted()
        if (path.resolve(inputPath) !== path.resolve(targetSamePath) && existsSync(targetSamePath)) throw new Error('Activation destination already exists')
        await this.verifyActivationOutput(tempPath, outputAnalysis)
        if (await sha256File(inputPath) !== sourceSha256) throw new Error('Source file changed before activation')
        commit()
        const quarantinePath = path.join(path.dirname(inputPath), `${origBase}.${effectiveOutputMode === 'replace' ? 'activation' : 'quarantine'}-${Date.now()}-${randomUUID()}${origExt}`)
        const outputStats = { ...outputAnalysis, filePath: targetSamePath }
        activation = { inputPath, tempPath, targetPath: targetSamePath, quarantinePath }
        const journal = { inputPath, tempPath, targetPath: targetSamePath, quarantinePath, outputStats, mode: effectiveOutputMode }
        await this.writeActivationJournal(mediaItemId, { ...journal, phase: 'prepared' })
        await db.mediaRemuxJobs.update(optimizationJobId!, { quarantinePath })
        await fs.rename(inputPath, quarantinePath)
        await this.writeActivationJournal(mediaItemId, { ...journal, phase: 'source_quarantined' })
        if (await sha256File(quarantinePath) !== sourceSha256) throw new Error('Quarantined source differs from its recorded fingerprint')
        await this.publishActivationOutput(tempPath, targetSamePath)
        await this.writeActivationJournal(mediaItemId, { ...journal, phase: 'output_activated' })
        await db.media.updatePathAndStats(mediaItemId, targetSamePath, outputStats)
        activated = true
        this.analysisCache.delete(inputPath)
        this.analysisCache.delete(targetSamePath)
        getStatsCacheService().invalidate()
      } else {
        commit()
        // Sibling copy
        const copyPath = path.join(path.dirname(inputPath), `${origBase} - Transcoded${outputExt}`)
        getLoggingService().info('[TranscodingService]', `Saving transcoded sibling copy: ${copyPath}`)
        if (path.resolve(tempPath) !== path.resolve(copyPath)) {
          await fs.copyFile(tempPath, copyPath, (await import('node:fs')).constants.COPYFILE_EXCL)
          await fs.unlink(tempPath)
        }
      }

      if (optimizationJobId !== null) {
        const retainedOriginalBytes = effectiveOutputMode === 'replace' ? 0 : sourceStat.size
        await db.mediaRemuxJobs.update(optimizationJobId, {
          status: 'promoted',
          actualOutputBytes: stats.size,
          bytesSaved: sourceStat.size - stats.size,
          outputDurationMs: outputAnalysis.durationMs,
          outputAnalysis: JSON.stringify({ ...outputAnalysis, filePath: effectiveOutputMode === 'copy' ? path.join(path.dirname(inputPath), `${origBase} - Transcoded${outputExt}`) : targetSamePath, encodedReductionBytes: sourceStat.size - stats.size, retainedOriginalBytes, physicallyReclaimedBytes: effectiveOutputMode === 'replace' ? sourceStat.size - stats.size : 0, qualityVerification: outputQualityVerification }),
        })
      }

      if (activation && activated) {
        if (effectiveOutputMode === 'replace') {
          await this.verifyActivationOutput(activation.targetPath, outputAnalysis)
          if (await sha256File(activation.quarantinePath) !== sourceSha256) throw new Error('Quarantined source changed before removal')
          await fs.unlink(activation.quarantinePath)
        }
        await db.deleteSetting(`transcoding.activation.${mediaItemId}`)
      }

      onProgress?.({ percent: 100, status: 'complete' })
      if (queuePayload) getLoggingService().info('[TVOptimization]', 'Episode execution completed', {
        event: 'conversion.completed',
        batchId: queuePayload.batchId,
        preflightId: queuePayload.preflightId,
        mediaItemId,
        sampleRepresentativeMediaItemId: queuePayload.sampleRepresentativeMediaItemId,
        sourceBytes: sourceStat.size,
        outputBytes: stats.size,
        encodedReductionBytes: sourceStat.size - stats.size,
      })
      return true

    } catch (error) {
      if (activation && !activated) {
        try {
          if (existsSync(activation.quarantinePath)) {
            // Once output publication may have occurred, preserve the journal for
            // fingerprint-verified forward recovery rather than moving an unknown target.
            if (!existsSync(activation.tempPath)) throw new Error('Published output requires activation recovery')
            if (existsSync(activation.targetPath)) {
              const [temp, target] = await Promise.all([fs.stat(activation.tempPath), fs.lstat(activation.targetPath)])
              if (temp.dev === target.dev && temp.ino === target.ino) throw new Error('Published output requires activation recovery')
            }
            await this.publishActivationOutput(activation.quarantinePath, activation.inputPath)
          }
          if (optimizationJobId !== null) await db.mediaRemuxJobs.update(optimizationJobId, { status: 'failed', quarantinePath: null, error: getErrorMessage(error) })
          await db.deleteSetting(`transcoding.activation.${mediaItemId}`)
        } catch (rollbackError) {
          throw new Error(`Activation failed (${getErrorMessage(error)}) and could not restore the original (${getErrorMessage(rollbackError)}); the recorded journal requires recovery`)
        }
      }
      const msg = error instanceof TranscodeError && error.stderr
        ? `${error.message}: ${error.stderr.slice(-4000).trim()}`
        : error instanceof Error ? error.message : String(error)
      getLoggingService().error('[TranscodingService]', `Transcode failed for item ${mediaItemId}:`, msg)
      const failedQueuePayload = (options as TranscodeOptions & { queuePayload?: QueuedTranscodePayload }).queuePayload
      if (failedQueuePayload) getLoggingService().error('[TVOptimization]', 'Episode execution failed', {
        event: 'conversion.failed',
        batchId: failedQueuePayload.batchId,
        preflightId: failedQueuePayload.preflightId,
        mediaItemId,
        sampleRepresentativeMediaItemId: failedQueuePayload.sampleRepresentativeMediaItemId,
        reason: msg,
      })
      if (optimizationJobId !== null && !activated) await db.mediaRemuxJobs.update(optimizationJobId, { status: 'failed', error: msg })

      onProgress?.({ percent: 0, status: 'failed', error: msg })
      if (controller.signal.aborted) return false
      throw error
    } finally {
      this.activeJobs.delete(mediaItemId)
      if (tempPath && !activated && !await db.getSetting(`transcoding.activation.${mediaItemId}`)) await fs.rm(tempPath, { force: true })
    }
  }

  private verifyPlannedVideo(outputAnalysis: FileAnalysisResult, options: TranscodeOptions): void {
    if (!outputAnalysis.success || !outputAnalysis.video) throw new Error(outputAnalysis.error || 'Verified output has no video stream')
    const conversion = options.targetConversion
    if (conversion) validateTargetTranscodeBitrate(conversion, outputAnalysis)
    if (conversion && (outputAnalysis.video.codec !== options.targetCodec || outputAnalysis.video.width !== conversion.width || outputAnalysis.video.height !== conversion.height || outputAnalysis.video.bitDepth !== conversion.bitDepth || outputAnalysis.video.hdrFormat !== conversion.hdrFormat)) throw new Error('Verified output does not match the approved video conversion')
    if (!conversion && options.optimizationMode === 'transcode' && options.targetCodec && normalizeVideoCodec(outputAnalysis.video.codec) !== normalizeVideoCodec(options.targetCodec)) throw new Error('Verified output codec does not match the approved video codec')
  }

  /** Samples contain video only; combine observed video with the explicit retained-stream plan. */
  private withPlannedSampleStreams(source: FileAnalysisResult, sample: FileAnalysisResult, options: TranscodeOptions): FileAnalysisResult {
    const streams = buildStreamSelectionPlan(source, options)
    const conversions = options.targetConversion?.audio ?? options.audioConversions ?? []
    if (sample.overallBitrateKbps === undefined) throw new Error('Measured sample bitrate is required')
    return {
      ...sample,
      overallBitrateKbps: sample.overallBitrateKbps + plannedNonVideoBytesPerSecond(source, options) * 8 / 1000,
      audioTracks: source.audioTracks.filter(track => streams.audioStreamIndexes.includes(track.index)).map(track => {
        const conversion = conversions.find(candidate => candidate.sourceIndex === track.index)
        return conversion ? { ...track, codec: conversion.codec, bitrateKbps: conversion.bitrateKbps ?? track.bitrateKbps } : track
      }),
      subtitleTracks: source.subtitleTracks.filter(track => streams.subtitleStreamIndexes.includes(track.index)),
    }
  }

  private verifyPlannedStreams(sourceAnalysis: FileAnalysisResult, outputAnalysis: FileAnalysisResult, options: TranscodeOptions, params: TranscodingParams): void {
    if (!outputAnalysis.success || !outputAnalysis.video) throw new Error(outputAnalysis.error || 'Verified output has no video stream')
    const expectedAudioCount = params.expectedAudioCount !== undefined ? params.expectedAudioCount : params.audioTracks?.length
    const expectedSubtitleCount = params.expectedSubtitleCount !== undefined ? params.expectedSubtitleCount : params.subtitleTracks?.length
    if (expectedAudioCount !== undefined && outputAnalysis.audioTracks.length !== expectedAudioCount) {
      throw new Error(`Transcoded output verification failed: expected ${expectedAudioCount} audio streams, found ${outputAnalysis.audioTracks.length}`)
    }
    if (expectedSubtitleCount !== undefined && outputAnalysis.subtitleTracks.length !== expectedSubtitleCount) {
      throw new Error(`Transcoded output verification failed: expected ${expectedSubtitleCount} subtitle streams, found ${outputAnalysis.subtitleTracks.length}`)
    }
    this.verifyPlannedVideo(outputAnalysis, options)
    const streamPlan = buildStreamSelectionPlan(sourceAnalysis, options)
    for (const [index, sourceIndex] of streamPlan.audioStreamIndexes.entries()) {
      const source = sourceAnalysis.audioTracks.find(track => track.index === sourceIndex)!
      const output = outputAnalysis.audioTracks[index]
      const conversion = options.targetConversion?.audio.find(track => track.sourceIndex === sourceIndex) ?? options.audioConversions?.find(track => track.sourceIndex === sourceIndex)
      if (output.codec !== (conversion?.codec ?? source.codec) || output.channels !== source.channels || output.language !== source.language || output.title !== source.title || output.hasObjectAudio !== source.hasObjectAudio) throw new Error(`Retained audio stream ${sourceIndex} changed unexpectedly`)
    }
    for (const [index, sourceIndex] of streamPlan.subtitleStreamIndexes.entries()) {
      const source = sourceAnalysis.subtitleTracks.find(track => track.index === sourceIndex)!, output = outputAnalysis.subtitleTracks[index]
      if (output.codec !== source.codec || output.language !== source.language || output.title !== source.title || output.isForced !== source.isForced) throw new Error(`Retained subtitle stream ${sourceIndex} changed unexpectedly`)
    }
  }

  async selectMeasuredParameters(
    filePath: string,
    options: TranscodeOptions,
    sampleDirectory?: string,
    signal?: AbortSignal,
    onProgress?: (phase: string) => Promise<void> | void,
    onMeasuredCandidates?: (candidates: MeasuredCandidate[], complete: boolean, calibrationScopeKey?: string, maximumRate?: number, rateLimit?: number) => Promise<void>,
    previouslyMeasured: MeasuredCandidate[] = [],
    measurementComplete = false,
    previouslyMeasuredSamples: MeasuredCandidateSample[] = [],
    onMeasuredSample?: (sample: MeasuredCandidateSample) => Promise<void>,
    sourcePreparation: MeasurementSourcePreparation = { samples: [] },
    onSourcePrepared?: (preparation: MeasurementSourcePreparation) => Promise<void>,
    searchContext?: { preflightId: string; batchId: string; mediaItemId: number; groupKey?: string; sourceId?: string; libraryId?: string; mediaType?: MediaItem['type']; activeCalibration?: OptimizationCalibrationEntry[]; calibration?: boolean },
    sourceSha256?: string,
  ): Promise<Pick<TranscodingParams, 'encoder' | 'crf' | 'preset' | 'measuredCandidate'> & Pick<TranscodeOptions, 'gpuId' | 'useGpu'>> {
    if (!options.targetCodec) throw new Error('Measurement requires a target codec')
    if (!options.qualityProfile) throw new Error('Measurement requires a quality profile')
    if (!options.encoderPolicy) throw new Error('Measurement requires an encoder policy')
    signal?.throwIfAborted()
    const analysis = await this.analysisCache.get(filePath, () => getMediaFileAnalyzer().analyzeFile(filePath))
    if (!analysis.success || !analysis.video || !analysis.durationMs) throw new Error(analysis.error || 'Complete media analysis is required for measurement')
    if (!analysis.video.frameRate) throw new Error('A source frame rate is required for measured quality analysis')
    const activeCalibration = searchContext?.activeCalibration ?? await this.loadOptimizationCalibration()
    const media = !searchContext && activeCalibration.length ? await getDatabase().media.getItemByPath(filePath) : undefined
    const sourceId = searchContext?.sourceId ?? media?.source_id
    const libraryId = searchContext?.libraryId ?? media?.library_id
    const mediaType = searchContext?.mediaType ?? media?.type
    const capabilities = await this.getCapabilities()
    const devices = verifiedOptimizationDevices(options.targetCodec, capabilities)
    const software = devices.find(device => device.gpuId === undefined)
    const hardware = devices.filter((device): device is { encoder: string; gpuId: string } => device.gpuId !== undefined)
    const selectedHardware = hardware.find(device => device.gpuId === (options.gpuId || capabilities.selectedGpuId))
    if (options.encoderPolicy === 'hardware' || options.encoderPolicy === 'compare') {
      if (!selectedHardware) throw new Error(`Select verified hardware supporting ${options.targetCodec.toUpperCase()} for measurement`)
    }
    if ((options.encoderPolicy === 'software' || options.encoderPolicy === 'compare') && !software) throw new Error(`Verified software encoding for ${options.targetCodec.toUpperCase()} is unavailable`)
    const ladder = searchContext?.calibration
      ? devices.flatMap(device => buildCandidateLadder(options.targetCodec!, device.gpuId === undefined ? 'software' : 'hardware', device.encoder).map(candidate => ({ ...candidate, gpuId: device.gpuId })))
      : options.encoderPolicy === 'automatic'
        ? hardware.length
          ? buildCandidateLadder(options.targetCodec, 'automatic', undefined, hardware)
          : software ? buildCandidateLadder(options.targetCodec, 'automatic', software.encoder) : []
        : buildCandidateLadder(options.targetCodec, options.encoderPolicy, selectedHardware?.encoder)
          .map(candidate => ({ ...candidate, gpuId: isMeasuredSoftwareEncoder(candidate.encoder) ? undefined : selectedHardware?.gpuId }))
    if (!ladder.length) throw new Error('No verified optimization candidates are available')
    const measuredCandidates = [...previouslyMeasured]
    let measuredSamples = [...previouslyMeasuredSamples]
    let candidateSearchRounds = 0
    const maxCandidatesPerPreset = searchContext?.calibration ? Math.max(...Object.values(APP_CONFIG.transcoding.sampleQualityDomains).map(domain => domain.length)) : options.measurementCandidateBudget ?? MAX_MEASURED_CANDIDATES_PER_PRESET
    if (!Number.isInteger(maxCandidatesPerPreset) || maxCandidatesPerPreset <= 0) throw new Error('Measured candidate budget must be a positive integer')
    const familyKeys = new Set(ladder.map(candidateFamilyKey))
    const maximumCandidates = searchContext?.calibration ? ladder.length : familyKeys.size * maxCandidatesPerPreset
    const budgetReached = () => !searchContext?.calibration && [...familyKeys].some(key =>
      measuredCandidates.filter(candidate => candidateFamilyKey(candidate) === key).length >= maxCandidatesPerPreset)
    const candidateDomain = [...new Map(ladder.map(candidate => [candidateDeviceKey(candidate), candidate])).values()].map(device => {
      const candidates = ladder.filter(candidate => candidateDeviceKey(candidate) === candidateDeviceKey(device))
      return {
        encoder: device.encoder,
        gpuId: device.gpuId,
        presets: [...new Set(candidates.map(candidate => candidate.preset))],
        qualities: [...new Set(candidates.map(candidate => candidate.quality))].sort((left, right) => left - right),
        candidateCount: candidates.length,
      }
    })
    getLoggingService().info('[TVOptimization]', 'Measured candidate search started', {
      event: 'candidate-search.started',
      qualityProfile: options.qualityProfile,
      encoderPolicy: options.encoderPolicy,
      targetCodec: options.targetCodec,
      sourcePath: filePath,
      preflightId: searchContext?.preflightId,
      batchId: searchContext?.batchId,
      mediaItemId: searchContext?.mediaItemId,
      groupKey: searchContext?.groupKey,
      candidateDomain,
      previouslyMeasuredCount: measuredCandidates.length,
    })
    const isMeasured = (candidate: CandidateEncodingParameters) => measuredCandidates.some(measured => candidateEncodingKey(measured) === candidateEncodingKey(candidate))
    const buildCandidates = (parameters: CandidateEncodingParameters[]) => parameters.filter(candidate => !isMeasured(candidate)).map(candidate => {
      const useGpu = !isMeasuredSoftwareEncoder(candidate.encoder)
      const candidateGpu = candidate.gpuId ? capabilities?.gpus.find(gpu => gpu.id === candidate.gpuId) : undefined
      if (useGpu && !candidateGpu) throw new Error(`Measured candidate ${candidate.encoder} has no verified GPU assignment.`)
      const candidateOptions = {
        ...options,
        useGpu,
        gpuId: useGpu ? candidateGpu?.id : undefined,
        gpuDeviceSelector: useGpu ? candidateGpu?.encoderDeviceSelector : undefined,
        encoder: candidate.encoder,
        crf: candidate.quality,
        preset: candidate.preset
      }
      return { ...candidate, outputBytes: 0, sampledDurationSeconds: 0, encodingDurationMs: 0, vmafMean: 0, vmafP5: 0, cambiMean: 0, ffmpegArgs: TranscodeCommandFactory.buildCommandTemplate(candidateGpu?.vendor, candidateOptions, analysis, resolveOutputExtension(filePath, candidateOptions)) }
    })
    const outputDirectory = sampleDirectory ?? path.join(app.getPath('userData'), 'transcoding-samples', randomUUID())
    try {
      const stat = await fs.stat(filePath)
      await fs.mkdir(outputDirectory, { recursive: true })
      const sampleDurationSeconds = options.measurementSampleDurationSeconds ?? APP_CONFIG.transcoding.sampleDurationSeconds
      const samplePositions = options.measurementSamplePositions ?? APP_CONFIG.transcoding.samplePositions
      const sampleSeconds = Math.min(analysis.durationMs / 1000, sampleDurationSeconds * samplePositions.length)
      const maximumOutputBytesPerSecond = Math.min(options.maxOutputBytes ?? stat.size, stat.size) / (analysis.durationMs / 1000) - plannedNonVideoBytesPerSecond(analysis, options)
      const plannedBitrate = options.targetConversion?.maximumVideoBitrate
      const outputExtension = resolveOutputExtension(filePath, options)
      const targetProfile = options.targetProfileId ? await getDatabase().playbackTargetProfiles.get(options.targetProfileId) : undefined
      const calibrationScopeKey = sourceId && libraryId && mediaType ? JSON.stringify({
        sourceId,
        libraryId,
        mediaType,
        sourceCodec: normalizeVideoCodec(analysis.video.codec),
        hdrFormat: analysis.video.hdrFormat ?? 'SDR',
        bitDepth: analysis.video.bitDepth,
        dolbyVisionProfile: analysis.video.dolbyVisionProfile,
        targetCodec: options.targetCodec,
        playbackPolicy: options.playbackPolicy ?? 'allow-transcoding',
        targetProfileMode: options.targetProfileMode,
        targetProfile,
        capabilityFingerprint: capabilities ? this.getCapabilitySnapshotFingerprint(capabilities) : 'software',
        sourceWidth: analysis.video.width,
        sourceHeight: analysis.video.height,
        sourceFrameRate: analysis.video.frameRate,
        sourceColorSpace: analysis.video.colorSpace,
        sourceColorTransfer: analysis.video.colorTransfer,
        sourceColorPrimaries: analysis.video.colorPrimaries,
        sourcePixelFormat: analysis.video.pixelFormat,
        measurementVersion: MEASUREMENT_VERSION,
        searchVersion: OPTIMIZATION_SEARCH_VERSION,
        measurementFingerprint: await this.measuredOptimizationService.getMeasurementFingerprint(),
        sampleDurationSeconds,
        samplePositions,
        qualityGates: APP_CONFIG.transcoding.qualityGates,
        sampleQualityDomains: APP_CONFIG.transcoding.sampleQualityDomains,
        outputExtension,
        targetHdrFormat: options.targetHdrFormat,
        customArgs: options.customArgs,
        videoFilter: options.targetConversion?.videoFilter,
        inputArgs: options.targetConversion?.inputArgs,
        rateControl: options.targetConversion?.maximumVideoBitrate === undefined ? 'unbounded' : 'bounded',
        targetWidth: options.targetConversion?.width,
        targetHeight: options.targetConversion?.height,
        targetBitDepth: options.targetConversion?.bitDepth,
        targetVideoProfile: options.targetConversion?.profile,
        targetVideoLevel: options.targetConversion?.level,
        targetConversionHdr: options.targetConversion?.hdrFormat,
      }) : undefined
      const calibration = scopedCalibrationEntries(activeCalibration, calibrationScopeKey, plannedBitrate)
      const nextCandidates = () => searchContext?.calibration
        ? ladder.filter(candidate => !isMeasured(candidate)).slice(0, 1)
        : nextCandidateSearch(ladder, measuredCandidates, options.qualityProfile!, maxCandidatesPerPreset, calibration)
      const validateSample = async (samplePath: string): Promise<string[]> => {
        const sample = await getMediaFileAnalyzer().analyzeCompleteFile(samplePath, { scanBitrate: true, detectVolume: false, signal })
        if (!sample.success) throw new Error(sample.error || 'Sample playback analysis failed')
        const blockers: string[] = []
        try { this.verifyPlannedVideo(sample, options) } catch (error) { blockers.push(getErrorMessage(error)) }
        if (targetProfile && options.playbackPolicy !== 'allow-transcoding' && options.targetProfileMode !== 'advisory') {
          const evaluation = evaluatePlaybackTarget(targetProfile, this.withPlannedSampleStreams(analysis, sample, options))
          const findings = options.playbackPolicy === 'direct-play' ? Object.values(evaluation.findings) : [evaluation.findings.container, evaluation.findings.video, evaluation.findings.hdr, evaluation.findings.network, evaluation.findings.subtitle]
          for (const finding of findings) {
            if (finding.status === 'incompatible') blockers.push(`${finding.rule}: ${finding.evidence}`)
          }
        }
        return blockers
      }
      for (const candidate of previouslyMeasured) {
        if (candidate.qualityRejectedReason || candidate.incompleteMeasurement) continue
        const blockers = new Set<string>()
        for (const samplePath of candidate.samplePaths ?? []) for (const blocker of await validateSample(samplePath)) blockers.add(blocker)
        candidate.playbackBlockers = [...blockers]
      }
      while (!measurementComplete) {
        const candidates = buildCandidates(nextCandidates())
        if (candidates.length) {
          candidateSearchRounds += 1
          const roundStartedAt = performance.now()
          await onProgress?.(`Measuring candidate ${measuredCandidates.length + 1} of at most ${maximumCandidates}: ${candidates[0].encoder}/${candidates[0].preset} q${candidates[0].quality}`)
          const roundCandidates = candidates.map(({ encoder, gpuId, preset, quality }) => ({ encoder, gpuId, preset, quality }))
          const estimatedCandidateSampleBytes = Math.ceil((plannedBitrate
            ? plannedBitrate / 8 * sampleSeconds
            : (options.maxOutputBytes ?? stat.size) * sampleSeconds / (analysis.durationMs / 1000)) * candidates.length)
          const rateControlBufferBytes = (options.targetConversion?.maximumVideoBitrate ?? 0) / 4
          const estimatedRequiredBytes = Math.ceil(estimatedCandidateSampleBytes + rateControlBufferBytes)
          const space = await fs.statfs(outputDirectory)
          const availableBytes = Number(space.bavail) * Number(space.bsize)
          if (availableBytes < estimatedRequiredBytes) throw new Error(`Estimated disk headroom is insufficient for episode sampling: volume=${path.parse(outputDirectory).root}, availableBytes=${availableBytes}, estimatedRequiredBytes=${estimatedRequiredBytes}, estimatedCandidateSampleBytes=${estimatedCandidateSampleBytes}, estimatedRateControlBufferBytes=${Math.ceil(rateControlBufferBytes)}, candidateCount=${candidates.length}, sampleDurationSeconds=${sampleSeconds}`)
          const roundStart = measuredCandidates.length
          const measured = await this.measuredOptimizationService.measure({
            inputPath: filePath,
            sourceSha256,
            outputDirectory,
            durationMs: analysis.durationMs,
            outputExtension,
            referenceFilter: options.targetConversion?.videoFilter,
            referenceInputArgs: options.targetConversion?.inputArgs,
            sourcePreparation,
            onSourcePrepared: async preparation => onSourcePrepared?.(preparation),
            qualityProfile: searchContext?.calibration ? 'maximum_savings' : options.qualityProfile,
            retainSamples: !searchContext?.calibration,
            candidates,
            signal,
            onProgress,
            validateSample,
            previouslyMeasuredSamples: measuredSamples,
            onSampleMeasured: searchContext?.calibration ? undefined : async sample => {
              measuredSamples = [...measuredSamples.filter(existing => candidateEncodingKey(existing) !== candidateEncodingKey(sample) || existing.sampleIndex !== sample.sampleIndex), sample]
              await onMeasuredSample?.(sample)
            },
            onCandidateMeasured: async roundCandidates => onMeasuredCandidates?.([...measuredCandidates.slice(0, roundStart), ...roundCandidates], false, calibrationScopeKey, maximumOutputBytesPerSecond, plannedBitrate),
            sampleDurationSeconds,
            samplePositions,
          })
          measuredCandidates.push(...measured.candidates)
          signal?.throwIfAborted()
          for (const candidate of measured.candidates) getLoggingService().info('[TVOptimization]', 'Measured candidate gate evidence', {
            event: 'candidate-search.candidate-measured',
            preflightId: searchContext?.preflightId,
            batchId: searchContext?.batchId,
            mediaItemId: searchContext?.mediaItemId,
            groupKey: searchContext?.groupKey,
            sourcePath: filePath,
            qualityProfile: options.qualityProfile,
            encoder: candidate.encoder,
            gpuId: candidate.gpuId,
            preset: candidate.preset,
            quality: candidate.quality,
            outputBytes: candidate.outputBytes,
            sampledDurationSeconds: candidate.sampledDurationSeconds,
            encodingDurationMs: candidate.encodingDurationMs,
            vmafMean: candidate.vmafMean,
            vmafP5: candidate.vmafP5,
            cambiMean: candidate.cambiMean,
            qualityRejectedReason: candidate.qualityRejectedReason,
            playbackBlockers: candidate.playbackBlockers,
            incompleteMeasurement: candidate.incompleteMeasurement,
          })
          getLoggingService().info('[TVOptimization]', 'Measured candidate search round completed', {
            event: 'candidate-search.round-completed',
            round: candidateSearchRounds,
            selectedCandidates: roundCandidates,
            outcome: 'measured',
            durationMs: Math.round(performance.now() - roundStartedAt),
            sourcePath: filePath,
            preflightId: searchContext?.preflightId,
            batchId: searchContext?.batchId,
            mediaItemId: searchContext?.mediaItemId,
            groupKey: searchContext?.groupKey,
            measuredCandidateCount: measuredCandidates.length,
          })
        }
        if (measurementComplete) break
        if (!nextCandidates().length) {
          measurementComplete = true
          for (const candidate of measuredCandidates) {
            candidate.searchSummary = { measuredCount: measuredCandidates.length, maximumCandidates, budgetReached: budgetReached() }
          }
          await onMeasuredCandidates?.(measuredCandidates, true, calibrationScopeKey, maximumOutputBytesPerSecond, plannedBitrate)
          break
        }
      }
      signal?.throwIfAborted()
      if (measurementComplete && previouslyMeasured.length === measuredCandidates.length) await onMeasuredCandidates?.(measuredCandidates, true, calibrationScopeKey, maximumOutputBytesPerSecond, plannedBitrate)
      const selected = selectMeasuredCandidate(options.qualityProfile, measuredCandidates, maximumOutputBytesPerSecond)
      const reachedBudget = budgetReached()
      selected.searchSummary = { measuredCount: measuredCandidates.length, maximumCandidates, budgetReached: reachedBudget }
      await onProgress?.(reachedBudget
        ? `Search budget reached: recommending the best of ${measuredCandidates.length} measured candidates`
        : `Quality search completed: compared ${measuredCandidates.length} candidates`)
      getLoggingService().info('[TVOptimization]', 'Measured candidate search completed', {
        event: 'candidate-search.completed',
        qualityProfile: options.qualityProfile,
        encoderPolicy: options.encoderPolicy,
        targetCodec: options.targetCodec,
        sourcePath: filePath,
        preflightId: searchContext?.preflightId,
        batchId: searchContext?.batchId,
        mediaItemId: searchContext?.mediaItemId,
        groupKey: searchContext?.groupKey,
        rounds: candidateSearchRounds,
        measuredCandidateCount: measuredCandidates.length,
        budgetReached: reachedBudget,
        maximumCandidates,
        selectedCandidate: { encoder: selected.encoder, gpuId: selected.gpuId, preset: selected.preset, quality: selected.quality, outputBytes: selected.outputBytes, encodingDurationMs: selected.encodingDurationMs, vmafMean: selected.vmafMean, vmafP5: selected.vmafP5, cambiMean: selected.cambiMean },
        candidates: measuredCandidates.map(candidate => ({ encoder: candidate.encoder, gpuId: candidate.gpuId, preset: candidate.preset, quality: candidate.quality, outputBytes: candidate.outputBytes, encodingDurationMs: candidate.encodingDurationMs, vmafMean: candidate.vmafMean, vmafP5: candidate.vmafP5, cambiMean: candidate.cambiMean, qualityRejectedReason: candidate.qualityRejectedReason, playbackBlockers: candidate.playbackBlockers })),
      })
      if (!onMeasuredCandidates && !sampleDirectory) {
        await fs.rm(outputDirectory, { recursive: true, force: true })
        selected.samplePaths = undefined
      }
      return { encoder: selected.encoder, crf: selected.quality, preset: selected.preset, gpuId: selected.gpuId, useGpu: selected.gpuId !== undefined, measuredCandidate: selected }
    } catch (error) {
      getLoggingService().warn('[TVOptimization]', 'Measured candidate search failed', {
        event: 'candidate-search.failed',
        preflightId: searchContext?.preflightId,
        batchId: searchContext?.batchId,
        mediaItemId: searchContext?.mediaItemId,
        groupKey: searchContext?.groupKey,
        qualityProfile: options.qualityProfile,
        encoderPolicy: options.encoderPolicy,
        targetCodec: options.targetCodec,
        rounds: candidateSearchRounds,
        measuredCandidateCount: measuredCandidates.length,
        outcome: signal?.aborted || error instanceof Error && error.name === 'AbortError'
          ? 'cancelled'
          : error instanceof MeasuredQualityError ? error.decisionStatus : 'measurement_failed',
        errorName: error instanceof Error ? error.name : 'UnknownError',
        errorMessage: getErrorMessage(error),
      })
      if (!onMeasuredCandidates) await fs.rm(outputDirectory, { recursive: true, force: true })
      throw error
    }
  }

  async discardTaskSamples(task: QueuedTask): Promise<void> {
    const payload = (task.options as TranscodeOptions & { queuePayload?: QueuedTranscodePayload } | undefined)?.queuePayload
    if (payload?.samplePaths) for (const sample of payload.samplePaths) if (!this.isCachedSamplePath(sample)) await fs.rm(sample, { force: true })
  }

  async discardBatchSamples(task: QueuedTask): Promise<void> {
    const payload = (task.options as TranscodeOptions & { queuePayload?: QueuedTranscodePayload } | undefined)?.queuePayload
    if (!payload?.preflightId) return
    const root = path.resolve(app.getPath('userData'), 'transcoding-samples')
    const directory = path.resolve(root, payload.preflightId)
    if (path.dirname(directory) !== root) throw new Error('Invalid sample ownership directory')
    await fs.rm(directory, { recursive: true, force: true })
  }

  async discardShowPreflight(preflightId: string): Promise<void> {
    const raw = await getDatabase().getSetting(`${SHOW_PREFLIGHT_SETTING_PREFIX}${preflightId}`)
    if (raw) {
      const preflight = JSON.parse(raw) as { result: ShowTranscodePreflight }
      for (const episode of preflight.result.episodes) if (episode.samplePaths) for (const sample of episode.samplePaths) if (!this.isCachedSamplePath(sample)) await fs.rm(sample, { force: true })
    }
    const root = path.resolve(app.getPath('userData'), 'transcoding-samples')
    const directory = path.resolve(root, preflightId)
    if (path.dirname(directory) !== root) throw new Error('Invalid preflight sample directory')
    await fs.rm(directory, { recursive: true, force: true })
    this.showPreflights.delete(preflightId)
    await getDatabase().deleteSetting(`${SHOW_PREFLIGHT_SETTING_PREFIX}${preflightId}`)
    getLoggingService().info('[TVOptimization]', `Preflight discarded: preflight=${preflightId}`)
  }

  private isCachedSamplePath(samplePath: string): boolean {
    const cacheRoot = path.resolve(app.getPath('userData'), 'transcoding-samples', 'cache')
    const resolved = path.resolve(samplePath)
    const relative = path.relative(cacheRoot, resolved)
    return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
  }

  private async getCachedMeasurement(cacheKey: string, sourceSha256: string, sampleDirectory: string, sampleCount: number): Promise<CachedMeasurement | undefined> {
    const settingKey = `${MEASUREMENT_SETTING_PREFIX}${cacheKey}`
    const raw = await getDatabase().getSetting(settingKey)
    if (!raw) return undefined
    try {
      const cached = JSON.parse(raw) as CachedMeasurement
      const hasFiniteValues = (values: number[]) => values.length > 0 && values.every(Number.isFinite)
      const hasValidTimingEvidence = (evidence: MeasurementSourcePreparation['samples'][number]['source']) =>
        Number.isInteger(evidence.frames) && evidence.frames > 0 && Array.isArray(evidence.timestamps) && evidence.timestamps.length === evidence.frames &&
        evidence.timestamps.every((timestamp, index) => Number.isFinite(timestamp) && (index === 0 || timestamp > evidence.timestamps[index - 1])) && Number.isFinite(evidence.timestampPrecisionSeconds) && evidence.timestampPrecisionSeconds > 0 &&
        Number.isFinite(evidence.durationSeconds) && evidence.durationSeconds > 0 &&
        ['width', 'height'].every(key => evidence[key as 'width' | 'height'] === undefined || Number.isFinite(evidence[key as 'width' | 'height'])) &&
        ['pixelFormat', 'colorRange', 'colorSpace', 'colorTransfer', 'colorPrimaries'].every(key => evidence[key as 'pixelFormat' | 'colorRange' | 'colorSpace' | 'colorTransfer' | 'colorPrimaries'] === undefined || typeof evidence[key as 'pixelFormat' | 'colorRange' | 'colorSpace' | 'colorTransfer' | 'colorPrimaries'] === 'string')
      const isWithinSampleDirectory = (samplePath: string) => {
        const relative = path.relative(path.resolve(sampleDirectory), path.resolve(samplePath))
        return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
      }
      const validSourcePreparation = cached.sourcePreparation === undefined ||
        Array.isArray(cached.sourcePreparation.samples) && cached.sourcePreparation.samples.length === sampleCount && cached.sourcePreparation.samples.every(sample =>
          hasValidTimingEvidence(sample.source) && hasValidTimingEvidence(sample.reference) &&
          Number.isFinite(sample.sourceSelfVmaf) && Number.isFinite(sample.sourceCambiMean))
      const valid = cached.version === MEASUREMENT_VERSION && cached.searchVersion === OPTIMIZATION_SEARCH_VERSION && cached.cacheKey === cacheKey && cached.sourceSha256 === sourceSha256 && typeof cached.complete === 'boolean' &&
        Array.isArray(cached.candidates) && Array.isArray(cached.sampleHashes) && Array.isArray(cached.partialSamples) && Array.isArray(cached.partialSampleHashes) &&
        validSourcePreparation &&
        cached.candidates.every(candidate => Number.isFinite(candidate.outputBytes) && candidate.outputBytes > 0 &&
          Number.isFinite(candidate.sampledDurationSeconds) && candidate.sampledDurationSeconds > 0 &&
          Number.isFinite(candidate.vmafMean) && Number.isFinite(candidate.vmafP5) && Number.isFinite(candidate.cambiMean) &&
          Number.isFinite(candidate.encodingDurationMs) && candidate.encodingDurationMs! >= 0 &&
          (candidate.sourceSelfVmaf === undefined || Number.isFinite(candidate.sourceSelfVmaf)) &&
          (candidate.sourceCambiMean === undefined || Number.isFinite(candidate.sourceCambiMean)) &&
          Array.isArray(candidate.samplePaths) && candidate.samplePaths.length > 0) &&
        cached.partialSamples.every(sample => typeof sample.encoder === 'string' && typeof sample.preset === 'string' && Number.isFinite(sample.quality) && Number.isInteger(sample.sampleIndex) && sample.sampleIndex >= 0 &&
          (sample.screeningOnly === undefined || typeof sample.screeningOnly === 'boolean') &&
          Number.isFinite(sample.outputBytes) && sample.outputBytes > 0 && Number.isFinite(sample.sampledDurationSeconds) && sample.sampledDurationSeconds > 0 &&
          Number.isFinite(sample.encodingDurationMs) && sample.encodingDurationMs >= 0 && hasFiniteValues(sample.vmafScores) && hasFiniteValues(sample.cambiScores) &&
          Number.isFinite(sample.sourceSelfVmaf) && Number.isFinite(sample.sourceCambiMean) && typeof sample.samplePath === 'string') &&
        (cached.candidates.length > 0 || cached.partialSamples.length > 0 || (cached.sourcePreparation?.samples.length ?? 0) > 0) && cached.candidates.every((candidate, candidateIndex) => {
          const paths = candidate.samplePaths ?? []
          return paths.length > 0 && cached.sampleHashes[candidateIndex]?.length === paths.length && paths.every(isWithinSampleDirectory)
        }) && cached.sampleHashes.length === cached.candidates.length &&
        cached.partialSamples.length === cached.partialSampleHashes.length && cached.partialSamples.every(sample => {
          return isWithinSampleDirectory(sample.samplePath)
        })
      if (!valid) throw new Error('Cached measurement record does not match its source or cache directory')
      // Each cache validation reads current bytes afresh. Shared paths are
      // hashed once, but concurrent disk reads are bounded for slow NAS volumes.
      const hasher = new OperationFileHasher(sha256File, APP_CONFIG.transcoding.measuredSampleCache.maxConcurrentHashReads)
      const hashOnce = (filePath: string) => hasher.hash(filePath)
      const actualHashes = await Promise.all(cached.candidates.map(candidate => Promise.all((candidate.samplePaths ?? []).map(hashOnce))))
      if (actualHashes.some((hashes, candidateIndex) => hashes.some((hash, index) => hash !== cached.sampleHashes[candidateIndex][index]))) throw new Error('Cached sample content changed')
      const actualPartialHashes = await Promise.all(cached.partialSamples.map(sample => hashOnce(sample.samplePath)))
      if (actualPartialHashes.some((hash, index) => hash !== cached.partialSampleHashes[index])) throw new Error('Cached partial sample content changed')
      const searchComplete = cached.complete
      // Record actual reuse time so eligible unreferenced entries age out last.
      await fs.utimes(sampleDirectory, new Date(), new Date()).catch(error => {
        getLoggingService().warn('[TVOptimization]', `Could not update sample cache recency: ${getErrorMessage(error)}`)
      })
      getLoggingService().info('[TVOptimization]', 'Measured candidate cache reused', {
        event: 'measurement-cache.reused',
        cacheKey,
        candidates: cached.candidates.length,
        sourceSamples: cached.sourcePreparation?.samples.length ?? 0,
        searchVersion: cached.searchVersion,
        searchComplete,
      })
      return cached
    } catch (error) {
      getLoggingService().warn('[TVOptimization]', `Discarding invalid measured encode cache: cacheKey=${cacheKey}, reason=${getErrorMessage(error)}`)
      await getDatabase().deleteSetting(settingKey)
      await fs.rm(sampleDirectory, { recursive: true, force: true })
      return undefined
    }
  }

  private preflightFingerprint(result: ShowTranscodePreflight): string {
    return createHash('sha256').update(JSON.stringify(result.episodes)).digest('hex')
  }

  async approveShowTranscode(preflightId: string): Promise<ShowTranscodePreflight> {
    let preflight = this.showPreflights.get(preflightId)
    if (!preflight) {
      const saved = await getDatabase().getSetting(`${SHOW_PREFLIGHT_SETTING_PREFIX}${preflightId}`)
      if (saved) preflight = JSON.parse(saved) as { request: ShowTranscodeRequest; result: ShowTranscodePreflight }
    }
    if (!preflight) throw new Error('Show transcode preflight was not found')
    if ((preflight.result.measurementVersion !== MEASUREMENT_VERSION || preflight.result.searchVersion !== OPTIMIZATION_SEARCH_VERSION) && preflight.result.episodes.some(episode => episode.params?.measuredCandidate)) throw new Error('Measurement or search policy changed; run preflight again before approving this plan')
    preflight = { ...preflight, result: this.withCurrentSampleApprovals(preflight.result) }
    const requiredSampleGroupIds = [...this.getSampleGroupFingerprints(preflight.result).keys()]
    const approvedSampleGroupIds = new Set(this.withCurrentSampleApprovals(preflight.result).approvedSampleGroupIds)
    if (requiredSampleGroupIds.some(groupId => !approvedSampleGroupIds.has(groupId))) throw new Error('Review and approve every measured sample group before approving this plan')
    const approved = { ...preflight.result, userApproved: true, approvedAt: new Date().toISOString(), approvalFingerprint: this.preflightFingerprint(preflight.result) }
    getLoggingService().info('[TVOptimization]', `Preflight approved: preflight=${preflightId}, batch=${approved.batchId}, sampleRequiredEpisodes=${approved.episodes.filter(episode => episode.compatible && episode.decisionStatus === 'sample_required').length}`)
    this.retainPreflight(preflightId, { ...preflight, result: approved })
    await getDatabase().setSetting(`${SHOW_PREFLIGHT_SETTING_PREFIX}${preflightId}`, JSON.stringify({ ...preflight, result: approved }))
    return approved
  }

  async listShowQuarantine(seriesTitle: string, sourceId: string, seriesIdentityKey: string, libraryId: string): Promise<QuarantinedShowFile[]> {
    const episodes = await getDatabase().tvShows.getEpisodes(seriesTitle, sourceId, seriesIdentityKey, libraryId)
    const files: QuarantinedShowFile[] = []
    const jobs = await getDatabase().mediaRemuxJobs.getQuarantines(episodes.map((episode: any) => episode.id!))
    const ownedPaths = new Set(jobs.map((job: any) => path.resolve(job.quarantinePath!)))
    const directoryCache = new Map<string, import('fs').Dirent[]>()
    for (const episode of episodes) {
      if (!episode.id || !episode.file_path) continue
      const extension = path.extname(episode.file_path)
      const base = path.basename(episode.file_path, extension)
      const directory = path.dirname(episode.file_path)
      let entries = directoryCache.get(directory)
      if (!entries) {
        try {
          entries = await fs.readdir(directory, { withFileTypes: true })
          directoryCache.set(directory, entries)
        } catch (error) {
          throw new Error(`Cannot inspect quarantine directory ${directory}: ${getErrorMessage(error)}`)
        }
      }
      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.startsWith(`${base}.quarantine-`) || !/\.quarantine-\d+(?:-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})?\.[^.]+$/i.test(entry.name)) continue
        const quarantinePath = path.join(directory, entry.name)
        const stat = await fs.stat(quarantinePath)
        files.push({ mediaItemId: episode.id, label: formatMediaDisplayName(episode, seriesTitle), path: quarantinePath, size: stat.size, modifiedAt: new Date(stat.mtimeMs).toISOString(), owned: ownedPaths.has(path.resolve(quarantinePath)) })
      }
    }
    return files
  }

  async purgeShowQuarantine(seriesTitle: string, sourceId: string, seriesIdentityKey: string, libraryId: string): Promise<{ purged: number }> {
    const files = await this.listShowQuarantine(seriesTitle, sourceId, seriesIdentityKey, libraryId)
    const journals = await getDatabase().getSettingsByPrefix('transcoding.activation.')
    const journalPaths = new Set(Object.values(journals).flatMap(value => {
      const journal = JSON.parse(value as string) as { quarantinePath?: string }
      return journal.quarantinePath ? [journal.quarantinePath] : []
    }))
    for (const file of files) {
      if (!file.owned) throw new Error(`Cannot purge ${file.path}; no optimization job owns this backup. Review it separately.`)
      if (journalPaths.has(file.path)) throw new Error(`Cannot purge ${file.path}; it is referenced by an unresolved activation journal`)
    }
    for (const file of files) await fs.unlink(file.path)
    return { purged: files.length }
  }

  private runFFmpeg(
    inputPath: string,
    outputPath: string,
    params: TranscodingParams,
    options: TranscodeOptions,
    onProgress: (p: TranscodeProgress) => void,
    signal?: AbortSignal
  ): Promise<boolean> {
    return new Promise((resolve, reject) => {
      const analyzer = getMediaFileAnalyzer()
      const ffmpegPath = analyzer.getFFmpegPath()
      if (!ffmpegPath) {
        reject(new TranscodeError('FFmpeg path is unavailable'))
        return
      }
      const actualPath = PathUtils.resolveExecutablePath(ffmpegPath)

      if (!params.ffmpegArgs?.length) throw new TranscodeError('Execution requires the planned FFmpeg command')
      const args = params.ffmpegArgs.map(arg => {
          if (arg === '<input>') return inputPath
          if (arg === '<output>') return outputPath
          return arg
        })

      getLoggingService().info('[TranscodingService]', `Starting FFmpeg transcode: ${ffmpegPath} ${args.join(' ')}`)

      signal?.throwIfAborted()
      const proc = spawn(actualPath, args)
      let stderrBuffer = ''
      let outputLimitExceeded = false
      let outputInspectionError: Error | undefined
      const outputLimitMonitor = options.maxOutputBytes === undefined ? undefined : setInterval(() => {
        if (!existsSync(outputPath)) return
        void fs.stat(outputPath).then(stats => {
          if (stats.size > options.maxOutputBytes! && !outputLimitExceeded) {
            outputLimitExceeded = true
            proc.kill('SIGKILL')
          }
        }).catch(error => { outputInspectionError = error; proc.kill('SIGKILL') })
      }, 1000)

      const abort = () => { proc.kill('SIGKILL') }
      signal?.addEventListener('abort', abort, { once: true })
      if (signal?.aborted) abort()

      // Parse FFmpeg progress
      let durationSeconds = 0
      let lastReportedSecond = -1
      proc.stderr.on('data', (data) => {
        const line = data.toString()
        stderrBuffer += line

        // Extract duration first time
        if (durationSeconds === 0) {
          const durMatch = line.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/)
          if (durMatch) {
            durationSeconds = parseInt(durMatch[1], 10) * 3600 + parseInt(durMatch[2], 10) * 60 + parseFloat(durMatch[3])
          }
        }

        // Parse time, fps, and speed
        const timeMatch = line.match(/time=\s*(\d+):(\d+):(\d+(?:\.\d+)?)/)
        const fpsMatch = line.match(/fps=\s*(\d+(?:\.\d+)?)/)
        const speedMatch = line.match(/speed=\s*(\d+(?:\.\d+)?)x/)

        if (timeMatch && durationSeconds > 0) {
          const currentTime = parseInt(timeMatch[1], 10) * 3600 + parseInt(timeMatch[2], 10) * 60 + parseFloat(timeMatch[3])
          const currentSecond = Math.floor(currentTime)

          // Handle stream synchronization jump backwards when video encoding begins after audio stream pre-copy
          if (lastReportedSecond !== -1 && currentSecond < lastReportedSecond - 5) {
            lastReportedSecond = currentSecond
          } else if (currentSecond === lastReportedSecond) {
            return
          }
          lastReportedSecond = currentSecond

          const percent = Math.min(99.9, Math.max(0, (currentTime / durationSeconds) * 100))
          const fps = fpsMatch ? parseFloat(fpsMatch[1]) : 0
          const speed = speedMatch ? parseFloat(speedMatch[1]) : 0
          const speedStr = speed > 0 ? `${speed.toFixed(1)}x` : undefined

          let eta = 'calculating...'
          const effectiveSpeed = speed
          if (effectiveSpeed > 0 && durationSeconds > currentTime) {
            const remainingSec = (durationSeconds - currentTime) / effectiveSpeed
            const etaMin = Math.floor(remainingSec / 60)
            const etaSec = Math.floor(remainingSec % 60)
            eta = etaMin > 0 ? `${etaMin}m ${etaSec}s` : `${etaSec}s`
          }

          onProgress({ percent, fps, eta, speed: speedStr, status: 'encoding' })
        }
      })

      proc.on('close', (code) => {
        if (outputLimitMonitor) clearInterval(outputLimitMonitor)
        signal?.removeEventListener('abort', abort)
        if (outputInspectionError) { reject(outputInspectionError); return }
        if (code === 0) {
          resolve(true)
        } else {
          if (signal?.aborted) {
            resolve(false)
          } else if (outputLimitExceeded) {
            reject(new TranscodeError(`FFmpeg output exceeded the configured maximum of ${options.maxOutputBytes} bytes`, code ?? undefined, stderrBuffer.trim()))
          } else {
            const stderrSnippet = stderrBuffer.trim()
            reject(new TranscodeError(`FFmpeg process failed with exit code ${code}`, code ?? undefined, stderrSnippet))
          }
        }
      })

      proc.on('error', (err) => {
        if (outputLimitMonitor) clearInterval(outputLimitMonitor)
        signal?.removeEventListener('abort', abort)
        if (signal?.aborted) return resolve(false)
        getLoggingService().error('[FFmpeg]', 'Process error:', err)
        reject(new TranscodeError(`FFmpeg process execution error: ${err.message}`, undefined, stderrBuffer.trim()))
      })
    })
  }
}

let transcodingInstance: TranscodingService | null = null
export function getTranscodingService(): TranscodingService {
  if (!transcodingInstance) {
    transcodingInstance = new TranscodingService()
  }
  return transcodingInstance
}

export function resetTranscodingServiceForTesting(): void {
  transcodingInstance = null
}
