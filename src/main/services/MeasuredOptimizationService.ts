
import { spawn } from 'node:child_process'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { getMediaFileAnalyzer } from './MediaFileAnalyzer'
import { PathUtils } from './utils/PathUtils'
import { APP_CONFIG } from '@main/config'
import type { MeasuredCandidate } from './MeasuredOptimizationPolicy'
import { getErrorMessage } from './utils/errorUtils'
import { requireFfmpegFilters } from './transcoding/FfmpegFilterCapabilities'

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
  signal?: AbortSignal
  onProgress?: (phase: string) => Promise<void> | void
  validateSample?: (filePath: string) => Promise<string[]>
  onCandidateMeasured?: (candidates: MeasuredCandidate[], complete: boolean) => Promise<void>
  candidates: Array<MeasuredCandidate & { ffmpegArgs: string[] }>
}
export interface MeasuredSampleResult { candidates: MeasuredCandidate[]; vmafAvailable: boolean; cambiAvailable: boolean }

export class MeasuredOptimizationService {
  private readonly filterListings = new Map<string, Promise<string>>()

  constructor(private readonly processRunner: MeasurementProcessRunner = new ChildProcessMeasurementRunner()) {}

  private getFilterListing(binary: string): Promise<string> {
    const cached = this.filterListings.get(binary)
    if (cached) return cached

    const listing = this.processRunner.run(binary, ['-hide_banner', '-filters']).catch(error => {
      this.filterListings.delete(binary)
      throw error
    })
    this.filterListings.set(binary, listing)
    return listing
  }

