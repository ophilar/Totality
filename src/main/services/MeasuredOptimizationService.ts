
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { getMediaFileAnalyzer } from './MediaFileAnalyzer'
import { PathUtils } from './utils/PathUtils'
import { APP_CONFIG } from '@main/config'
import { getImpossibleQualityReason, VMAF_LOW_PERCENTILE, type MeasuredCandidate, type MeasuredCandidateSample, type OptimizationQualityProfile } from './MeasuredOptimizationPolicy'
import { getErrorMessage } from './utils/errorUtils'
import { requireFfmpegFilters } from './transcoding/FfmpegFilterCapabilities'
import { getLoggingService } from './LoggingService'

export interface MeasurementProcessRunner {
  run(binary: string, args: string[], signal?: AbortSignal): Promise<string>
}

export class ChildProcessMeasurementRunner implements MeasurementProcessRunner {
  run(binary: string, args: string[], signal?: AbortSignal): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = spawn(PathUtils.resolveExecutablePath(binary), args, { stdio: ['ignore', 'pipe', 'pipe'], signal, killSignal: 'SIGKILL', timeout: 30 * 60 * 1000 })
      let output = '', error = ''
      child.stdout.on('data', data => { output += data.toString() })
      child.stderr.on('data', data => { error += data.toString() })
      let processError: Error | undefined
      child.once('error', error => { processError = error })
      child.once('close', code => processError ? reject(processError) : code === 0 ? resolve(output + error) : reject(new Error(error || `FFmpeg exited with code ${code}`)))
    })
  }
}

export interface MeasuredSampleRequest {
  inputPath: string
  outputDirectory: string
  durationMs: number
  outputExtension?: string
  referenceFilter?: string
  referenceInputArgs?: string[]
  sourcePreparation?: MeasurementSourcePreparation
  onSourcePrepared?: (preparation: MeasurementSourcePreparation) => Promise<void>
  qualityProfile?: OptimizationQualityProfile
  signal?: AbortSignal
  onProgress?: (phase: string) => Promise<void> | void
  validateSample?: (filePath: string) => Promise<string[]>
  previouslyMeasuredSamples?: MeasuredCandidateSample[]
  onSampleMeasured?: (sample: MeasuredCandidateSample) => Promise<void>
  onCandidateMeasured?: (candidates: MeasuredCandidate[], complete: boolean) => Promise<void>
  candidates: Array<MeasuredCandidate & { ffmpegArgs: string[] }>
}
export interface MeasuredSampleResult { candidates: MeasuredCandidate[]; vmafAvailable: boolean; cambiAvailable: boolean }

export interface OutputQualityVerificationRequest {
  sourcePath: string
  outputPath: string
  outputDirectory: string
  durationMs: number
  qualityProfile: OptimizationQualityProfile
  referenceFilter?: string
  referenceInputArgs?: string[]
  signal?: AbortSignal
  onProgress?: (phase: string) => Promise<void> | void
}

export interface OutputQualityVerificationResult {
  vmafMean: number
  vmafP5: number
  cambiMean: number
  sampleCount: number
  frameCount: number
}

export const VMAF_MODEL_VERSION = 'vmaf_v0.6.1'

/**
 * Accurate input seeking decodes and discards preroll before encoding the sample.
 * Unlike -c copy, lossless FFV1 materialization has exact decoded video boundaries.
 * Retain non-video streams only for preflight, where the candidate's executable
 * stream mapping and playback validation need them.
 */
export function buildLosslessSampleArgs(
  inputPath: string,
  outputPath: string,
  startSeconds: number,
  durationSeconds: number,
  retainOtherStreams = false,
): string[] {
  if (!Number.isFinite(startSeconds) || startSeconds < 0 || !Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    throw new Error('A lossless sample requires a valid start time and positive duration')
  }
  return [
    '-y', '-v', 'error', '-ss', String(startSeconds), '-i', PathUtils.sanitizeAbsolutePath(inputPath),
    '-t', String(durationSeconds),
    '-map', retainOtherStreams ? '0' : '0:v:0',
    ...(retainOtherStreams ? ['-c', 'copy'] : ['-an', '-sn', '-dn']),
    '-c:v:0', 'ffv1', '-vf:v:0', 'setpts=PTS-STARTPTS',
    '-fps_mode:v:0', 'passthrough', '-enc_time_base:v:0', 'filter',
    outputPath,
  ]
}

