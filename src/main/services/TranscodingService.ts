import { spawn } from 'child_process'
import * as fs from 'fs/promises'
import { existsSync } from 'fs'
import { app } from 'electron'
import { APP_CONFIG } from '@main/config'
import { createHash, randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import * as path from 'path'
import { getDatabase } from '@main/database/BetterSQLiteService'
import { getLoggingService } from '@main/services/LoggingService'
import { getMediaFileAnalyzer } from '@main/services/MediaFileAnalyzer'
import { PathUtils } from '@main/services/utils/PathUtils'
import { GpuDetector, type GpuInfo } from '@main/services/utils/GpuDetector'
import { TranscodeCommandFactory } from './transcoding/TranscodeCommandFactory'
import { validateHdrTranscode } from './transcoding/HdrTranscodingPolicy'
import { buildTranscodingCapabilities, resolveSelectedGpuId, TranscodingCapabilities } from './TranscodingCapabilities'
import type { FileAnalysisResult } from './MediaFileAnalyzer'
import type { StreamSelectionPolicy } from './transcoding/StreamSelectionPlan'
import { buildStreamSelectionPlan } from './transcoding/StreamSelectionPlan'
import { MediaPathAuthorization } from './MediaPathAuthorization'
import { TaskType, MediaItem, type QueuedTask } from '@main/types/database'
import { getStatsCacheService } from './StatsCacheService'
import { getQualityAnalyzer } from './QualityAnalyzer'
import type { MediaSourceTier } from './transcoding/TrashSourceClassifier'
import { StreamRemuxCommandBuilder } from './transcoding/StreamRemuxCommandBuilder'
import { buildCandidateLadder, selectMeasuredCandidate } from './MeasuredOptimizationPolicy'
import { buildTargetTranscodePlan, type TargetTranscodePlan } from './transcoding/TargetTranscodePlan'
import type { MeasuredCandidate } from './MeasuredOptimizationPolicy'
import { ChildProcessMeasurementRunner, MeasuredOptimizationService } from './MeasuredOptimizationService'
import { getErrorMessage } from '@main/services/utils/errorUtils'
import { evaluatePlaybackTarget, type PlaybackTargetEvaluation, type PlaybackTargetProfile } from '@main/types/playbackTarget'

export class TranscodeError extends Error {
  constructor(message: string, public readonly exitCode?: number, public readonly stderr?: string) {
    super(message)
    this.name = 'TranscodeError'
  }
}

export interface TranscodeOptions {
  targetCodec?: 'av1' | 'hevc'
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
  transcodingEngine?: 'ffmpeg'
  targetSize?: string
  maxOutputBytes?: number
  optimizationMode?: 'smart' | 'remux_only' | 'transcode'
  qualityProfile?: 'transparent' | 'balanced' | 'maximum_savings'
  encoderPolicy?: 'hardware' | 'software' | 'compare'
  targetProfileId?: string
  targetContainer?: 'mkv' | 'mp4'
  targetAudioCodec?: 'aac' | 'ac3' | 'eac3'
  targetHdrFormat?: 'SDR' | 'HDR10'
  targetConversion?: TargetTranscodePlan
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
  expiresAt: string
  sourceSize: number
  sourceMtimeMs: number
  sourceSha256?: string
  params?: TranscodingParams
  sourceAnalysis?: FileAnalysisResult
  targetProfile?: PlaybackTargetProfile
  samplePaths?: string[]
}

export interface TranscodeProgress {
  percent: number
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
  seriesTitle: string
  seriesIdentityKey?: string
  sourceId: string
  libraryId?: string
  options: TranscodeOptions
}

export interface QuarantinedShowFile {
  mediaItemId: number
  label: string
  path: string
  size: number
  modifiedAt: string
  owned: boolean
}

export interface ShowTranscodePreflight {
  preflightId: string
  batchId: string
  seriesTitle: string
  episodeCount: number
  compatible: boolean
  expiresAt: string
  userApproved?: boolean
  approvedAt?: string
  approvalFingerprint?: string
  episodes: Array<{
    mediaItemId: number
    label: string
    compatible: boolean
    reason?: string
    hdrFormat: string
    sourceSize: number
    sourceMtimeMs: number
    recommendedAction?: 'video_transcode' | 'stream_pruning' | 'already_optimized'
    decisionStatus?: 'actionable' | 'already_optimized' | 'sample_required' | 'insufficient_evidence'
    evidenceStatus?: 'measured' | 'estimated' | 'insufficient'
    confidence?: 'high' | 'medium' | 'low' | 'none'
    estimatedSavingsBytes?: number | null
    savingsBasis?: string
    sourceTier?: MediaSourceTier
    adviceReason?: string
    targetCompatibility?: PlaybackTargetEvaluation
    measuredParameters?: Pick<TranscodingParams, 'encoder' | 'crf' | 'preset'>
    sourceSha256?: string
    options?: TranscodeOptions
    params?: TranscodingParams
    sourceAnalysis?: FileAnalysisResult
    targetProfile?: PlaybackTargetProfile
    samplePaths?: string[]
    sampleHashes?: string[]
    changes?: string[]
  }>
}

/**
 * TranscodingService
 *
 * Coordinates FFmpeg transcoding from explicit parameters.
 */
export class TranscodingService {
  private activeJobs = new Map<number, AbortController>()
  private initializedPromise: Promise<void> | null = null
  private capabilitiesPromise: Promise<TranscodingCapabilities> | null = null
  private analysisCache = new Map<string, Awaited<ReturnType<ReturnType<typeof getMediaFileAnalyzer>['analyzeFile']>>>()
  private showPreflights = new Map<string, { request: ShowTranscodeRequest; result: ShowTranscodePreflight }>()
  private measuredOptimizationService = new MeasuredOptimizationService()

  constructor() {
    // Initialization is deferred until first use to allow DB to be ready
  }


  invalidate(): void {
    this.initializedPromise = null
    this.capabilitiesPromise = null
    this.analysisCache.clear()
    getLoggingService().debug('[TranscodingService]', 'TranscodingService invalidated caches')
  }

  cancelTranscode(mediaItemId?: number): boolean {
    if (mediaItemId !== undefined) {
      const controller = this.activeJobs.get(mediaItemId)
      if (!controller) return false
      controller.abort()
      getLoggingService().info('[TranscodingService]', `Cancelled transcode job for media item ${mediaItemId}`)
      return true
    }
    if (this.activeJobs.size > 0) {
      this.abortAll()
      return true
    }
    return false
  }

  abortAll(): void {
    for (const [id, controller] of this.activeJobs.entries()) {
      controller.abort()
      getLoggingService().info('[TranscodingService]', `Aborted transcode job for media item ${id}`)
    }
    this.activeJobs.clear()
  }

  async preflightShowTranscode(request: ShowTranscodeRequest): Promise<ShowTranscodePreflight> {
    if (!request.seriesTitle.trim() || !request.sourceId.trim()) throw new Error('Show title and source ID are required')
    if (!request.seriesIdentityKey?.trim()) throw new Error('TV series identity is required')
    if (!request.libraryId?.trim()) throw new Error('TV series library is required')
    const profileId = request.options.targetProfileId || await getDatabase().config.getSetting('optimization_default_target_profile_id')
    if (!profileId) throw new Error('A default playback profile is required before show optimization can run')
    const targetProfile = await getDatabase().playbackTargetProfiles.get(profileId)
    if (!targetProfile) throw new Error(`Playback target profile ${profileId} was not found`)
    const episodes = await getDatabase().tvShows.getEpisodes(request.seriesTitle, request.sourceId, request.seriesIdentityKey, request.libraryId)
    if (episodes.length === 0) throw new Error('No local episodes were found for the selected show')
    const batchId = `batch_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
    const preflightId = `${batchId}_preflight`
    const queuedMediaIds = new Set((await (await import('./TaskQueueService')).getTaskQueueService().getTasks()).filter(task => task.type === TaskType.Transcode && ['queued', 'running'].includes(task.status)).map(task => task.mediaItemId).filter((id): id is number => id !== undefined))

    const processEpisode = async (episode: typeof episodes[0]): Promise<ShowTranscodePreflight['episodes'][0]> => {
      const label = `${request.seriesTitle} S${String(episode.season_number || 0).padStart(2, '0')}E${String(episode.episode_number || 0).padStart(2, '0')} ${episode.title}`
      const fallbackMediaItemId = episode.id || 0
      try {
        if (!episode.id || !episode.file_path || !episode.source_id) {
          throw new Error(`Episode "${label}" has no local source identity`)
        }
        if (queuedMediaIds.has(episode.id)) {
          throw new Error(`Episode "${label}" already has a queued or running transcode`)
        }
        await this.assertAuthorizedItem(episode.id)
        const stat = await fs.stat(episode.file_path)
        if (!episode.deep_analysis) {
          throw new Error(`Episode "${label}" has no persisted analysis; analyze the show before optimizing it`)
        }
        const analysis = await getMediaFileAnalyzer().analyzeFile(episode.file_path)
        if (!analysis.success || analysis.filePath !== episode.file_path || !analysis.video) {
          throw new Error(`Current media analysis is invalid for "${label}"`)
        }
        this.analysisCache.set(episode.file_path, analysis)
        const advice = getQualityAnalyzer().getOptimizationAdvice(episode, analysis)
        const sourcePlan = buildStreamSelectionPlan(analysis, request.options)
        const streamsChanged = sourcePlan.audioStreamIndexes.length !== analysis.audioTracks.length || sourcePlan.subtitleStreamIndexes.length !== analysis.subtitleTracks.length
        const selectedAnalysis = { ...analysis, audioTracks: analysis.audioTracks.filter(track => sourcePlan.audioStreamIndexes.includes(track.index)), subtitleTracks: analysis.subtitleTracks.filter(track => sourcePlan.subtitleStreamIndexes.includes(track.index)) }
        const plannedContainer = request.options.targetContainer === 'mp4' ? 'mp4' : request.options.targetContainer === 'mkv' ? 'matroska' : analysis.container
        const containerChanged = !analysis.container?.split(',').includes(plannedContainer!)
        const sourceCompatibility = evaluatePlaybackTarget(targetProfile, { ...selectedAnalysis, container: plannedContainer })
        const shouldEncode = request.options.optimizationMode === 'transcode' || (request.options.optimizationMode === 'smart' && (advice.action === 'video_transcode' || sourceCompatibility.overall === 'incompatible'))
        const options: TranscodeOptions = { ...request.options, optimizationMode: shouldEncode ? 'transcode' : 'remux_only', encoderPolicy: request.options.encoderPolicy, useGpu: shouldEncode && request.options.encoderPolicy !== 'software', gpuId: shouldEncode && request.options.encoderPolicy !== 'software' ? request.options.gpuId : undefined }
        if (!shouldEncode && !streamsChanged && !containerChanged) {
          return { mediaItemId: episode.id, label, compatible: sourceCompatibility.overall === 'compatible', reason: sourceCompatibility.overall === 'incompatible' ? 'Retained streams do not satisfy the selected playback profile' : undefined, hdrFormat: analysis.video.hdrFormat || 'SDR', sourceSize: stat.size, sourceMtimeMs: stat.mtimeMs, recommendedAction: 'already_optimized', decisionStatus: 'already_optimized', targetCompatibility: sourceCompatibility, sourceTier: advice.sourceTier, adviceReason: advice.reason }
        }
        if (shouldEncode) {
          options.maxOutputBytes = (await this.resolveMaximumOutputBytes(stat.size, options, getDatabase()))!
          options.targetConversion = buildTargetTranscodePlan(analysis, targetProfile, options)
        }
        const sourceSha256 = await sha256File(episode.file_path)
        const sampleDirectory = path.join(app.getPath('userData'), 'transcoding-samples', preflightId, String(episode.id))
        let params: TranscodingParams
        let targetCompatibility = sourceCompatibility
        try {
          if (shouldEncode) {
            const measuredParameters = await this.selectMeasuredParameters(episode.file_path, options, sampleDirectory)
            Object.assign(options, measuredParameters)
            options.useGpu = measuredParameters.encoder !== 'x265' && measuredParameters.encoder !== 'svt_av1'
            if (!options.useGpu) options.gpuId = undefined
          }
          params = await this.getTranscodeParameters(episode.file_path, options)
          if (shouldEncode) {
            params.measuredCandidate = (options as TranscodeOptions & { measuredCandidate?: MeasuredCandidate }).measuredCandidate
            for (const samplePath of params.measuredCandidate!.samplePaths!) {
              const sample = await getMediaFileAnalyzer().analyzeFile(samplePath)
              this.verifyPlannedStreams(analysis, sample, options, params)
              targetCompatibility = evaluatePlaybackTarget(targetProfile, sample)
              if (targetCompatibility.overall !== 'compatible') throw new Error(`Measured sample is incompatible: ${Object.values(targetCompatibility.findings).filter(finding => finding.status === 'incompatible').map(finding => finding.rule).join('; ')}`)
            }
          }
        } catch (error) {
          await fs.rm(sampleDirectory, { recursive: true, force: true })
          throw error
        }
        if (targetCompatibility.overall !== 'compatible') throw new Error('Selected retained streams are incompatible with the playback target')
        const samplePaths = params.measuredCandidate?.samplePaths
        return {
          mediaItemId: episode.id, label, compatible: true, hdrFormat: analysis.video.hdrFormat || 'SDR', sourceSize: stat.size, sourceMtimeMs: stat.mtimeMs, sourceSha256,
          recommendedAction: shouldEncode ? 'video_transcode' : 'stream_pruning', decisionStatus: shouldEncode ? 'sample_required' : 'actionable', evidenceStatus: shouldEncode ? 'measured' : advice.evidence_status, confidence: shouldEncode ? 'high' : advice.confidence,
          estimatedSavingsBytes: shouldEncode ? null : advice.estimatedSavingsBytes, savingsBasis: shouldEncode ? 'video_sample_encode' : advice.savings_basis, sourceTier: advice.sourceTier, adviceReason: shouldEncode ? 'Measured encoding passed the selected quality gates. Review all three samples before approval.' : advice.reason,
          targetCompatibility, options, params, sourceAnalysis: analysis, targetProfile, samplePaths, sampleHashes: samplePaths ? await Promise.all(samplePaths.map(sha256File)) : undefined, changes: options.targetConversion?.changes,
          measuredParameters: { encoder: params.encoder, crf: params.crf, preset: params.preset },
        }
      } catch (error) {
        const errorMsg = getErrorMessage(error)
        getLoggingService().warn('[TranscodingService]', `Episode preflight incompatible: "${label}": ${errorMsg}`)
        return {
          mediaItemId: fallbackMediaItemId,
          label,
          compatible: false,
          reason: errorMsg,
          hdrFormat: 'Unknown',
          sourceSize: 0,
          sourceMtimeMs: 0,
          recommendedAction: undefined,
          decisionStatus: 'insufficient_evidence',
          evidenceStatus: 'insufficient',
          confidence: 'none',
          savingsBasis: 'insufficient_data'
        }
      }
    }

    // Parallel preflight processing in concurrency batches of 4
    const CONCURRENCY = 4
    const results: ShowTranscodePreflight['episodes'] = []
    for (let i = 0; i < episodes.length; i += CONCURRENCY) {
      const chunk = episodes.slice(i, i + CONCURRENCY)
      const chunkResults = await Promise.all(chunk.map(ep => processEpisode(ep)))
      results.push(...chunkResults)
    }

    const result = { preflightId, batchId, seriesTitle: request.seriesTitle, episodeCount: episodes.length, compatible: results.some(episode => episode.compatible), expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(), userApproved: false, episodes: results }
    this.showPreflights.set(preflightId, { request, result })
    await getDatabase().config.setSetting(`transcoding.preflight.${preflightId}`, JSON.stringify({ request, result }))
    return result
  }

  async queueShowTranscode(preflightId: string): Promise<{ batchId: string; queuedMediaItemIds: number[] }> {
    let preflight = this.showPreflights.get(preflightId)
    if (!preflight) {
      const saved = await getDatabase().config.getSetting(`transcoding.preflight.${preflightId}`)
      if (saved) {
        try {
          preflight = JSON.parse(saved) as { request: ShowTranscodeRequest; result: ShowTranscodePreflight }
        } catch {
          throw new Error(`Stored show transcode preflight ${preflightId} is invalid; run preflight again`)
        }
      }
    }
    if (!preflight) throw new Error('Show transcode preflight was not found or has expired')
    if (Date.now() > Date.parse(preflight.result.expiresAt)) {
      await this.discardShowPreflight(preflightId)
      throw new Error('Show transcode preflight has expired; run preflight again')
    }
    const { getTaskQueueService } = await import('./TaskQueueService')
    const queueableEpisodes = preflight.result.episodes.filter(episode =>
      episode.compatible && (episode.decisionStatus === 'actionable' || (episode.decisionStatus === 'sample_required' && preflight?.result.userApproved === true)) && episode.recommendedAction !== 'already_optimized'
    )
    if (queueableEpisodes.length === 0) {
      throw new Error('No episodes have sufficient evidence for a safe optimization action.')
    }
    if (preflight.result.userApproved && preflight.result.approvalFingerprint !== this.preflightFingerprint(preflight.result)) throw new Error('Approved show plan changed; run preflight again')
    for (const episode of queueableEpisodes) {
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
      options: { ...episode.options, queuePayload: { batchId: preflight.result.batchId, preflightId, expiresAt: preflight.result.expiresAt, sourceSize: episode.sourceSize, sourceMtimeMs: episode.sourceMtimeMs, sourceSha256: episode.sourceSha256, params: episode.params, sourceAnalysis: episode.sourceAnalysis, targetProfile: episode.targetProfile, samplePaths: episode.samplePaths } }
    }))
    if (tasks.length > 0) await getTaskQueueService().addTasks(tasks)
    this.showPreflights.delete(preflightId)
    await getDatabase().config.deleteSetting(`transcoding.preflight.${preflightId}`)
    return { batchId: preflight.result.batchId, queuedMediaItemIds: queueableEpisodes.map(episode => episode.mediaItemId) }
  }

  private async assertAuthorizedItem(mediaItemId: number): Promise<void> {
    const db = getDatabase()
    const item = await db.media.getItemById(mediaItemId)
    if (!item?.file_path || !item.source_id) throw new Error('Media item has no local source path')
    const source = await db.sources.getSourceById(item.source_id)
    if (!source) throw new Error('Media source was not found')
    MediaPathAuthorization.assertMediaAuthorized(item, source)
  }

  private async writeActivationJournal(mediaItemId: number, state: Record<string, unknown>): Promise<void> {
    await getDatabase().config.setSetting(`transcoding.activation.${mediaItemId}`, JSON.stringify({ mediaItemId, ...state, updatedAt: new Date().toISOString() }))
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

  private async recoverActivationJournals(): Promise<void> {
    const db = getDatabase()
    const journals = await db.config.getSettingsByPrefix('transcoding.activation.')
    for (const [key, value] of Object.entries(journals)) {
      const journal = JSON.parse(value) as {
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

      if ((journal.phase === 'prepared' || journal.phase === 'source_quarantined') && tempExists && journal.targetPath && journal.quarantinePath && journal.outputStats?.success && journal.mode) {
        if (!quarantineExists) await fs.rename(journal.inputPath, journal.quarantinePath)
        await fs.rename(journal.tempPath!, journal.targetPath)
        targetExists = true
        quarantineExists = true
        tempExists = false
      }

      // Crash occurred after source was quarantined but before target was placed
      if ((journal.phase === 'source_quarantined' || journal.phase === 'prepared') && !targetExists && quarantineExists && !inputExists) {
        await fs.rename(journal.quarantinePath!, journal.inputPath)
        if (tempExists) await fs.unlink(journal.tempPath!)
        await db.config.deleteSetting(key)
        getLoggingService().info('[TranscodingService]', `Rollback completed for media item ${journal.mediaItemId} from quarantine`)
        continue
      }

      // Crash occurred after target file was successfully placed/activated
      if ((journal.phase === 'output_activated' || journal.phase === 'source_quarantined' || (journal.phase === 'prepared' && quarantineExists && !tempExists)) && targetExists && journal.targetPath) {
        // Ensure database points to the newly activated target path
        const analysis = journal.outputStats ?? await getMediaFileAnalyzer().analyzeFile(journal.targetPath)
        if (!analysis.success) throw new Error('Activation recovery requires verified output analysis')
        await db.media.updatePathAndStats(journal.mediaItemId, journal.targetPath, { ...analysis, filePath: journal.targetPath })
        this.analysisCache.delete(journal.inputPath)
        this.analysisCache.delete(journal.targetPath)
        getStatsCacheService().invalidate()
        if (journal.mode === 'replace' && quarantineExists) await fs.unlink(journal.quarantinePath!)
        const job = await db.mediaRemuxJobs.getLatest(journal.mediaItemId)
        if (job && job.sourcePath === journal.inputPath && job.quarantinePath === journal.quarantinePath) {
          const encodedReductionBytes = job.sourceSize - analysis.fileSize!
          const retainedOriginalBytes = journal.mode === 'replace' ? 0 : job.sourceSize
          await db.mediaRemuxJobs.update(job.id, { status: 'promoted', actualOutputBytes: analysis.fileSize, bytesSaved: encodedReductionBytes, outputDurationMs: analysis.duration, outputAnalysis: JSON.stringify({ ...analysis, filePath: journal.targetPath, encodedReductionBytes, retainedOriginalBytes, physicallyReclaimedBytes: journal.mode === 'replace' ? encodedReductionBytes : -analysis.fileSize! }) })
        }
        await db.config.deleteSetting(key)
        getLoggingService().info('[TranscodingService]', `Committed forward activation recovery for media item ${journal.mediaItemId}`)
        continue
      }

      // Crash in prepared phase where neither source was quarantined nor target placed
      if (journal.phase === 'prepared' && inputExists && !quarantineExists) {
        if (tempExists) await fs.unlink(journal.tempPath!)
        await db.config.deleteSetting(key)
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
    if (this.capabilitiesPromise && !options.refresh) return this.capabilitiesPromise
    this.capabilitiesPromise = (async () => {
      const [availability, gpus] = await Promise.all([
        this.checkAvailability(),
        GpuDetector.detectGpus({ refresh: options.refresh })
      ])
      const persistedSelection = await getDatabase().config.getSetting('selected_transcoding_gpu_id')
      const selectedGpuId = resolveSelectedGpuId(gpus, persistedSelection === null ? undefined : persistedSelection || null)
      if (persistedSelection === null) {
        await getDatabase().config.setSetting('selected_transcoding_gpu_id', selectedGpuId || '')
      }
      const encoderProbe = await this.probeFfmpegEncoders(gpus)
      if (encoderProbe.failures.length > 0) {
        getLoggingService().error('[TranscodingService]', `FFmpeg encoder verification failed: ${encoderProbe.failures.join('; ')}`)
      }
      const capabilities = buildTranscodingCapabilities(availability, gpus, selectedGpuId, encoderProbe.encoders, encoderProbe.failures)
      getLoggingService().info('[TranscodingService]', `Hardware snapshot captured at ${capabilities.detectedAt}: ${gpus.length} GPU(s), encoders=${capabilities.encoders.join(',') || 'none'}`)
      return capabilities
    })()
    return this.capabilitiesPromise
  }

  private async probeFfmpegEncoders(gpus: GpuInfo[]): Promise<{ encoders: string[]; failures: string[] }> {
    const ffmpegPath = getMediaFileAnalyzer().getFFmpegPath()
    if (!ffmpegPath) return { encoders: [], failures: ['FFmpeg path is unavailable'] }
    const compiled = await new Promise<{ encoders: string[]; failures: string[] }>(resolve => {
      const proc = spawn(PathUtils.resolveExecutablePath(ffmpegPath), ['-hide_banner', '-encoders'])
      let output = ''
      proc.stdout.on('data', data => { output += data.toString() })
      proc.stderr.on('data', data => { output += data.toString() })
      proc.on('error', error => resolve({ encoders: [], failures: [`Failed to execute ${ffmpegPath}: ${error.message}`] }))
      proc.on('close', code => {
        if (code !== 0) return resolve({ encoders: [], failures: [`FFmpeg encoder probe exited with code ${code}`] })
        const ffmpegNames = [...output.matchAll(/^\s*[A-Z.]+\s+(\S+)/gm)].map(match => match[1])
        const aliases: Record<string, string> = {
          hevc_nvenc: 'nvenc_h265',
          av1_nvenc: 'nvenc_av1',
          hevc_qsv: 'qsv_h265',
          av1_qsv: 'qsv_av1',
          libx265: 'x265',
          libsvtav1: 'svt_av1',
          libx264: 'libx264'
        }
        const names = ffmpegNames.map(name => aliases[name] || name)
        getLoggingService().debug('[TranscodingService]', `FFmpeg encoder verification completed: ${names.length} encoders found`)
        resolve({ encoders: names, failures: [] })
      })
    })
    const hardware: Record<string, { vendor: string; codec: string }> = {
      nvenc_h265: { vendor: 'NVIDIA', codec: 'hevc_nvenc' }, nvenc_av1: { vendor: 'NVIDIA', codec: 'av1_nvenc' },
      qsv_h265: { vendor: 'Intel', codec: 'hevc_qsv' }, qsv_av1: { vendor: 'Intel', codec: 'av1_qsv' }
    }
    const encoders: string[] = []
    for (const encoder of compiled.encoders) {
      const device = hardware[encoder]
      if (device) {
        if (!gpus.some(gpu => gpu.vendor === device.vendor)) continue
        try {
          await new ChildProcessMeasurementRunner().run(ffmpegPath, ['-v', 'error', '-f', 'lavfi', '-i', `testsrc2=size=${APP_CONFIG.transcoding.encoderProbeWidth}x${APP_CONFIG.transcoding.encoderProbeHeight}`, '-frames:v', '1', '-c:v', device.codec, '-f', 'null', '-'])
        } catch (error) {
          getLoggingService().warn('[TranscodingService]', `Encoder ${encoder} cannot run on the detected hardware and is unavailable: ${getErrorMessage(error)}`)
          continue
        }
      }
      encoders.push(encoder)
    }
    return { encoders, failures: compiled.failures }
  }

  async setSelectedGpu(gpuId: string | null): Promise<TranscodingCapabilities> {
    const capabilities = await this.getCapabilities()
    if (gpuId !== null && !capabilities.gpus.some(gpu => gpu.id === gpuId)) {
      throw new Error(`Requested GPU ID "${gpuId}" is not available.`)
    }
    await getDatabase().config.setSetting('selected_transcoding_gpu_id', gpuId || '')
    this.capabilitiesPromise = Promise.resolve({ ...capabilities, selectedGpuId: gpuId })
    return this.capabilitiesPromise
  }




  /**
   * Build transcoding parameters from explicit settings or measured samples.
   */
  async getTranscodeParameters(filePath: string, options: TranscodeOptions = {}): Promise<TranscodingParams> {
    const analyzer = getMediaFileAnalyzer()
    let analysis = this.analysisCache.get(filePath)
    if (!analysis) {
      analysis = await analyzer.analyzeFile(filePath)
      if (analysis.success) this.analysisCache.set(filePath, analysis)
    }
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
        file_size: analysis.fileSize,
        duration: analysis.duration,
        video_codec: analysis.video?.codec,
        video_bitrate: analysis.video?.bitrate,
        resolution: analysis.video ? `${analysis.video.width}x${analysis.video.height}` : undefined,
        height: analysis.video?.height
      }
      const advice = getQualityAnalyzer().getOptimizationAdvice(itemToAnalyze as MediaItem, analysis)
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
      const builder = new StreamRemuxCommandBuilder()
      const ffmpegArgs = builder.buildFFmpegArgs('<input>', '<output>', effectiveOptions, analysis)
      if (effectiveOptions.customArgs) {
        const parts = effectiveOptions.customArgs.match(/"[^"]*"|'[^']*'|\S+/g) || []
        const safeRegex = /^[a-zA-Z0-9\-_+=/\\:,.*"'\s]+$/
        const outputIndex = ffmpegArgs.length - 1
        const safeParts: string[] = []
        for (const part of parts) {
          const cleaned = part.replace(/^["']|["']$/g, '').trim()
          if (cleaned && safeRegex.test(cleaned)) {
            safeParts.push(cleaned)
          }
        }
        ffmpegArgs.splice(outputIndex, 0, ...safeParts)
      }
      return {
        summary: 'Lossless container stream remuxing (copy video)',
        ffmpegArgs,
        expectedSizeReduction: 'Stream pruning only',
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
        throw new Error(`GPU acceleration is not supported for GPU: "${matchedGpu.name}". Supported vendors are NVIDIA, Intel, AMD, and Apple.`)
      }
    }

    let expectedEncoder = ''
    if (effectiveOptions.useGpu || effectiveOptions.gpuId) {
      if (targetCodec === 'av1') {
        if (selectedVendor === 'NVIDIA') expectedEncoder = 'nvenc_av1'
        else if (selectedVendor === 'Intel') expectedEncoder = 'qsv_av1'
        else if (selectedVendor === 'AMD') expectedEncoder = 'av1_amf'
        else if (selectedVendor === 'Apple') {
          throw new Error('AV1 hardware encoding is not supported on Apple VideoToolbox.')
        }
      } else { // hevc
        if (selectedVendor === 'NVIDIA') expectedEncoder = 'nvenc_h265'
        else if (selectedVendor === 'Intel') expectedEncoder = 'qsv_h265'
        else if (selectedVendor === 'AMD') expectedEncoder = 'hevc_amf'
        else if (selectedVendor === 'Apple') expectedEncoder = 'vt_h265'
      }
    } else {
      expectedEncoder = targetCodec === 'hevc' ? 'x265' : 'svt_av1'
    }
    if (capabilitiesForOptions && capabilitiesForOptions.probeFailures.length > 0) {
      throw new Error(`FFmpeg encoder verification failed for the selected device: ${capabilitiesForOptions.probeFailures.join('; ')}`)
    }
    if (capabilitiesForOptions && capabilitiesForOptions.verifiedEncoders.length > 0 && !capabilitiesForOptions.verifiedEncoders.includes(expectedEncoder)) {
      throw new Error(`The selected device cannot produce ${targetCodec.toUpperCase()} with verified FFmpeg encoder ${expectedEncoder}.`)
    }

    const measuredParameters = hasManualOverrides
      ? { encoder: effectiveOptions.encoder!, crf: effectiveOptions.crf!, preset: effectiveOptions.preset! }
      : await this.selectMeasuredParameters(filePath, effectiveOptions)

    const summary = 'Explicit measured transcoding parameters'
    const videoCodec = measuredParameters.encoder
    const crf = measuredParameters.crf
    const preset = measuredParameters.preset
    const expectedSizeReduction: string | undefined = undefined
    const warnings: string[] = []

    if (!videoCodec) throw new Error('Video encoder must be explicitly selected.')
    if (crf === undefined) throw new Error('Video quality value must be explicitly selected.')
    if (!preset) throw new Error('Encoder preset must be explicitly selected.')

    // Validate parameters against allowed lists to prevent command injection
    const allowedVideoCodecs = [
      'svt_av1', 'svt_av1_10bit', 'x265', 'x265_10bit', 'x264',
      'nvenc_h264', 'nvenc_h265', 'nvenc_h265_10bit', 'nvenc_av1', 'nvenc_av1_10bit', 'av1_nvenc',
      'qsv_av1', 'qsv_h265', 'qsv_h265_10bit', 'qsv_h264',
      'av1_amf', 'hevc_amf', 'vce_h264',
      'vt_h264', 'vt_h265'
    ]
    if (!allowedVideoCodecs.includes(videoCodec)) {
      throw new Error(`Invalid or unsupported video encoder: ${videoCodec}`)
    }
      
    if (typeof crf !== 'number' || crf < 0 || crf > 51) throw new Error(`Invalid video quality value: ${String(crf)}`)
    const finalCrf = crf
      
    const allowedPresets = ['ultrafast', 'superfast', 'veryfast', 'faster', 'fast', 'medium', 'slow', 'slower', 'veryslow', 'placebo', 'hq', 'hp', 'bd', 'll', 'llhq', 'llhp', 'lossless', 'p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'quality', '4', '6', '8']
    if (!allowedPresets.includes(preset)) throw new Error(`Invalid encoder preset: ${preset}`)
    const finalPreset = preset

    const resolvedOptions: TranscodeOptions = {
      ...effectiveOptions,
      targetCodec,
      gpuId: selectedGpuIdForOptions,
      encoder: videoCodec,
      crf: finalCrf,
      preset: finalPreset
    }

    const builder = TranscodeCommandFactory.getBuilder(selectedVendor, resolvedOptions)
    const ffmpegArgs = builder.buildFFmpegArgs('<input>', '<output>', resolvedOptions, analysis)

    // Add custom args if present
    if (effectiveOptions.customArgs) {
      const parts = effectiveOptions.customArgs.match(/"[^"]*"|'[^']*'|\S+/g) || []
      const safeRegex = /^[a-zA-Z0-9\-_+=/\\:,.*"'\s]+$/
      for (const part of parts) {
        const cleaned = part.replace(/^["']|["']$/g, '').trim()
        if (cleaned && safeRegex.test(cleaned)) {
          ffmpegArgs.splice(ffmpegArgs.length - 1, 0, cleaned)
        }
      }
    }

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
    onProgress?: (progress: TranscodeProgress) => void
  ): Promise<boolean> {
    const db = getDatabase()
    const item = await db.media.getItem(mediaItemId)
    if (!item || !item.file_path) throw new Error('Media item or file path not found')

    const availability = await this.checkAvailability()
    const engine = options.transcodingEngine
    if (!engine) {
      throw new Error('Transcoding engine must be explicitly selected.')
    }
    if (engine === 'ffmpeg' && !availability.ffmpeg) {
      throw new Error('FFmpeg is not available on this system.')
    }

    const controller = new AbortController()
    this.activeJobs.set(mediaItemId, controller)

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
      if (queuePayload && (sourceStat.size !== queuePayload.sourceSize || Math.abs(sourceStat.mtimeMs - queuePayload.sourceMtimeMs) > 1000)) {
        throw new Error('Source file changed after show preflight')
      }
      if (queuePayload?.sourceSha256 && sourceSha256 !== queuePayload.sourceSha256) throw new Error('Source file contents changed after show preflight')
      if (queuePayload?.targetProfile && JSON.stringify(await db.playbackTargetProfiles.get(queuePayload.targetProfile.id)) !== JSON.stringify(queuePayload.targetProfile)) throw new Error('Playback profile changed after approval')
      const params = queuePayload?.params ?? await this.getTranscodeParameters(inputPath, options)
      const sourceAnalysis = queuePayload?.sourceAnalysis ?? await getMediaFileAnalyzer().analyzeFile(inputPath)
      const encoderProfile = `${params.encoder}:${params.preset}:${params.crf}`
      const predictedOutputBytes = await db.mediaRemuxJobs.getCalibratedOutputBytes(sourceStat.size, 'transcode', encoderProfile)
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
        sourceDurationMs: item.duration ?? null,
        outputDurationMs: null,
        encoderProfile,
        sourceAnalysis: JSON.stringify({ duration: item.duration, fileSize: sourceStat.size }),
        outputAnalysis: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })
      await db.mediaRemuxJobs.update(optimizationJobId, { status: 'running' })
      
      const outputExt = (options.targetConversion?.container ?? options.targetContainer) === 'mp4' ? '.mp4' : '.mkv'
      let tempBaseDir = path.dirname(inputPath)
      const configuredTempDir = options.tempDirectory || (await db.config.getSetting('transcoding_temp_directory'))
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

      const configuredDefaultOutputMode = (await db.config.getSetting('transcoding_default_output_mode')) as 'copy' | 'quarantine-replace' | 'replace' | null
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
      const maximumOutputBytes = params.encoder === 'copy' ? sourceStat.size : await this.resolveMaximumOutputBytes(sourceStat.size, options, db)
      if (maximumOutputBytes !== null) {
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
      }

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

      const outputAnalysis = await getMediaFileAnalyzer().analyzeFile(tempPath)
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
        const converted = options.targetConversion?.audio.find(track => track.sourceIndex === sourceIndex)?.bitrateKbps !== undefined
        const toleranceMs = converted ? 2 * (output.codec === 'aac' ? 1024 : 1536) * 1000 / output.sampleRate! : Math.max(source.timestampPrecisionMs!, output.timestampPrecisionMs!)
        if (Math.abs(source.durationMs - output.durationMs) > toleranceMs) throw new Error(`Audio stream ${sourceIndex} duration changed beyond its timestamp or coded sample precision`)
      }
      if (queuePayload?.targetProfile && evaluatePlaybackTarget(queuePayload.targetProfile, outputAnalysis).overall !== 'compatible') throw new Error('Verified output is incompatible with the approved target')
      controller.signal.throwIfAborted()
      if (await sha256File(inputPath) !== sourceSha256) throw new Error('Source file changed during transcoding')

      // Guard against size inflation for replacement modes: if transcoded result is larger than source, abort replacement
      if ((effectiveOutputMode === 'quarantine-replace' || effectiveOutputMode === 'replace') && stats.size > sourceStat.size) {
        throw new Error(`Transcoded output (${Math.round(stats.size / (1024 * 1024))} MB) is larger than original source (${Math.round(sourceStat.size / (1024 * 1024))} MB). Aborting replacement to protect storage.`)
      }
      await db.mediaRemuxJobs.update(optimizationJobId!, { status: 'verified', actualOutputBytes: stats.size, outputDurationMs: outputAnalysis.duration, outputAnalysis: JSON.stringify(outputAnalysis) })

      const origExt = path.extname(inputPath)
      const origBase = path.basename(inputPath, origExt)
      const targetSamePath = path.join(path.dirname(inputPath), origBase + outputExt)

      if (effectiveOutputMode === 'replace' || effectiveOutputMode === 'quarantine-replace') {
        const quarantinePath = path.join(path.dirname(inputPath), `${origBase}.${effectiveOutputMode === 'replace' ? 'activation' : 'quarantine'}-${Date.now()}${origExt}`)
        const outputStats = { ...outputAnalysis, filePath: targetSamePath }
        activation = { inputPath, tempPath, targetPath: targetSamePath, quarantinePath }
        const journal = { inputPath, tempPath, targetPath: targetSamePath, quarantinePath, outputStats, mode: effectiveOutputMode }
        await this.writeActivationJournal(mediaItemId, { ...journal, phase: 'prepared' })
        await db.mediaRemuxJobs.update(optimizationJobId!, { quarantinePath })
        await fs.rename(inputPath, quarantinePath)
        await this.writeActivationJournal(mediaItemId, { ...journal, phase: 'source_quarantined' })
        if (path.resolve(tempPath) !== path.resolve(targetSamePath)) await fs.rename(tempPath, targetSamePath)
        await this.writeActivationJournal(mediaItemId, { ...journal, phase: 'output_activated' })
        await db.media.updatePathAndStats(mediaItemId, targetSamePath, outputStats)
        activated = true
        this.analysisCache.delete(inputPath)
        this.analysisCache.delete(targetSamePath)
        getStatsCacheService().invalidate()
        if (effectiveOutputMode === 'replace') await fs.unlink(quarantinePath)
        await db.config.deleteSetting(`transcoding.activation.${mediaItemId}`)
      } else {
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
          outputDurationMs: outputAnalysis.duration,
          outputAnalysis: JSON.stringify({ ...outputAnalysis, filePath: effectiveOutputMode === 'copy' ? path.join(path.dirname(inputPath), `${origBase} - Transcoded${outputExt}`) : targetSamePath, encodedReductionBytes: sourceStat.size - stats.size, retainedOriginalBytes, physicallyReclaimedBytes: effectiveOutputMode === 'replace' ? sourceStat.size - stats.size : -stats.size }),
        })
      }

      onProgress?.({ percent: 100, status: 'complete' })
      return true

    } catch (error) {
      if (activation && !activated) {
        try {
          if (existsSync(activation.quarantinePath)) {
            if (existsSync(activation.targetPath) && !existsSync(activation.tempPath)) await fs.rename(activation.targetPath, activation.tempPath)
            await fs.rename(activation.quarantinePath, activation.inputPath)
          }
          await db.config.deleteSetting(`transcoding.activation.${mediaItemId}`)
        } catch (rollbackError) {
          throw new Error(`Activation failed (${getErrorMessage(error)}) and could not restore the original (${getErrorMessage(rollbackError)}); the recorded journal requires recovery`)
        }
      }
      const msg = error instanceof TranscodeError && error.stderr
        ? `${error.message}: ${error.stderr.slice(-4000).trim()}`
        : error instanceof Error ? error.message : String(error)
      getLoggingService().error('[TranscodingService]', `Transcode failed for item ${mediaItemId}:`, msg)
      if (optimizationJobId !== null) await db.mediaRemuxJobs.update(optimizationJobId, { status: 'failed', error: msg })
      
      onProgress?.({ percent: 0, status: 'failed', error: msg })
      if (controller.signal.aborted) return false
      throw error
    } finally {
      this.activeJobs.delete(mediaItemId)
      if (tempPath && !activated && !await db.config.getSetting(`transcoding.activation.${mediaItemId}`)) await fs.rm(tempPath, { force: true })
    }
  }

  private async resolveMaximumOutputBytes(
    sourceSize: number,
    options: TranscodeOptions,
    db: ReturnType<typeof getDatabase>
  ): Promise<number | null> {
    if (options.maxOutputBytes !== undefined) {
      if (!Number.isSafeInteger(options.maxOutputBytes) || options.maxOutputBytes <= 0) {
        throw new Error('Maximum output size must be a positive integer number of bytes.')
      }
      return options.maxOutputBytes
    }
    const rawPolicy = await db.config.getSetting('transcoding.global_min_savings')
    if (!rawPolicy) throw new Error('Global minimum savings policy is not configured.')
    let policy: { kind: 'percent' | 'bytes'; value: number }
    try {
      policy = JSON.parse(rawPolicy) as { kind: 'percent' | 'bytes'; value: number }
    } catch (error) {
      throw new Error(`Global minimum savings policy is invalid: ${error instanceof Error ? error.message : String(error)}`)
    }
    if (!['percent', 'bytes'].includes(policy.kind) || !Number.isFinite(policy.value) || policy.value <= 0) {
      throw new Error('Global minimum savings policy must define a positive percent or byte value.')
    }
    const savings = policy.kind === 'percent' ? Math.floor(sourceSize * policy.value / 100) : Math.floor(policy.value)
    const maximumOutputBytes = sourceSize - savings
    if (maximumOutputBytes <= 0) throw new Error('Global minimum savings policy exceeds the source file size.')
    return maximumOutputBytes
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
    const conversion = options.targetConversion
    if (conversion && (outputAnalysis.video.codec !== options.targetCodec || outputAnalysis.video.width !== conversion.width || outputAnalysis.video.height !== conversion.height || outputAnalysis.video.bitDepth !== conversion.bitDepth || outputAnalysis.video.hdrFormat !== conversion.hdrFormat)) throw new Error('Verified output does not match the approved video conversion')
    const streamPlan = buildStreamSelectionPlan(sourceAnalysis, options)
    for (const [index, sourceIndex] of streamPlan.audioStreamIndexes.entries()) {
      const source = sourceAnalysis.audioTracks.find(track => track.index === sourceIndex)!
      const output = outputAnalysis.audioTracks[index]
      const conversion = options.targetConversion?.audio.find(track => track.sourceIndex === sourceIndex)
      if (output.codec !== (conversion?.codec ?? source.codec) || output.channels !== source.channels || output.language !== source.language || output.title !== source.title || output.hasObjectAudio !== source.hasObjectAudio) throw new Error(`Retained audio stream ${sourceIndex} changed unexpectedly`)
    }
    for (const [index, sourceIndex] of streamPlan.subtitleStreamIndexes.entries()) {
      const source = sourceAnalysis.subtitleTracks.find(track => track.index === sourceIndex)!, output = outputAnalysis.subtitleTracks[index]
      if (output.codec !== source.codec || output.language !== source.language || output.title !== source.title || output.isForced !== source.isForced) throw new Error(`Retained subtitle stream ${sourceIndex} changed unexpectedly`)
    }
  }

  async selectMeasuredParameters(filePath: string, options: TranscodeOptions, sampleDirectory?: string): Promise<Pick<TranscodingParams, 'encoder' | 'crf' | 'preset' | 'measuredCandidate'>> {
    if (!options.targetCodec || !options.qualityProfile || !options.encoderPolicy) throw new Error('Target codec, quality profile, and encoder policy are required for measurement')
    const analysis = this.analysisCache.get(filePath) ?? await getMediaFileAnalyzer().analyzeFile(filePath)
    if (!analysis.success || !analysis.video || !analysis.duration) throw new Error(analysis.error || 'Complete media analysis is required for measurement')
    const capabilities = options.encoderPolicy === 'software' ? undefined : await this.getCapabilities()
    const hardwareVendor = capabilities?.gpus.find(gpu => gpu.id === (options.gpuId || capabilities.selectedGpuId))?.vendor
    const hardwareEncoder = hardwareVendor === 'NVIDIA' ? (options.targetCodec === 'av1' ? 'nvenc_av1' : 'nvenc_h265') : hardwareVendor === 'Intel' ? (options.targetCodec === 'av1' ? 'qsv_av1' : 'qsv_h265') : undefined
    if (hardwareEncoder && !capabilities!.verifiedEncoders.includes(hardwareEncoder)) throw new Error(`Encoder ${hardwareEncoder} is not verified`)
    const ladder = buildCandidateLadder(options.targetCodec, options.encoderPolicy, hardwareEncoder)
    const candidates = ladder.map(candidate => {
      const useGpu = candidate.encoder !== 'x265' && candidate.encoder !== 'svt_av1'
      const candidateOptions = { ...options, useGpu, gpuId: useGpu ? options.gpuId : undefined, encoder: candidate.encoder, crf: candidate.quality, preset: candidate.preset }
      return { ...candidate, outputBytes: 0, vmafMean: 0, vmafP5: 0, cambiMean: 0, ffmpegArgs: TranscodeCommandFactory.getBuilder(hardwareVendor, candidateOptions).buildFFmpegArgs('<input>', '<output>', candidateOptions, analysis) }
    })
    const outputDirectory = sampleDirectory ?? path.join(app.getPath('userData'), 'transcoding-samples', randomUUID())
    try {
      const stat = await fs.stat(filePath)
      await fs.mkdir(outputDirectory, { recursive: true })
      const space = await fs.statfs(outputDirectory)
      const sampleSeconds = Math.min(analysis.duration / 1000, APP_CONFIG.transcoding.sampleDurationSeconds * APP_CONFIG.transcoding.samplePositions.length)
      const plannedBitrate = options.targetConversion ? options.targetConversion.maximumVideoBitrate + options.targetConversion.audio.reduce((sum, track) => sum + (track.bitrateKbps ?? analysis.audioTracks.find(audio => audio.index === track.sourceIndex)?.bitrate ?? 0) * 1000, 0) : undefined
      const referenceBytes = options.targetConversion?.inputArgs.length ? options.targetConversion.width * options.targetConversion.height * (options.targetConversion.bitDepth > 8 ? 3 : 1.5) * analysis.video.frameRate! * sampleSeconds : 0
      const requiredBytes = Math.ceil((plannedBitrate ? plannedBitrate / 8 * sampleSeconds : options.maxOutputBytes ?? stat.size) * candidates.length + referenceBytes + (options.targetConversion?.maximumVideoBitrate ?? 0) / 4)
      if (Number(space.bavail) * Number(space.bsize) < requiredBytes) throw new Error('Insufficient disk headroom for episode sampling')
      const measured = await this.measuredOptimizationService.measure({ inputPath: filePath, outputDirectory, durationMs: analysis.duration, outputExtension: options.targetConversion?.container === 'mp4' ? '.mp4' : '.mkv', referenceFilter: options.targetConversion?.videoFilter, referenceInputArgs: options.targetConversion?.inputArgs, candidates })
      const selected = selectMeasuredCandidate(options.qualityProfile, measured.candidates)
      for (const candidate of measured.candidates) if (candidate !== selected) for (const sample of candidate.samplePaths!) await fs.unlink(sample)
      return { encoder: selected.encoder, crf: selected.quality, preset: selected.preset, measuredCandidate: selected }
    } catch (error) {
      await fs.rm(outputDirectory, { recursive: true, force: true })
      throw error
    }
  }

  async discardTaskSamples(task: QueuedTask): Promise<void> {
    const payload = (task.options as TranscodeOptions & { queuePayload?: QueuedTranscodePayload } | undefined)?.queuePayload
    if (payload?.samplePaths) for (const sample of payload.samplePaths) await fs.rm(sample, { force: true })
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
    const raw = await getDatabase().config.getSetting(`transcoding.preflight.${preflightId}`)
    if (raw) {
      const preflight = JSON.parse(raw) as { result: ShowTranscodePreflight }
      for (const episode of preflight.result.episodes) if (episode.samplePaths) for (const sample of episode.samplePaths) await fs.rm(sample, { force: true })
    }
    const root = path.resolve(app.getPath('userData'), 'transcoding-samples')
    const directory = path.resolve(root, preflightId)
    if (path.dirname(directory) !== root) throw new Error('Invalid preflight sample directory')
    await fs.rm(directory, { recursive: true, force: true })
    this.showPreflights.delete(preflightId)
    await getDatabase().config.deleteSetting(`transcoding.preflight.${preflightId}`)
  }

  private preflightFingerprint(result: ShowTranscodePreflight): string {
    return createHash('sha256').update(JSON.stringify(result.episodes)).digest('hex')
  }

  async approveShowTranscode(preflightId: string): Promise<ShowTranscodePreflight> {
    let preflight = this.showPreflights.get(preflightId)
    if (!preflight) {
      const saved = await getDatabase().config.getSetting(`transcoding.preflight.${preflightId}`)
      if (saved) preflight = JSON.parse(saved) as { request: ShowTranscodeRequest; result: ShowTranscodePreflight }
    }
    if (!preflight) throw new Error('Show transcode preflight was not found or has expired')
    if (Date.now() > Date.parse(preflight.result.expiresAt)) {
      await this.discardShowPreflight(preflightId)
      throw new Error('Show transcode preflight has expired; run preflight again')
    }
    const approved = { ...preflight.result, userApproved: true, approvedAt: new Date().toISOString(), approvalFingerprint: this.preflightFingerprint(preflight.result) }
    this.showPreflights.set(preflightId, { ...preflight, result: approved })
    await getDatabase().config.setSetting(`transcoding.preflight.${preflightId}`, JSON.stringify({ ...preflight, result: approved }))
    return approved
  }

  async listShowQuarantine(seriesTitle: string, sourceId: string, seriesIdentityKey: string, libraryId: string): Promise<QuarantinedShowFile[]> {
    const episodes = await getDatabase().tvShows.getEpisodes(seriesTitle, sourceId, seriesIdentityKey, libraryId)
    const files: QuarantinedShowFile[] = []
    const jobs = await getDatabase().mediaRemuxJobs.getQuarantines(episodes.map(episode => episode.id!))
    const ownedPaths = new Set(jobs.map(job => path.resolve(job.quarantinePath!)))
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
        if (!entry.isFile() || !entry.name.startsWith(`${base}.quarantine-`) || !/\.quarantine-\d+\.[^.]+$/.test(entry.name)) continue
        const quarantinePath = path.join(directory, entry.name)
        const stat = await fs.stat(quarantinePath)
        files.push({ mediaItemId: episode.id, label: `${seriesTitle} S${String(episode.season_number || 0).padStart(2, '0')}E${String(episode.episode_number || 0).padStart(2, '0')} ${episode.title}`, path: quarantinePath, size: stat.size, modifiedAt: new Date(stat.mtimeMs).toISOString(), owned: ownedPaths.has(path.resolve(quarantinePath)) })
      }
    }
    return files
  }

  async purgeShowQuarantine(seriesTitle: string, sourceId: string, seriesIdentityKey: string, libraryId: string): Promise<{ purged: number }> {
    const files = await this.listShowQuarantine(seriesTitle, sourceId, seriesIdentityKey, libraryId)
    const journals = await getDatabase().config.getSettingsByPrefix('transcoding.activation.')
    const journalPaths = new Set(Object.values(journals).flatMap(value => {
      const journal = JSON.parse(value) as { quarantinePath?: string }
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