  private async inspectSample(filePath: string, signal?: AbortSignal): Promise<{ frames: number; durationSeconds: number; timestamps: number[]; timestampPrecisionSeconds: number }> {
    const binary = getMediaFileAnalyzer().getFFprobePath()!
    const output = await this.processRunner.run(binary, ['-v', 'error', '-select_streams', 'v:0', '-show_frames', '-show_entries', 'frame=best_effort_timestamp_time,duration_time:stream=time_base', '-of', 'json', filePath], signal)
    const { frames, streams } = JSON.parse(output) as { frames: Array<{ best_effort_timestamp_time: string; duration_time: string }>; streams: Array<{ time_base: string }> }
    const timestamps = frames.map(frame => Number(frame.best_effort_timestamp_time))
    const durationSeconds = timestamps[timestamps.length - 1] + Number(frames[frames.length - 1]?.duration_time) - timestamps[0]
    if (!frames.length || !Number.isFinite(durationSeconds) || durationSeconds <= 0 || timestamps.some((timestamp, index) => !Number.isFinite(timestamp) || index > 0 && timestamp <= timestamps[index - 1])) {
      throw new Error(`Sample has incomplete or non-monotonic video timestamps: ${filePath}`)
    }
    const [numerator, denominator] = streams[0].time_base.split('/').map(Number)
    const timestampPrecisionSeconds = numerator / denominator
    if (!Number.isFinite(timestampPrecisionSeconds) || timestampPrecisionSeconds <= 0) throw new Error(`Sample has no valid video time base: ${filePath}`)
    return { frames: frames.length, durationSeconds, timestamps: timestamps.map(timestamp => timestamp - timestamps[0]), timestampPrecisionSeconds }
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
    const referencePaths: string[] = []
    const ownedPaths = new Set<string>()
    const retainedPaths = new Set<string>()
    let failure: unknown
    let result: MeasuredSampleResult | undefined
    let cleanupFailure: Error | undefined
    try {
      for (const [index, start] of starts.entries()) {
        await request.onProgress?.(`Preparing source sample ${index + 1} of ${starts.length}`)
        const sourceSamplePath = path.join(request.outputDirectory, `source-${index}.mkv`)
        ownedPaths.add(sourceSamplePath)
        await this.processRunner.run(binary, ['-y', '-v', 'error', '-ss', String(start), '-i', PathUtils.sanitizeAbsolutePath(request.inputPath), '-t', String(length), '-map', '0', '-c', 'copy', sourceSamplePath], request.signal)
        sourceSamplePaths.push(sourceSamplePath)
        sourceSamples.push(await this.inspectSample(sourceSamplePath, request.signal))
        // Materialize target color transforms separately so the candidate encoder
        // and its reference receive the same source frames with the transform applied once.
        if (request.referenceFilter) {
          const referencePath = path.join(request.outputDirectory, `reference-${index}.mkv`)
          ownedPaths.add(referencePath)
          await this.processRunner.run(binary, ['-y', '-v', 'error', ...(request.referenceInputArgs ?? []), '-i', sourceSamplePath, '-vf', request.referenceFilter, '-fps_mode', 'passthrough', '-an', '-sn', '-c:v', 'ffv1', referencePath], request.signal)
          referencePaths.push(referencePath)
          if ((await this.inspectSample(referencePath, request.signal)).frames !== sourceSamples[index].frames) throw new Error('Reference transform changed the source frame count')
        }
      }
      const measured: MeasuredCandidate[] = []
      for (const candidate of request.candidates) {
        const scores: number[] = [], banding: number[] = [], samplePaths: string[] = []
        const playbackBlockers = new Set<string>()
        let outputBytes = 0
        for (const index of starts.keys()) {
          request.signal?.throwIfAborted()
          await request.onProgress?.(`Encoding sample ${index + 1} of ${starts.length} with ${candidate.encoder} (${candidate.quality})`)
          const outputPath = path.join(request.outputDirectory, `${candidate.encoder}-${candidate.quality}-${candidate.preset}-${index}${request.outputExtension ?? '.mkv'}`)
          ownedPaths.add(outputPath)
          const args = candidate.ffmpegArgs.map(arg => arg === '<input>' ? sourceSamplePaths[index] : arg === '<output>' ? outputPath : arg)
          if (candidate.encoder.startsWith('qsv')) args.unshift('-v', 'verbose')
          const diagnostics = await this.processRunner.run(binary, args, request.signal)
          if (candidate.encoder.startsWith('qsv') && !/RateControlMethod: (?:ICQ|LA_ICQ)\b/.test(diagnostics)) throw new Error(`QSV did not initialize a quality-based rate-control mode: ${diagnostics}`)
          const outputSample = await this.inspectSample(outputPath, request.signal)
          if (outputSample.frames !== sourceSamples[index].frames) throw new Error(`Encoded sample frame count differs from its source (${outputSample.frames} != ${sourceSamples[index].frames})`)
          const timestampTolerance = sourceSamples[index].timestampPrecisionSeconds + outputSample.timestampPrecisionSeconds
          if (outputSample.timestamps.some((timestamp, frame) => Math.abs(timestamp - sourceSamples[index].timestamps[frame]) > timestampTolerance)) throw new Error('Encoded sample frame timing differs from its source')
          outputBytes += (await fs.stat(outputPath)).size
          samplePaths.push(outputPath)
          const logPath = path.join(request.outputDirectory, `${candidate.encoder}-${candidate.quality}-${candidate.preset}-${index}.json`)
          ownedPaths.add(logPath)
          // Two parsing levels: filtergraph, then filter options. Quote at both levels.
          const escapedPath = logPath.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "'\\\\''")
          const referencePath = referencePaths[index] ?? sourceSamplePaths[index]
          const graph = `[0:v]settb=AVTB,setpts=N[d];[1:v]settb=AVTB,setpts=N[r];[d][r]libvmaf=shortest=1:repeatlast=0:feature=name=cambi:log_fmt=json:log_path='${escapedPath}'`
          await request.onProgress?.(`Scoring sample ${index + 1} of ${starts.length} with VMAF and CAMBI`)
          await this.processRunner.run(binary, ['-v', 'error', '-i', outputPath, '-i', referencePath, '-filter_complex', graph, '-fps_mode', 'passthrough', '-an', '-sn', '-f', 'null', '-'], request.signal)
          const log = JSON.parse(await fs.readFile(logPath, 'utf8')) as { pooled_metrics: { vmaf: { mean: number }; cambi: { mean: number } }; frames: Array<{ metrics: { vmaf: number; cambi: number } }> }
          if (!Number.isFinite(log.pooled_metrics.vmaf.mean) || !Number.isFinite(log.pooled_metrics.cambi.mean)) throw new Error('VMAF/CAMBI measurements are incomplete')
          if (log.frames.length !== sourceSamples[index].frames) throw new Error(`VMAF scored ${log.frames.length} of ${sourceSamples[index].frames} source frames`)
          for (const frame of log.frames) { scores.push(frame.metrics.vmaf); banding.push(frame.metrics.cambi) }
          for (const blocker of await request.validateSample?.(outputPath) ?? []) playbackBlockers.add(blocker)
          await fs.unlink(logPath)
        }
        if (!scores.length || scores.some(score => !Number.isFinite(score)) || banding.some(score => !Number.isFinite(score))) throw new Error('Measured frame scores are incomplete')
        scores.sort((a, b) => a - b)
        measured.push({ encoder: candidate.encoder, quality: candidate.quality, preset: candidate.preset, outputBytes, sampledDurationSeconds: sourceSamples.reduce((sum, sample) => sum + sample.durationSeconds, 0), vmafMean: scores.reduce((a, b) => a + b, 0) / scores.length, vmafP5: scores[Math.floor(scores.length * 0.05)], cambiMean: banding.reduce((a, b) => a + b, 0) / banding.length, samplePaths, playbackBlockers: [...playbackBlockers] })
        await request.onCandidateMeasured?.(structuredClone(measured), measured.length === request.candidates.length)
        if (request.onCandidateMeasured) for (const samplePath of samplePaths) retainedPaths.add(samplePath)
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