export interface SampleTimingEvidence {
  frames: number
  timestamps: number[]
  timestampPrecisionSeconds: number
  width?: number
  height?: number
  pixelFormat?: string
  colorRange?: string
  colorSpace?: string
  colorTransfer?: string
  colorPrimaries?: string
}

export interface MeasurementSourcePreparation {
  samples: Array<{
    sourcePath: string
    source: SampleTimingEvidence & { durationSeconds: number }
    referencePath?: string
    reference: SampleTimingEvidence & { durationSeconds: number }
    sourceSelfVmaf: number
    sourceCambiMean: number
  }>
}

export function verifyQsvQualityMode(diagnostics: string, expectedQuality: number): void {
  const rateControl = diagnostics.match(/RateControlMethod:\s*(\w+)/)?.[1]
  if (rateControl !== 'ICQ' && rateControl !== 'LA_ICQ') {
    throw new Error(`QSV initialized ${rateControl ?? 'an unknown rate-control mode'} instead of the configured quality mode`)
  }
  const actualQuality = Number(diagnostics.match(/ICQQuality:\s*(\d+)/)?.[1])
  if (actualQuality !== expectedQuality) {
    throw new Error(`QSV initialized quality ${Number.isFinite(actualQuality) ? actualQuality : 'unknown'} instead of ${expectedQuality}`)
  }
}

function normalizeSamplePixelFormat(pixelFormat: string | undefined): string | undefined {
  if (!pixelFormat) return undefined
  const planar = pixelFormat.match(/^(yuvj?(?:420|422|444)p)(\d*)(?:le|be)?$/)
  if (planar) return `${planar[1]}${planar[2] || '8'}`
  const semiplanar = pixelFormat.match(/^p(0?10|0?12|0?16)(?:le|be)$/)
  if (semiplanar) return `yuv420p${Number(semiplanar[1])}`
  if (pixelFormat === 'nv12') return 'yuv420p8'
  return pixelFormat
}

export function verifySampleFrameAlignment(source: SampleTimingEvidence, output: SampleTimingEvidence): void {
  if (output.frames !== source.frames) throw new Error(`Encoded sample frame count differs from its source (${output.frames} != ${source.frames})`)
  const timestampTolerance = source.timestampPrecisionSeconds + output.timestampPrecisionSeconds
  const mismatchedTimestamp = output.timestamps.findIndex((timestamp, frame) => Math.abs(timestamp - source.timestamps[frame]) > timestampTolerance)
  if (mismatchedTimestamp !== -1) throw new Error(`Encoded sample frame timing differs from its source (frame ${mismatchedTimestamp}, ${output.timestamps[mismatchedTimestamp]} != ${source.timestamps[mismatchedTimestamp]}; tolerance ${timestampTolerance}s)`)
  for (const property of ['width', 'height', 'pixelFormat', 'colorRange', 'colorSpace', 'colorTransfer', 'colorPrimaries'] as const) {
    const expected = property === 'pixelFormat' ? normalizeSamplePixelFormat(source[property]) : source[property]
    const actual = property === 'pixelFormat' ? normalizeSamplePixelFormat(output[property]) : output[property]
    if (expected !== undefined && expected !== actual) throw new Error(`Encoded sample ${property} differs from its transformed reference (${actual ?? 'unknown'} != ${expected})`)
  }
}

function sampleTimingSummary(sample: SampleTimingEvidence): object {
  return {
    frames: sample.frames,
    timestampPrecisionSeconds: sample.timestampPrecisionSeconds,
    firstTimestamps: sample.timestamps.slice(0, 5),
    lastTimestamps: sample.timestamps.slice(-5),
    width: sample.width,
    height: sample.height,
    pixelFormat: sample.pixelFormat,
    colorRange: sample.colorRange,
    colorSpace: sample.colorSpace,
    colorTransfer: sample.colorTransfer,
    colorPrimaries: sample.colorPrimaries,
  }
}

export class MeasuredOptimizationService {
  private static readonly PROBE_CACHE_TTL_MS = 10 * 60 * 1000
  private static readonly MAX_PROBED_BINARIES = 8
  private readonly filterListings = new Map<string, { value: Promise<string>; expiresAt: number }>()
  private readonly measurementFingerprints = new Map<string, { value: Promise<string>; expiresAt: number }>()

  constructor(private readonly processRunner: MeasurementProcessRunner = new ChildProcessMeasurementRunner()) {}

