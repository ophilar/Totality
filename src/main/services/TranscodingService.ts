import { spawn } from 'child_process'
import * as fs from 'fs/promises'
import { existsSync } from 'fs'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import * as path from 'path'
import { getDatabase } from '@main/database/BetterSQLiteService'
import { getLoggingService } from '@main/services/LoggingService'
import { getMediaFileAnalyzer } from '@main/services/MediaFileAnalyzer'
import { PathUtils } from '@main/services/utils/PathUtils'
import { GpuDetector } from '@main/services/utils/GpuDetector'
import { TranscodeCommandFactory } from './transcoding/TranscodeCommandFactory'
import { validateHdrTranscode } from './transcoding/HdrTranscodingPolicy'
import { buildTranscodingCapabilities, resolveSelectedGpuId, TranscodingCapabilities } from './TranscodingCapabilities'
import type { FileAnalysisResult } from './MediaFileAnalyzer'
import type { StreamSelectionPolicy } from './transcoding/StreamSelectionPlan'
import { buildStreamSelectionPlan } from './transcoding/StreamSelectionPlan'
import { MediaPathAuthorization } from './MediaPathAuthorization'
import { TaskType, MediaItem } from '@main/types/database'
import { getQualityAnalyzer } from './QualityAnalyzer'
import type { MediaSourceTier } from './transcoding/TrashSourceClassifier'
import { StreamRemuxCommandBuilder } from './transcoding/StreamRemuxCommandBuilder'
import { buildCandidateLadder, selectMeasuredCandidate, type OptimizationQualityProfile } from './MeasuredOptimizationPolicy'
import { MeasuredOptimizationService } from './MeasuredOptimizationService'
import { getErrorMessage } from '@main/services/utils/errorUtils'

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
    measuredParameters?: Pick<TranscodingParams, 'encoder' | 'crf' | 'preset'>
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
    if (mediaItemId && this.activeJobs.has(mediaItemId)) {
      const controller = this.activeJobs.get(mediaItemId)
      controller?.abort()
      this.activeJobs.delete(mediaItemId)
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
        const analyzer = getMediaFileAnalyzer()
        const analysis = await analyzer.analyzeFile(episode.file_path)
        if (!analysis.success || !analysis.video) {
          throw new Error(`Fresh media analysis failed for "${label}": ${analysis.error || 'Unknown analysis error'}`)
        }
        analysis.streamBytes = await analyzer.measureStreamBytes(episode.file_path)
        buildStreamSelectionPlan(analysis, request.options)
        const measuredParameters = request.options.optimizationMode === 'transcode' && request.options.qualityProfile && request.options.encoderPolicy
          ? await this.selectMeasuredParameters(episode.file_path, request.options)
          : undefined
        const advice = getQualityAnalyzer().getOptimizationAdvice(episode, analysis)
        return {
          mediaItemId: episode.id,
          label,
          compatible: true,
          hdrFormat: analysis.video.hdrFormat || 'SDR',
          sourceSize: stat.size,
          sourceMtimeMs: stat.mtimeMs,
          recommendedAction: advice.action,
          decisionStatus: advice.decisionStatus,
          evidenceStatus: advice.evidence_status,
          confidence: advice.confidence,
          estimatedSavingsBytes: advice.estimatedSavingsBytes,
          savingsBasis: advice.savings_basis,
          sourceTier: advice.sourceTier,
          adviceReason: advice.reason,
          measuredParameters
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
      await getDatabase().config.deleteSetting(`transcoding.preflight.${preflightId}`)
      this.showPreflights.delete(preflightId)
      throw new Error('Show transcode preflight has expired; run preflight again')
    }
    const { getTaskQueueService } = await import('./TaskQueueService')
    const queueableEpisodes = preflight.result.episodes.filter(episode =>
      episode.compatible && (episode.decisionStatus === 'actionable' || (episode.decisionStatus === 'sample_required' && preflight?.result.userApproved === true)) && episode.recommendedAction !== 'already_optimized'
    )
    if (queueableEpisodes.length === 0) {
      throw new Error('No episodes have sufficient evidence for a safe optimization action.')
    }
    const tasks = queueableEpisodes.map(episode => ({
      type: TaskType.Transcode,
      label: episode.label,
      mediaItemId: episode.mediaItemId,
      batchId: preflight.result.batchId,
      options: { ...preflight.request.options, ...episode.measuredParameters, queuePayload: { batchId: preflight.result.batchId, preflightId, expiresAt: preflight.result.expiresAt, sourceSize: episode.sourceSize, sourceMtimeMs: episode.sourceMtimeMs } }
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
        outputStats?: { fileSize?: number; duration?: number; video?: any; audioTracks?: any[] }
      }
      if (!journal.mediaItemId || !journal.phase || !journal.inputPath) throw new Error(`Invalid transcoding activation journal: ${key}`)
      const exists = async (filePath: string | undefined): Promise<boolean> => {
        if (!filePath) return false
        try { await fs.access(filePath); return true } catch { return false }
      }
      const inputExists = await exists(journal.inputPath)
      const targetExists = await exists(journal.targetPath)
      const quarantineExists = await exists(journal.quarantinePath)
      const tempExists = await exists(journal.tempPath)

      // Crash occurred after source was quarantined but before target was placed
      if (journal.phase === 'source_quarantined' && !targetExists && quarantineExists && !inputExists) {
        await fs.rename(journal.quarantinePath!, journal.inputPath)
        await db.config.deleteSetting(key)
        getLoggingService().info('[TranscodingService]', `Rollback completed for media item ${journal.mediaItemId} from quarantine`)
        continue
      }

      // Crash occurred after target file was successfully placed/activated
      if ((journal.phase === 'output_activated' || journal.phase === 'source_quarantined') && targetExists && journal.targetPath) {
        // Ensure database points to the newly activated target path
        const currentItem = await db.media.getItemById(journal.mediaItemId)
        if (currentItem && currentItem.file_path !== journal.targetPath) {
          const stats = journal.outputStats || (await (async () => {
            const analysis = await getMediaFileAnalyzer().analyzeFile(journal.targetPath!)
            return {
              fileSize: analysis.fileSize,
              duration: analysis.duration,
              video: analysis.video,
              audioTracks: analysis.audioTracks
            }
          })())
          await db.media.updatePathAndStats(journal.mediaItemId, journal.targetPath, stats)
        }
        await db.config.deleteSetting(key)
        getLoggingService().info('[TranscodingService]', `Committed forward activation recovery for media item ${journal.mediaItemId}`)
        continue
      }

      // Crash in prepared phase where neither source was quarantined nor target placed
      if (journal.phase === 'prepared' && inputExists && !targetExists) {
        await db.config.deleteSetting(key)
        getLoggingService().info('[TranscodingService]', `Discarded prepared activation journal for media item ${journal.mediaItemId}`)
        continue
      }

      // Direct replacement can activate the target before the second journal write.
      // If the staged output is gone and the target's size matches the recorded output,
      // commit the same forward transition used by output_activated.
      if (journal.phase === 'prepared' && targetExists && !tempExists && journal.targetPath && journal.outputStats?.fileSize != null) {
        const targetStat = await fs.stat(journal.targetPath)
        if (targetStat.size === journal.outputStats.fileSize) {
          await db.media.updatePathAndStats(journal.mediaItemId, journal.targetPath, journal.outputStats)
          await db.config.deleteSetting(key)
          getLoggingService().info('[TranscodingService]', `Committed interrupted direct activation for media item ${journal.mediaItemId}`)
          continue
        }
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
    const ffmpegAvailable = await analyzer.isAvailable()

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
      const encoderProbe = await this.probeFfmpegEncoders()
      if (encoderProbe.failures.length > 0) {
        getLoggingService().error('[TranscodingService]', `FFmpeg encoder verification failed: ${encoderProbe.failures.join('; ')}`)
      }
      const capabilities = buildTranscodingCapabilities(availability, gpus, selectedGpuId, encoderProbe.encoders, encoderProbe.failures)
      getLoggingService().info('[TranscodingService]', `Hardware snapshot captured at ${capabilities.detectedAt}: ${gpus.length} GPU(s), encoders=${capabilities.encoders.join(',') || 'none'}`)
      return capabilities
    })()
    return this.capabilitiesPromise
  }

  private async probeFfmpegEncoders(): Promise<{ encoders: string[]; failures: string[] }> {
    const ffmpegPath = getMediaFileAnalyzer().getFFmpegPath()
    if (!ffmpegPath) return { encoders: [], failures: ['FFmpeg path is unavailable'] }
    return new Promise(resolve => {
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
        const originalLanguage = itemToAnalyze.original_language
        if (!originalLanguage) {
          throw new Error('Smart stream pruning requires verified original-language metadata')
        }
        effectiveOptions.optimizationMode = 'remux_only'
        effectiveOptions.streamSelection = {
          audio: 'original-and-protected',
          originalLanguage,
          subtitle: 'all',
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

    validateHdrTranscode(analysis)
    const targetCodec = effectiveOptions.targetCodec
    if (!targetCodec) throw new Error('Target video codec must be explicitly selected.')
    if (!effectiveOptions.qualityProfile) throw new Error('Quality profile must be explicitly selected.')
    if (!effectiveOptions.encoderPolicy) throw new Error('Encoder policy must be explicitly selected.')
    if (effectiveOptions.encoderPolicy === 'compare') throw new Error('Compare policy requires measured candidates before a transcode can be submitted.')
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
      
    const allowedPresets = ['ultrafast', 'superfast', 'veryfast', 'faster', 'fast', 'medium', 'slow', 'slower', 'veryslow', 'placebo', 'hq', 'hp', 'bd', 'll', 'llhq', 'llhp', 'lossless', 'p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'quality']
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
          ffmpegArgs.push(cleaned)
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

    let tempPath: string
    let optimizationJobId: number | null = null

    try {
      onProgress?.({ percent: 0, status: 'initializing' })
      
      const inputPath = PathUtils.sanitizeAbsolutePath(item.file_path)
      const sourceStat = await fs.stat(inputPath)
      const sourceSha256 = await sha256File(inputPath)
      const queuePayload = (options as TranscodeOptions & { queuePayload?: QueuedTranscodePayload }).queuePayload
      if (queuePayload && (sourceStat.size !== queuePayload.sourceSize || Math.abs(sourceStat.mtimeMs - queuePayload.sourceMtimeMs) > 1000)) {
        throw new Error('Source file changed after show preflight')
      }
      const params = await this.getTranscodeParameters(inputPath, options)
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
      
      const outputExt = '.mkv' // We prefer MKV for flexibility
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
      if (params.encoder !== 'copy') {
        const maximumOutputBytes = await this.resolveMaximumOutputBytes(sourceStat.size, options, db)
        if (maximumOutputBytes !== null) {
          const available = await fs.statfs(tempBaseDir)
          const availableBytes = Number(available.bavail) * Number(available.bsize)
          if (availableBytes < maximumOutputBytes) {
            throw new Error(`Insufficient free space for the configured output ceiling: ${maximumOutputBytes} bytes required, ${availableBytes} bytes available.`)
          }
          options = { ...options, maxOutputBytes: maximumOutputBytes }
        }
      }

      getLoggingService().info('[TranscodingService]', `Starting FFmpeg transcode: ${inputPath} -> ${tempPath}`)
      const success = await this.runFFmpeg(inputPath, tempPath, params, options, (p) => {
          onProgress?.({ 
            percent: p.percent, 
            fps: p.fps, 
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
      const expectedAudioCount = params.expectedAudioCount !== undefined ? params.expectedAudioCount : params.audioTracks?.length
      const expectedSubtitleCount = params.expectedSubtitleCount !== undefined ? params.expectedSubtitleCount : params.subtitleTracks?.length
      if (expectedAudioCount !== undefined && outputAnalysis.audioTracks.length !== expectedAudioCount) {
        throw new Error(`Transcoded output verification failed: expected ${expectedAudioCount} audio streams, found ${outputAnalysis.audioTracks.length}`)
      }
      if (expectedSubtitleCount !== undefined && outputAnalysis.subtitleTracks.length !== expectedSubtitleCount) {
        throw new Error(`Transcoded output verification failed: expected ${expectedSubtitleCount} subtitle streams, found ${outputAnalysis.subtitleTracks.length}`)
      }
      if (params.sourceHdrFormat?.toLowerCase() === 'hdr10' && outputAnalysis.video.hdrFormat?.toLowerCase() !== 'hdr10') {
        throw new Error('Transcoded output verification failed: HDR10 metadata was not preserved')
      }

      // Guard against size inflation for replacement modes: if transcoded result is larger than source, abort replacement
      if ((effectiveOutputMode === 'quarantine-replace' || effectiveOutputMode === 'replace') && stats.size > sourceStat.size) {
        throw new Error(`Transcoded output (${Math.round(stats.size / (1024 * 1024))} MB) is larger than original source (${Math.round(sourceStat.size / (1024 * 1024))} MB). Aborting replacement to protect storage.`)
      }

      const origExt = path.extname(inputPath)
      const origBase = path.basename(inputPath, origExt)
      const targetSamePath = path.join(path.dirname(inputPath), origBase + outputExt)

      if (effectiveOutputMode === 'replace') {
        getLoggingService().info('[TranscodingService]', `Replacing original file through reversible activation: ${inputPath}`)
        const quarantinePath = path.join(path.dirname(inputPath), `${origBase}.activation-${Date.now()}${origExt}`)
        const outputStats = {
          fileSize: outputAnalysis.fileSize,
          duration: outputAnalysis.duration,
          video: outputAnalysis.video,
          audioTracks: outputAnalysis.audioTracks,
        }
        await this.writeActivationJournal(mediaItemId, { phase: 'prepared', inputPath, tempPath, targetPath: targetSamePath, quarantinePath, outputStats, mode: 'replace' })
        await fs.rename(inputPath, quarantinePath)
        await this.writeActivationJournal(mediaItemId, { phase: 'source_quarantined', inputPath, tempPath, targetPath: targetSamePath, quarantinePath, outputStats, mode: 'replace' })
        try {
          if (path.resolve(tempPath) !== path.resolve(targetSamePath)) await fs.rename(tempPath, targetSamePath)
        } catch (error) {
          await fs.rename(quarantinePath, inputPath)
          throw error
        }
        await this.writeActivationJournal(mediaItemId, { phase: 'output_activated', inputPath, targetPath: targetSamePath, quarantinePath, outputStats, mode: 'replace' })
        await db.media.updatePathAndStats(mediaItemId, targetSamePath, outputStats)
        try {
          await fs.unlink(quarantinePath)
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
        }
        await db.config.deleteSetting(`transcoding.activation.${mediaItemId}`)
      } else if (effectiveOutputMode === 'quarantine-replace') {
        getLoggingService().info('[TranscodingService]', `Replacing with quarantine backup: ${inputPath}`)
        const quarantinePath = path.join(path.dirname(inputPath), `${origBase}.quarantine-${Date.now()}${origExt}`)
        const outputStats = {
          fileSize: outputAnalysis.fileSize,
          duration: outputAnalysis.duration,
          video: outputAnalysis.video,
          audioTracks: outputAnalysis.audioTracks,
        }
        await this.writeActivationJournal(mediaItemId, { phase: 'prepared', inputPath, tempPath, targetPath: targetSamePath, quarantinePath, outputStats })
        await fs.rename(inputPath, quarantinePath)
        await this.writeActivationJournal(mediaItemId, { phase: 'source_quarantined', inputPath, tempPath, targetPath: targetSamePath, quarantinePath, outputStats })
        try {
          if (path.resolve(tempPath) !== path.resolve(targetSamePath)) await fs.rename(tempPath, targetSamePath)
        } catch (error) {
          await fs.rename(quarantinePath, inputPath)
          throw error
        }
        await this.writeActivationJournal(mediaItemId, { phase: 'output_activated', inputPath, targetPath: targetSamePath, quarantinePath, outputStats })
        await db.media.updatePathAndStats(mediaItemId, targetSamePath, outputStats)
        await db.config.deleteSetting(`transcoding.activation.${mediaItemId}`)
      } else {
        // Sibling copy
        const copyPath = path.join(path.dirname(inputPath), `${origBase} - Transcoded${outputExt}`)
        getLoggingService().info('[TranscodingService]', `Saving transcoded sibling copy: ${copyPath}`)
        if (path.resolve(tempPath) !== path.resolve(copyPath)) {
          await fs.copyFile(tempPath, copyPath)
          await fs.unlink(tempPath)
        }
      }

      if (optimizationJobId !== null) {
        await db.mediaRemuxJobs.update(optimizationJobId, {
          status: 'promoted',
          actualOutputBytes: stats.size,
          bytesSaved: sourceStat.size - stats.size,
          outputDurationMs: outputAnalysis.duration,
          outputAnalysis: JSON.stringify(outputAnalysis),
        })
      }

      onProgress?.({ percent: 100, status: 'complete' })
      return true

    } catch (error) {
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

  async selectMeasuredParameters(filePath: string, options: TranscodeOptions): Promise<Pick<TranscodingParams, 'encoder' | 'crf' | 'preset'>> {
    if (!options.targetCodec || !options.qualityProfile || !options.encoderPolicy) throw new Error('Target codec, quality profile, and encoder policy are required for measurement')
    const analysis = await getMediaFileAnalyzer().analyzeFile(filePath)
    if (!analysis.success || !analysis.video) throw new Error(analysis.error || 'Fresh media analysis failed')
    const capabilities = options.encoderPolicy === 'software' ? undefined : await this.getCapabilities()
    const hardwareEncoder = capabilities?.selectedGpuId ? (options.targetCodec === 'av1' ? 'nvenc_av1' : 'nvenc_h265') : undefined
    const hardwareVendor = capabilities?.gpus.find(gpu => gpu.id === capabilities.selectedGpuId)?.vendor
    const ladder = buildCandidateLadder(options.targetCodec, options.encoderPolicy, hardwareEncoder)
    const candidates = ladder.map(candidate => {
      const candidateOptions = { ...options, encoder: candidate.encoder, crf: candidate.quality, preset: candidate.preset }
      const builder = TranscodeCommandFactory.getBuilder(hardwareVendor, candidateOptions)
      return { ...candidate, outputBytes: 0, vmafMean: 0, vmafP5: 0, cambiMean: 0, ffmpegArgs: builder.buildFFmpegArgs('<input>', '<output>', candidateOptions, analysis) }
    })
    const fileHash = createHash('sha256').update(filePath).digest('hex').slice(0, 12)
    const outputDirectory = path.join(path.dirname(filePath), `.totality-measurements-${fileHash}`)
    try {
      const measured = await this.measuredOptimizationService.measure({ inputPath: filePath, outputDirectory, candidates })
      const selected = selectMeasuredCandidate(options.qualityProfile as OptimizationQualityProfile, measured.candidates)
      return { encoder: selected.encoder, crf: selected.quality, preset: selected.preset }
    } finally {
      await fs.rm(outputDirectory, { recursive: true, force: true }).catch(() => {})
    }
  }

  async approveShowTranscode(preflightId: string): Promise<ShowTranscodePreflight> {
    let preflight = this.showPreflights.get(preflightId)
    if (!preflight) {
      const saved = await getDatabase().config.getSetting(`transcoding.preflight.${preflightId}`)
      if (saved) preflight = JSON.parse(saved) as { request: ShowTranscodeRequest; result: ShowTranscodePreflight }
    }
    if (!preflight) throw new Error('Show transcode preflight was not found or has expired')
    if (Date.now() > Date.parse(preflight.result.expiresAt)) throw new Error('Show transcode preflight has expired; run preflight again')
    const approved = { ...preflight.result, userApproved: true, approvedAt: new Date().toISOString() }
    this.showPreflights.set(preflightId, { ...preflight, result: approved })
    await getDatabase().config.setSetting(`transcoding.preflight.${preflightId}`, JSON.stringify({ ...preflight, result: approved }))
    return approved
  }

  async listShowQuarantine(seriesTitle: string, sourceId: string, libraryId?: string): Promise<QuarantinedShowFile[]> {
    const episodes = await getDatabase().tvShows.getEpisodes(seriesTitle, sourceId, undefined, libraryId)
    const files: QuarantinedShowFile[] = []
    for (const episode of episodes) {
      if (!episode.id || !episode.file_path) continue
      const extension = path.extname(episode.file_path)
      const base = path.basename(episode.file_path, extension)
      const directory = path.dirname(episode.file_path)
      for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
        if (!entry.isFile() || !entry.name.startsWith(`${base}.quarantine-`) || !entry.name.endsWith(extension)) continue
        const quarantinePath = path.join(directory, entry.name)
        const stat = await fs.stat(quarantinePath)
        files.push({ mediaItemId: episode.id, label: `${seriesTitle} S${String(episode.season_number || 0).padStart(2, '0')}E${String(episode.episode_number || 0).padStart(2, '0')} ${episode.title}`, path: quarantinePath, size: stat.size, modifiedAt: new Date(stat.mtimeMs).toISOString() })
      }
    }
    return files
  }

  async purgeShowQuarantine(seriesTitle: string, sourceId: string, libraryId?: string): Promise<{ purged: number }> {
    const files = await this.listShowQuarantine(seriesTitle, sourceId, libraryId)
    const journals = await getDatabase().config.getSettingsByPrefix('transcoding.activation.')
    const journalPaths = new Set(Object.values(journals).flatMap(value => {
      const journal = JSON.parse(value) as { quarantinePath?: string }
      return journal.quarantinePath ? [journal.quarantinePath] : []
    }))
    for (const file of files) {
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

      const args = params.ffmpegArgs && params.ffmpegArgs.length > 0
        ? params.ffmpegArgs.map(arg => {
          if (arg === '<input>') return inputPath
          if (arg === '<output>') return outputPath
          return arg
        })
        : TranscodeCommandFactory.getBuilder(undefined, options).buildFFmpegArgs(inputPath, outputPath, options, {} as FileAnalysisResult)

      getLoggingService().info('[TranscodingService]', `Starting FFmpeg transcode: ${ffmpegPath} ${args.join(' ')}`)

      const proc = spawn(actualPath, args)
      let stderrBuffer = ''
      let outputLimitExceeded = false
      const outputLimitMonitor = options.maxOutputBytes === undefined ? undefined : setInterval(() => {
        if (!existsSync(outputPath)) return
        void fs.stat(outputPath).then(stats => {
          if (stats.size > options.maxOutputBytes! && !outputLimitExceeded) {
            outputLimitExceeded = true
            proc.kill('SIGKILL')
          }
        }).catch(error => getLoggingService().error('[TranscodingService]', 'Failed to inspect transcoding output size:', error))
      }, 1000)

      if (signal) {
        signal.addEventListener('abort', () => {
          if (process.platform === 'win32' && proc.pid) {
            spawn('taskkill', ['/pid', proc.pid.toString(), '/f', '/t'])
          } else {
            proc.kill('SIGKILL')
          }
        })
      }

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
          const speedStr = speed > 0 ? `${speed.toFixed(1)}x` : (fps > 0 ? `${(fps / 24).toFixed(1)}x` : '1.0x')
          
          let eta = 'calculating...'
          const effectiveSpeed = speed > 0 ? speed : (fps > 0 ? fps / 24 : 0)
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
