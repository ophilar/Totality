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
    const referencePaths: string[] = []
    const ownedPaths = new Set<string>()
    const retainedPaths = new Set<string>()
    let failure: unknown
    let result: MeasuredSampleResult | undefined
    let cleanupFailure: Error | undefined
    try {
      // Materialize hardware color transforms once per section. Feeding libplacebo
      // and libvmaf in one graph changes frame synchronization on multi-input graphs.
      if (request.referenceInputArgs?.length && request.referenceFilter) {
        for (const [index, start] of starts.entries()) {
          const referencePath = path.join(request.outputDirectory, `reference-${index}.mkv`)
          ownedPaths.add(referencePath)
          await this.processRunner.run(binary, ['-y', '-v', 'error', ...request.referenceInputArgs, '-ss', String(start), '-i', PathUtils.sanitizeAbsolutePath(request.inputPath), '-t', String(length), '-vf', request.referenceFilter, '-fps_mode', 'passthrough', '-an', '-sn', '-c:v', 'ffv1', referencePath], request.signal)
          referencePaths.push(referencePath)
        }
      }
      const measured: MeasuredCandidate[] = []
      for (const candidate of request.candidates) {
        const scores: number[] = [], banding: number[] = [], samplePaths: string[] = []
        let outputBytes = 0
        for (const [index, start] of starts.entries()) {
          request.signal?.throwIfAborted()
          const outputPath = path.join(request.outputDirectory, `${candidate.encoder}-${candidate.quality}-${candidate.preset}-${index}${request.outputExtension ?? '.mkv'}`)
          ownedPaths.add(outputPath)
          const args = candidate.ffmpegArgs.map(arg => arg === '<input>' ? PathUtils.sanitizeAbsolutePath(request.inputPath) : arg === '<output>' ? outputPath : arg)
          args.splice(args.indexOf('-i'), 0, '-ss', String(start))
          args.splice(args.length - 1, 0, '-t', String(length))
          await this.processRunner.run(binary, args, request.signal)
          outputBytes += (await fs.stat(outputPath)).size
          samplePaths.push(outputPath)
          const logPath = path.join(request.outputDirectory, `${candidate.encoder}-${candidate.quality}-${candidate.preset}-${index}.json`)
          ownedPaths.add(logPath)
          // Two parsing levels: filtergraph, then filter options. Quote at both levels.
          const escapedPath = logPath.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "'\\\\''")
          const reference = !referencePaths.length && request.referenceFilter ? `,${request.referenceFilter}` : ''
          const graph = `[0:v]settb=AVTB,setpts=PTS-STARTPTS[d];[1:v]settb=AVTB,setpts=PTS-STARTPTS${reference}[r];[d][r]libvmaf=feature=name=cambi:log_fmt=json:log_path='${escapedPath}'`
          await this.processRunner.run(binary, ['-v', 'error', '-i', outputPath, ...(referencePaths.length ? ['-i', referencePaths[index]] : ['-ss', String(start), '-t', String(length), '-i', PathUtils.sanitizeAbsolutePath(request.inputPath)]), '-filter_complex', graph, '-an', '-sn', '-f', 'null', '-'], request.signal)
          const log = JSON.parse(await fs.readFile(logPath, 'utf8')) as { pooled_metrics: { vmaf: { mean: number }; cambi: { mean: number } }; frames: Array<{ metrics: { vmaf: number; cambi: number } }> }
          if (!Number.isFinite(log.pooled_metrics.vmaf.mean) || !Number.isFinite(log.pooled_metrics.cambi.mean)) throw new Error('VMAF/CAMBI measurements are incomplete')
          for (const frame of log.frames) { scores.push(frame.metrics.vmaf); banding.push(frame.metrics.cambi) }
          await fs.unlink(logPath)
        }
        if (!scores.length || scores.some(score => !Number.isFinite(score)) || banding.some(score => !Number.isFinite(score))) throw new Error('Measured frame scores are incomplete')
        scores.sort((a, b) => a - b)
        measured.push({ encoder: candidate.encoder, quality: candidate.quality, preset: candidate.preset, outputBytes, vmafMean: scores.reduce((a, b) => a + b, 0) / scores.length, vmafP5: scores[Math.floor(scores.length * 0.05)], cambiMean: banding.reduce((a, b) => a + b, 0) / banding.length, samplePaths })
      }
      for (const candidate of measured) for (const samplePath of candidate.samplePaths!) retainedPaths.add(samplePath)
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