  private rememberProbe(
    cache: Map<string, { value: Promise<string>; expiresAt: number }>,
    binary: string,
    value: Promise<string>,
  ): Promise<string> {
    cache.delete(binary)
    cache.set(binary, { value, expiresAt: Date.now() + MeasuredOptimizationService.PROBE_CACHE_TTL_MS })
    while (cache.size > MeasuredOptimizationService.MAX_PROBED_BINARIES) cache.delete(cache.keys().next().value!)
    return value
  }

  private getFilterListing(binary: string): Promise<string> {
    const cached = this.filterListings.get(binary)
    if (cached && cached.expiresAt > Date.now()) return cached.value
    const listing = this.processRunner.run(binary, ['-hide_banner', '-filters']).catch(error => {
      if (this.filterListings.get(binary)?.value === listing) this.filterListings.delete(binary)
      throw error
    })
    return this.rememberProbe(this.filterListings, binary, listing)
  }

  getMeasurementFingerprint(): Promise<string> {
    const binary = getMediaFileAnalyzer().getFFmpegPath()
    if (!binary) throw new Error('FFmpeg is unavailable for measured optimization')
    const cached = this.measurementFingerprints.get(binary)
    if (cached && cached.expiresAt > Date.now()) return cached.value

    const fingerprint = Promise.all([
      this.processRunner.run(binary, ['-version']),
      this.processRunner.run(binary, ['-hide_banner', '-h', 'filter=libvmaf']),
    ]).then(([version, filterHelp]) => createHash('sha256').update(JSON.stringify({ version, filterHelp, model: VMAF_MODEL_VERSION })).digest('hex')).catch(error => {
      if (this.measurementFingerprints.get(binary)?.value === fingerprint) this.measurementFingerprints.delete(binary)
      throw error
    })
    return this.rememberProbe(this.measurementFingerprints, binary, fingerprint)
  }

  private async inspectSample(filePath: string, signal?: AbortSignal): Promise<SampleTimingEvidence & { durationSeconds: number }> {
    const binary = getMediaFileAnalyzer().getFFprobePath()!
    const output = await this.processRunner.run(binary, ['-v', 'error', '-select_streams', 'v:0', '-show_frames', '-show_entries', 'frame=best_effort_timestamp_time,duration_time:stream=time_base,width,height,pix_fmt,color_range,color_space,color_transfer,color_primaries', '-of', 'json', filePath], signal)
    const { frames, streams } = JSON.parse(output) as {
      frames: Array<{ best_effort_timestamp_time: string; duration_time: string }>
      streams: Array<{ time_base: string; width?: number; height?: number; pix_fmt?: string; color_range?: string; color_space?: string; color_transfer?: string; color_primaries?: string }>
    }
    const timestamps = frames.map(frame => Number(frame.best_effort_timestamp_time))
    const durationSeconds = timestamps[timestamps.length - 1] + Number(frames[frames.length - 1]?.duration_time) - timestamps[0]
    if (!frames.length || !Number.isFinite(durationSeconds) || durationSeconds <= 0 || timestamps.some((timestamp, index) => !Number.isFinite(timestamp) || index > 0 && timestamp <= timestamps[index - 1])) {
      throw new Error(`Sample has incomplete or non-monotonic video timestamps: ${filePath}`)
    }
    const [numerator, denominator] = streams[0].time_base.split('/').map(Number)
    const timestampPrecisionSeconds = numerator / denominator
    if (!Number.isFinite(timestampPrecisionSeconds) || timestampPrecisionSeconds <= 0) throw new Error(`Sample has no valid video time base: ${filePath}`)
    return {
      frames: frames.length,
      durationSeconds,
      timestamps: timestamps.map(timestamp => timestamp - timestamps[0]),
      timestampPrecisionSeconds,
      width: streams[0].width,
      height: streams[0].height,
      pixelFormat: streams[0].pix_fmt,
      colorRange: streams[0].color_range,
      colorSpace: streams[0].color_space,
      colorTransfer: streams[0].color_transfer,
      colorPrimaries: streams[0].color_primaries,
    }
  }

