
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

export interface SampleWindow {
  startSeconds: number
  durationSeconds: number
}

export function buildMeasuredCandidateArgs(template: string[], inputPath: string, outputPath: string, window: SampleWindow): string[] {
  const args = template.map(arg => arg === '<input>' ? PathUtils.sanitizeAbsolutePath(inputPath) : arg === '<output>' ? outputPath : arg)
  for (let index = args.length - 1; index > 0; index--) {
    if (args[index] === '0:t?' && args[index - 1] === '-map') args.splice(index - 1, 2)
  }
  const inputIndex = args.indexOf('-i')
  args.splice(inputIndex, 0, '-ss', String(window.startSeconds))
  const trim = `trim=duration=${window.durationSeconds},setpts=PTS-STARTPTS`
  const filterIndex = args.indexOf('-vf')
  if (filterIndex >= 0) args[filterIndex + 1] = `${trim},${args[filterIndex + 1]}`
  else args.splice(args.length - 1, 0, '-vf', trim)
  args.splice(args.length - 1, 0, '-an', '-sn', '-dn', '-t', String(window.durationSeconds), '-enc_time_base:v:0', 'demux')
  return args
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
    source: SampleTimingEvidence & { durationSeconds: number }
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

  private async inspectWindow(
    binary: string,
    filePath: string,
    window: SampleWindow,
    signal?: AbortSignal,
    videoFilter?: string,
    inputArgs: string[] = [],
  ): Promise<SampleTimingEvidence & { durationSeconds: number }> {
    const filter = `trim=duration=${window.durationSeconds},setpts=PTS-STARTPTS,${videoFilter ? `${videoFilter},` : ''}showinfo`
    const output = await this.processRunner.run(binary, [
      '-hide_banner', '-nostats', '-v', 'info', ...inputArgs,
      '-ss', String(window.startSeconds), '-i', PathUtils.sanitizeAbsolutePath(filePath),
      '-map', '0:v:0', '-vf', filter, '-fps_mode', 'passthrough',
      '-t', String(window.durationSeconds), '-an', '-sn', '-dn', '-f', 'null', '-',
    ], signal)
    const lines = output.split(/\r?\n/).filter(line => /showinfo/.test(line) && /n:\s*\d+\s+pts:/.test(line))
    const timestamps = lines.map(line => Number(line.match(/\bpts_time:\s*([^\s]+)/)?.[1]))
    if (timestamps.length < 2 || timestamps.some((timestamp, index) => !Number.isFinite(timestamp) || index > 0 && timestamp <= timestamps[index - 1])) {
      throw new Error(`Direct-source sample has incomplete or non-monotonic frame timestamps: ${filePath}`)
    }
    const first = lines[0]
    const color = output.split(/\r?\n/).find(line => /showinfo/.test(line) && /color_range:/.test(line)) ?? ''
    const size = first.match(/\bs:\s*(\d+)x(\d+)/)
    const lastDuration = Number(lines[lines.length - 1].match(/\bduration_time:\s*([^\s]+)/)?.[1])
    const frameDuration = Number.isFinite(lastDuration) && lastDuration > 0
      ? lastDuration
      : timestamps[timestamps.length - 1] - timestamps[timestamps.length - 2]
    const metadata = (key: string): string | undefined => {
      const value = (first + ' ' + color).match(new RegExp(`\\b${key}:\\s*([^\\s]+)`))?.[1]
      return value && value !== 'unknown' ? value : undefined
    }
    return {
      frames: timestamps.length,
      durationSeconds: timestamps[timestamps.length - 1] - timestamps[0] + frameDuration,
      timestamps: timestamps.map(value => value - timestamps[0]),
      timestampPrecisionSeconds: 1 / 1000000,
      width: size ? Number(size[1]) : undefined,
      height: size ? Number(size[2]) : undefined,
      pixelFormat: metadata('fmt'),
      colorRange: metadata('color_range'),
      colorSpace: metadata('color_space'),
      colorPrimaries: metadata('color_primaries'),
      colorTransfer: metadata('color_trc'),
    }
  }

  private async measureFrameMetrics(
    binary: string,
    distortedPath: string,
    referencePath: string,
    logPath: string,
    expectedFrames: number,
    window: SampleWindow,
    signal?: AbortSignal,
    frameLimit?: number,
    distortedStartSeconds?: number,
    referenceFilter?: string,
    referenceInputArgs: string[] = [],
  ): Promise<{ vmafScores: number[]; cambiScores: number[] }> {
    const escapedPath = logPath.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "'\\\\''")
    const prefix = `trim=duration=${window.durationSeconds},setpts=PTS-STARTPTS,`
    const limit = frameLimit === undefined ? '' : `trim=end_frame=${frameLimit},`
    const graph = `[0:v]${prefix}${limit}settb=AVTB,setpts=N[d];[1:v]${prefix}${referenceFilter ? `${referenceFilter},` : ''}${limit}settb=AVTB,setpts=N[r];[d][r]libvmaf=model=version=${VMAF_MODEL_VERSION}:shortest=1:repeatlast=0:feature=name=cambi:log_fmt=json:log_path='${escapedPath}'`
    await this.processRunner.run(binary, [
      '-v', 'error',
      ...(distortedStartSeconds === undefined ? [] : ['-ss', String(distortedStartSeconds)]),
      '-i', PathUtils.sanitizeAbsolutePath(distortedPath),
      ...referenceInputArgs,
      '-ss', String(window.startSeconds), '-i', PathUtils.sanitizeAbsolutePath(referencePath),
      '-filter_complex', graph, '-fps_mode', 'passthrough', '-an', '-sn', '-f', 'null', '-',
    ], signal)
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
        const window = { startSeconds: start, durationSeconds: length }
        await request.onProgress?.(`Checking output quality window ${index + 1} of ${starts.length}`)
        const sourceSample = await this.inspectWindow(binary, request.sourcePath, window, request.signal, request.referenceFilter, request.referenceInputArgs)
        const outputSample = await this.inspectWindow(binary, request.outputPath, window, request.signal)
        try {
          verifySampleFrameAlignment(sourceSample, outputSample)
        } catch (error) {
          getLoggingService().error('[MeasuredOptimization]', 'Output quality sample alignment failed', {
            sampleIndex: index, window, source: sampleTimingSummary(sourceSample),
            output: sampleTimingSummary(outputSample), reason: getErrorMessage(error),
          })
          throw error
        }
        const logPath = path.join(request.outputDirectory, `verify-output-${index}.json`)
        ownedPaths.push(logPath)
        const metrics = await this.measureFrameMetrics(binary, request.outputPath, request.sourcePath, logPath, sourceSample.frames, window, request.signal, undefined, start, request.referenceFilter, request.referenceInputArgs)
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
    const sourceSamples: Awaited<ReturnType<MeasuredOptimizationService['inspectWindow']>>[] = []
    const referenceSamples: Awaited<ReturnType<MeasuredOptimizationService['inspectWindow']>>[] = []
    const sourceSelfVmafs: number[] = []
    const sourceCambiMeans: number[] = []
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
          sourceSamples.push(sample.source)
          referenceSamples.push(sample.reference)
          sourceSelfVmafs.push(sample.sourceSelfVmaf)
          sourceCambiMeans.push(sample.sourceCambiMean)
        }
      } else for (const [index, start] of starts.entries()) {
        const window = { startSeconds: start, durationSeconds: length }
        await request.onProgress?.(`Inspecting source frames ${index + 1} of ${starts.length}`)
        const source = await this.inspectWindow(binary, request.inputPath, window, request.signal)
        const reference = request.referenceFilter
          ? await this.inspectWindow(binary, request.inputPath, window, request.signal, request.referenceFilter, request.referenceInputArgs)
          : source
        if (reference.frames !== source.frames) throw new Error('Reference transform changed the source frame count')
        sourceSamples.push(source)
        referenceSamples.push(reference)
        const sourceControlLogPath = path.join(request.outputDirectory, `source-${index}-self-control.json`)
        ownedPaths.add(sourceControlLogPath)
        const control = await this.measureFrameMetrics(binary, request.inputPath, request.inputPath, sourceControlLogPath, source.frames, window, request.signal, undefined, start)
        sourceSelfVmafs.push(control.vmafScores.reduce((sum, score) => sum + score, 0) / control.vmafScores.length)
        sourceCambiMeans.push(control.cambiScores.reduce((sum, score) => sum + score, 0) / control.cambiScores.length)
        await fs.unlink(sourceControlLogPath)
      }
      if (request.sourcePreparation) {
        request.sourcePreparation.samples = sourceSamples.map((source, index) => ({
          source,
          reference: referenceSamples[index],
          sourceSelfVmaf: sourceSelfVmafs[index],
          sourceCambiMean: sourceCambiMeans[index],
        }))
        if (!reusedSources) await request.onSourcePrepared?.(request.sourcePreparation)
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
            const args = buildMeasuredCandidateArgs(candidate.ffmpegArgs, request.inputPath, outputPath, { startSeconds: starts[index], durationSeconds: length })
            if (candidate.encoder.startsWith('qsv')) args.unshift('-v', 'verbose')
            const encodingStartedAt = performance.now()
            const diagnostics = await this.processRunner.run(binary, args, request.signal)
            const encodingDurationMs = performance.now() - encodingStartedAt
            getLoggingService().info('[MeasuredOptimization]', `stage=encoding encoder=${candidate.encoder} preset=${candidate.preset} quality=${candidate.quality} sample=${index} durationMs=${Math.round(encodingDurationMs)}`)
            if (candidate.encoder.startsWith('qsv')) verifyQsvQualityMode(diagnostics, candidate.quality)
            const outputSample = await this.inspectWindow(binary, outputPath, { startSeconds: 0, durationSeconds: length }, request.signal)
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
              const screening = await this.measureFrameMetrics(binary, outputPath, request.inputPath, screeningLogPath, screeningFrames, { startSeconds: starts[index], durationSeconds: length }, request.signal, screeningFrames, undefined, request.referenceFilter, request.referenceInputArgs)
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
            const { vmafScores, cambiScores } = metrics ?? await this.measureFrameMetrics(binary, outputPath, request.inputPath, logPath, referenceSamples[index].frames, { startSeconds: starts[index], durationSeconds: length }, request.signal, undefined, undefined, request.referenceFilter, request.referenceInputArgs)
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