  private async measureFrameMetrics(
    binary: string,
    distortedPath: string,
    referencePath: string,
    logPath: string,
    expectedFrames: number,
    signal?: AbortSignal,
    frameLimit?: number,
  ): Promise<{ vmafScores: number[]; cambiScores: number[] }> {
    const escapedPath = logPath.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "'\\\\''")
    const trim = frameLimit === undefined ? '' : `trim=end_frame=${frameLimit},`
    const graph = `[0:v]${trim}settb=AVTB,setpts=N[d];[1:v]${trim}settb=AVTB,setpts=N[r];[d][r]libvmaf=model=version=${VMAF_MODEL_VERSION}:shortest=1:repeatlast=0:feature=name=cambi:log_fmt=json:log_path='${escapedPath}'`
    await this.processRunner.run(binary, ['-v', 'error', '-i', distortedPath, '-i', referencePath, '-filter_complex', graph, '-fps_mode', 'passthrough', '-an', '-sn', '-f', 'null', '-'], signal)
    const log = JSON.parse(await fs.readFile(logPath, 'utf8')) as { pooled_metrics: { vmaf: { mean: number }; cambi: { mean: number } }; frames: Array<{ metrics: { vmaf: number; cambi: number } }> }
    if (!Number.isFinite(log.pooled_metrics.vmaf.mean) || !Number.isFinite(log.pooled_metrics.cambi.mean)) throw new Error('VMAF/CAMBI measurements are incomplete')
    if (log.frames.length !== expectedFrames) throw new Error(`VMAF scored ${log.frames.length} of ${expectedFrames} source frames`)
    const vmafScores = log.frames.map(frame => frame.metrics.vmaf)
    const cambiScores = log.frames.map(frame => frame.metrics.cambi)
    if ([...vmafScores, ...cambiScores].some(score => !Number.isFinite(score))) throw new Error('Measured frame scores are incomplete')
    return { vmafScores, cambiScores }
  }

  async verifyOutputQuality(request: OutputQualityVerificationRequest): Promise<OutputQualityVerificationResult> {
    const analyzer = getMediaFileAnalyzer()
    if (!await analyzer.isFFmpegAvailable()) throw new Error('FFmpeg is unavailable for output quality verification')
    const binary = analyzer.getFFmpegPath()!
    const durationSeconds = request.durationMs / 1000
    const length = Math.min(APP_CONFIG.transcoding.sampleDurationSeconds, durationSeconds / APP_CONFIG.transcoding.samplePositions.length)
    const starts = APP_CONFIG.transcoding.samplePositions.map(position => Math.max(0, Math.min(durationSeconds - length, durationSeconds * position - length / 2)))
    const ownedPaths: string[] = []
    let failure: unknown
    let result: OutputQualityVerificationResult | undefined
    try {
      await fs.mkdir(request.outputDirectory, { recursive: true })
      const vmafScores: number[] = []
      const cambiScores: number[] = []
      for (const [index, start] of starts.entries()) {
        request.signal?.throwIfAborted()
        await request.onProgress?.(`Preparing output verification sample ${index + 1} of ${starts.length}`)
        const sourceSamplePath = path.join(request.outputDirectory, `verify-source-${index}.mkv`)
        const outputSamplePath = path.join(request.outputDirectory, `verify-output-${index}.mkv`)
        ownedPaths.push(sourceSamplePath, outputSamplePath)
        await this.processRunner.run(binary, buildLosslessSampleArgs(request.sourcePath, sourceSamplePath, start, length), request.signal)
        await this.processRunner.run(binary, buildLosslessSampleArgs(request.outputPath, outputSamplePath, start, length), request.signal)
        const sourceSample = await this.inspectSample(sourceSamplePath, request.signal)
        const referencePath = sourceSamplePath
        if (request.referenceFilter) {
          const transformedPath = path.join(request.outputDirectory, `verify-reference-${index}.mkv`)
          ownedPaths.push(transformedPath)
          await this.processRunner.run(binary, ['-y', '-v', 'error', ...(request.referenceInputArgs ?? []), '-i', sourceSamplePath, '-vf', request.referenceFilter, '-fps_mode', 'passthrough', '-an', '-sn', '-c:v', 'ffv1', transformedPath], request.signal)
          Object.assign(sourceSample, await this.inspectSample(transformedPath, request.signal))
        }
        const referenceFile = request.referenceFilter ? path.join(request.outputDirectory, `verify-reference-${index}.mkv`) : referencePath
        const outputSample = await this.inspectSample(outputSamplePath, request.signal)
        try {
          verifySampleFrameAlignment(sourceSample, outputSample)
        } catch (error) {
          getLoggingService().error('[MeasuredOptimization]', 'Output quality sample alignment failed', {
            sampleIndex: index, startSeconds: start, durationSeconds: length,
            source: sampleTimingSummary(sourceSample), output: sampleTimingSummary(outputSample),
            reason: getErrorMessage(error),
          })
          throw error
        }
        await request.onProgress?.(`Scoring output verification sample ${index + 1} of ${starts.length}`)
        const logPath = path.join(request.outputDirectory, `verify-output-${index}.json`)
        ownedPaths.push(logPath)
        const metrics = await this.measureFrameMetrics(binary, outputSamplePath, referenceFile, logPath, sourceSample.frames, request.signal)
        vmafScores.push(...metrics.vmafScores)
        cambiScores.push(...metrics.cambiScores)
      }
      const failure = getImpossibleQualityReason(request.qualityProfile, vmafScores, cambiScores, vmafScores.length)
      if (failure) throw new Error(`Converted output failed ${request.qualityProfile} quality verification: ${failure}`)
      const sortedVmafScores = [...vmafScores].sort((left, right) => left - right)
      result = {
        vmafMean: vmafScores.reduce((sum, score) => sum + score, 0) / vmafScores.length,
        vmafP5: sortedVmafScores[Math.floor(sortedVmafScores.length * VMAF_LOW_PERCENTILE)],
        cambiMean: cambiScores.reduce((sum, score) => sum + score, 0) / cambiScores.length,
        sampleCount: starts.length,
        frameCount: vmafScores.length,
      }
    } catch (error) {
      failure = error
    }
    const cleanup = await Promise.allSettled(ownedPaths.map(filePath => fs.rm(filePath, { force: true })))
    const cleanupFailures = cleanup.filter((item): item is PromiseRejectedResult => item.status === 'rejected').map(item => getErrorMessage(item.reason))
    const cleanupFailure = cleanupFailures.length ? new Error(`Output quality verification artifact cleanup failed: ${cleanupFailures.join('; ')}`) : undefined
    if (failure !== undefined && cleanupFailure) throw new Error(`${getErrorMessage(failure)}; ${cleanupFailure.message}`)
    if (failure !== undefined) throw failure
    if (cleanupFailure) throw cleanupFailure
    if (!result) throw new Error('Output quality verification completed without a result')
    return result
  }

  async measure(request: MeasuredSampleRequest): Promise<MeasuredSampleResult> {
    const analyzer = getMediaFileAnalyzer()
    if (!await analyzer.isFFmpegAvailable()) throw new Error('FFmpeg is unavailable for measured optimization')
    const binary = analyzer.getFFmpegPath()!
    if (!request.candidates.length) throw new Error('At least one measured encoder candidate is required')
    const durationSeconds = request.durationMs / 1000
    const filterListing = await this.getFilterListing(binary)
    const requiredFilters = ['libvmaf', ...(request.referenceFilter?.includes('libplacebo') ? ['libplacebo'] : [])]
    requireFfmpegFilters(filterListing, requiredFilters)
    request.signal?.throwIfAborted()
    const length = Math.min(APP_CONFIG.transcoding.sampleDurationSeconds, durationSeconds / APP_CONFIG.transcoding.samplePositions.length)
    const starts = APP_CONFIG.transcoding.samplePositions.map(position => Math.max(0, Math.min(durationSeconds - length, durationSeconds * position - length / 2)))
    await fs.mkdir(request.outputDirectory, { recursive: true })
    const sourceSamplePaths: string[] = []
    const sourceSamples: Awaited<ReturnType<MeasuredOptimizationService['inspectSample']>>[] = []
    const referenceSamples: Awaited<ReturnType<MeasuredOptimizationService['inspectSample']>>[] = []
    const sourceSelfVmafs: number[] = []
    const sourceCambiMeans: number[] = []
    const referencePaths: string[] = []
    const ownedPaths = new Set<string>()
    const retainedPaths = new Set<string>()
    let failure: unknown
    let result: MeasuredSampleResult | undefined
    let cleanupFailure: Error | undefined
    try {
      const preparationStartedAt = performance.now()
      const reusedSources = Boolean(request.sourcePreparation?.samples.length)
      if (request.sourcePreparation?.samples.length) {
        for (const sample of request.sourcePreparation.samples) {
          sourceSamplePaths.push(sample.sourcePath)
          sourceSamples.push(sample.source)
          referenceSamples.push(sample.reference)
          sourceSelfVmafs.push(sample.sourceSelfVmaf)
          sourceCambiMeans.push(sample.sourceCambiMean)
          if (sample.referencePath) referencePaths.push(sample.referencePath)
        }
      } else for (const [index, start] of starts.entries()) {
        await request.onProgress?.(`Preparing source sample ${index + 1} of ${starts.length}`)
        const sourceSamplePath = path.join(request.outputDirectory, `source-${index}.mkv`)
        ownedPaths.add(sourceSamplePath)
        await this.processRunner.run(binary, buildLosslessSampleArgs(request.inputPath, sourceSamplePath, start, length, true), request.signal)
        sourceSamplePaths.push(sourceSamplePath)
        sourceSamples.push(await this.inspectSample(sourceSamplePath, request.signal))
        referenceSamples.push(sourceSamples[index])
        const sourceControlLogPath = path.join(request.outputDirectory, `source-${index}-self-control.json`)
        ownedPaths.add(sourceControlLogPath)
        await request.onProgress?.(`Checking source reference sample ${index + 1} of ${starts.length}`)
        const sourceControl = await this.measureFrameMetrics(binary, sourceSamplePath, sourceSamplePath, sourceControlLogPath, sourceSamples[index].frames, request.signal)
        const sourceSelfVmaf = sourceControl.vmafScores.reduce((sum, score) => sum + score, 0) / sourceControl.vmafScores.length
        sourceSelfVmafs.push(sourceSelfVmaf)
        sourceCambiMeans.push(sourceControl.cambiScores.reduce((sum, score) => sum + score, 0) / sourceControl.cambiScores.length)
        await fs.unlink(sourceControlLogPath)
        // Materialize target color transforms separately so the candidate encoder
        // and its reference receive the same source frames with the transform applied once.
        if (request.referenceFilter) {
          const referencePath = path.join(request.outputDirectory, `reference-${index}.mkv`)
          ownedPaths.add(referencePath)
          await this.processRunner.run(binary, ['-y', '-v', 'error', ...(request.referenceInputArgs ?? []), '-i', sourceSamplePath, '-vf', request.referenceFilter, '-fps_mode', 'passthrough', '-an', '-sn', '-c:v', 'ffv1', referencePath], request.signal)
          referencePaths.push(referencePath)
          const referenceSample = await this.inspectSample(referencePath, request.signal)
          if (referenceSample.frames !== sourceSamples[index].frames) throw new Error('Reference transform changed the source frame count')
          referenceSamples[index] = referenceSample
        }
      }
      if (request.sourcePreparation) {
        request.sourcePreparation.samples = sourceSamples.map((source, index) => ({ sourcePath: sourceSamplePaths[index], source, referencePath: referencePaths[index], reference: referenceSamples[index], sourceSelfVmaf: sourceSelfVmafs[index], sourceCambiMean: sourceCambiMeans[index] }))
        if (!reusedSources) await request.onSourcePrepared?.(request.sourcePreparation)
        for (const sourcePath of [...sourceSamplePaths, ...referencePaths]) retainedPaths.add(sourcePath)
      }
      getLoggingService().info('[MeasuredOptimization]', `stage=source-preparation directory=${request.outputDirectory} reused=${reusedSources} samples=${sourceSamples.length} durationMs=${Math.round(performance.now() - preparationStartedAt)}`)
      const measured: MeasuredCandidate[] = []
      const measuredSamples = [...(request.previouslyMeasuredSamples ?? [])]
      for (const candidate of request.candidates) {
        const candidateSamples: MeasuredCandidateSample[] = []
        const playbackBlockers = new Set<string>()
        let qualityRejectedReason: string | undefined
        for (const index of starts.keys()) {
          request.signal?.throwIfAborted()
          const outputPath = path.join(request.outputDirectory, `${candidate.encoder}-${candidate.quality}-${candidate.preset}-${index}${request.outputExtension ?? '.mkv'}`)
          let sample = measuredSamples.find(saved => saved.encoder === candidate.encoder && saved.preset === candidate.preset && saved.quality === candidate.quality && saved.sampleIndex === index)
          if (!sample) {
            await request.onProgress?.(`Encoding sample ${index + 1} of ${starts.length} with ${candidate.encoder} (${candidate.quality})`)
            ownedPaths.add(outputPath)
            const args = candidate.ffmpegArgs.map(arg => arg === '<input>' ? sourceSamplePaths[index] : arg === '<output>' ? outputPath : arg)
            if (candidate.encoder.startsWith('qsv')) args.unshift('-v', 'verbose')
            const encodingStartedAt = performance.now()
            const diagnostics = await this.processRunner.run(binary, args, request.signal)
            const encodingDurationMs = performance.now() - encodingStartedAt
            getLoggingService().info('[MeasuredOptimization]', `stage=encoding encoder=${candidate.encoder} preset=${candidate.preset} quality=${candidate.quality} sample=${index} durationMs=${Math.round(encodingDurationMs)}`)
            if (candidate.encoder.startsWith('qsv')) verifyQsvQualityMode(diagnostics, candidate.quality)
            const outputSample = await this.inspectSample(outputPath, request.signal)
            try {
              verifySampleFrameAlignment(referenceSamples[index], outputSample)
            } catch (error) {
              getLoggingService().error('[MeasuredOptimization]', 'Encoded candidate sample alignment failed', {
                encoder: candidate.encoder, preset: candidate.preset, quality: candidate.quality,
                sampleIndex: index, startSeconds: starts[index], durationSeconds: length,
                reference: sampleTimingSummary(referenceSamples[index]), output: sampleTimingSummary(outputSample),
                ffmpegArgs: args, reason: getErrorMessage(error),
              })
              throw error
            }
            const referencePath = referencePaths[index] ?? sourceSamplePaths[index]
            const logPath = path.join(request.outputDirectory, `${candidate.encoder}-${candidate.quality}-${candidate.preset}-${index}.json`)
            ownedPaths.add(logPath)
            const totalFrames = referenceSamples.reduce((sum, sample) => sum + sample.frames, 0)
            const screeningFrames = Math.min(referenceSamples[index].frames, Math.floor(totalFrames * VMAF_LOW_PERCENTILE) + 1)
            let screeningOnly = false
            let metrics: { vmafScores: number[]; cambiScores: number[] } | undefined
            if (request.qualityProfile && screeningFrames < referenceSamples[index].frames) {
              await request.onProgress?.(`Screening sample ${index + 1} of ${starts.length} for impossible quality`)
              const screeningLogPath = path.join(request.outputDirectory, `${candidate.encoder}-${candidate.quality}-${candidate.preset}-${index}.screening.json`)
              ownedPaths.add(screeningLogPath)
              const screeningStartedAt = performance.now()
              const screening = await this.measureFrameMetrics(binary, outputPath, referencePath, screeningLogPath, screeningFrames, request.signal, screeningFrames)
              const reason = getImpossibleQualityReason(request.qualityProfile, [...candidateSamples.flatMap(sample => sample.vmafScores), ...screening.vmafScores], [...candidateSamples.flatMap(sample => sample.cambiScores), ...screening.cambiScores], totalFrames)
              getLoggingService().info('[MeasuredOptimization]', `stage=preliminary-scoring encoder=${candidate.encoder} quality=${candidate.quality} sample=${index} frames=${screeningFrames} durationMs=${Math.round(performance.now() - screeningStartedAt)} rejected=${Boolean(reason)}`)
              await fs.unlink(screeningLogPath)
              if (reason) {
                metrics = screening
                screeningOnly = true
              }
            }
            if (!screeningOnly) await request.onProgress?.(`Scoring sample ${index + 1} of ${starts.length} with VMAF and CAMBI`)
            const scoringStartedAt = performance.now()
            const { vmafScores, cambiScores } = metrics ?? await this.measureFrameMetrics(binary, outputPath, referencePath, logPath, referenceSamples[index].frames, request.signal)
            getLoggingService().info('[MeasuredOptimization]', `stage=scoring encoder=${candidate.encoder} preset=${candidate.preset} quality=${candidate.quality} sample=${index} durationMs=${Math.round(performance.now() - scoringStartedAt)}`)
            sample = {
              encoder: candidate.encoder,
              preset: candidate.preset,
              quality: candidate.quality,
              sampleIndex: index,
              outputBytes: (await fs.stat(outputPath)).size,
              sampledDurationSeconds: sourceSamples[index].durationSeconds,
              encodingDurationMs,
              vmafScores,
              cambiScores,
              sourceSelfVmaf: sourceSelfVmafs[index],
              sourceCambiMean: sourceCambiMeans[index],
              samplePath: outputPath,
              screeningOnly,
            }
            measuredSamples.push(sample)
            await request.onSampleMeasured?.(structuredClone(sample))
            if (request.onSampleMeasured) retainedPaths.add(outputPath)
            if (!screeningOnly) await fs.unlink(logPath)
          }
          candidateSamples.push(sample)
          qualityRejectedReason = request.qualityProfile ? getImpossibleQualityReason(request.qualityProfile, candidateSamples.flatMap(sample => sample.vmafScores), candidateSamples.flatMap(sample => sample.cambiScores), referenceSamples.reduce((sum, sample) => sum + sample.frames, 0)) : undefined
          if (!qualityRejectedReason) {
            const validationStartedAt = performance.now()
            for (const blocker of await request.validateSample?.(sample.samplePath) ?? []) playbackBlockers.add(blocker)
            getLoggingService().info('[MeasuredOptimization]', `stage=playback-validation encoder=${candidate.encoder} preset=${candidate.preset} quality=${candidate.quality} sample=${index} durationMs=${Math.round(performance.now() - validationStartedAt)}`)
          }
          if (playbackBlockers.size || qualityRejectedReason) {
            getLoggingService().info('[MeasuredOptimization]', `stage=candidate-rejected encoder=${candidate.encoder} preset=${candidate.preset} quality=${candidate.quality} measuredSamples=${candidateSamples.length}/${starts.length} reason=${qualityRejectedReason ?? [...playbackBlockers].join('; ')}`)
            break
          }
        }
        const scores = candidateSamples.flatMap(sample => sample.vmafScores)
        const banding = candidateSamples.flatMap(sample => sample.cambiScores)
        if (!scores.length || scores.some(score => !Number.isFinite(score)) || banding.some(score => !Number.isFinite(score))) throw new Error('Measured frame scores are incomplete')
        scores.sort((a, b) => a - b)
        measured.push({ incompleteMeasurement: candidateSamples.reduce((sum, sample) => sum + sample.vmafScores.length, 0) < referenceSamples.reduce((sum, sample) => sum + sample.frames, 0), qualityRejectedReason, encoder: candidate.encoder, quality: candidate.quality, preset: candidate.preset, outputBytes: candidateSamples.reduce((sum, sample) => sum + sample.outputBytes, 0), sampledDurationSeconds: candidateSamples.reduce((sum, sample) => sum + sample.sampledDurationSeconds, 0), encodingDurationMs: candidateSamples.reduce((sum, sample) => sum + sample.encodingDurationMs, 0), vmafMean: scores.reduce((a, b) => a + b, 0) / scores.length, vmafP5: scores[Math.floor(scores.length * VMAF_LOW_PERCENTILE)], cambiMean: banding.reduce((a, b) => a + b, 0) / banding.length, sourceSelfVmaf: candidateSamples.reduce((sum, sample) => sum + sample.sourceSelfVmaf, 0) / candidateSamples.length, sourceCambiMean: candidateSamples.reduce((sum, sample) => sum + sample.sourceCambiMean, 0) / candidateSamples.length, samplePaths: candidateSamples.map(sample => sample.samplePath), playbackBlockers: [...playbackBlockers] })
        await request.onCandidateMeasured?.(structuredClone(measured), measured.length === request.candidates.length)
        if (request.onCandidateMeasured) for (const sample of candidateSamples) retainedPaths.add(sample.samplePath)
      }
      if (!request.onCandidateMeasured) for (const candidate of measured) for (const samplePath of candidate.samplePaths ?? []) retainedPaths.add(samplePath)
      result = { candidates: measured, vmafAvailable: true, cambiAvailable: true }
    } catch (error) {
      failure = error
    } finally {
      const cleanup = await Promise.allSettled([...ownedPaths].filter(filePath => !retainedPaths.has(filePath)).map(filePath => fs.rm(filePath, { force: true })))
      const errors = cleanup.filter((result): result is PromiseRejectedResult => result.status === 'rejected').map(result => result.reason)
      if (errors.length) cleanupFailure = new Error(`Measured optimization artifact cleanup failed: ${errors.map(getErrorMessage).join('; ')}`)
    }
    if (failure !== undefined && cleanupFailure) throw new Error(`Measured optimization failed: ${getErrorMessage(failure)}; ${cleanupFailure.message}`)
    if (failure !== undefined) throw failure
    if (cleanupFailure) throw cleanupFailure
    if (!result) throw new Error('Measured optimization completed without a result')
    return result
  }
}
