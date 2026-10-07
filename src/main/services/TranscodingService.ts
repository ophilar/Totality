import { spawn } from 'child_process'
import * as fs from 'fs/promises'
import { existsSync } from 'fs'
import * as path from 'path'
import { randomUUID } from 'node:crypto'
import { getMediaFileAnalyzer } from './MediaFileAnalyzer'
import { PathUtils } from './utils/PathUtils'
import { GpuDetector, type GpuInfo } from './utils/GpuDetector'
import { TranscodeCommandFactory } from './transcoding/TranscodeCommandFactory'
import { validateHdrTranscode } from './transcoding/HdrTranscodingPolicy'
import { buildTranscodingCapabilities, type TranscodingCapabilities } from './TranscodingCapabilities'
import type { MediaItem } from '../types/database'
import type { TranscodeOptions } from './transcoding/types'

export { type TranscodeOptions }

export class TranscodeError extends Error {
  constructor(message: string, public readonly exitCode?: number, public readonly stderr?: string) {
    super(message)
    this.name = 'TranscodeError'
  }
}

let transcodingServiceInstance: TranscodingService | null = null

export function getTranscodingService(): TranscodingService {
  if (!transcodingServiceInstance) {
    transcodingServiceInstance = new TranscodingService()
  }
  return transcodingServiceInstance
}

export class TranscodingService {
  private activeJobs = new Map<number, AbortController>()
  private capabilitiesPromise: Promise<TranscodingCapabilities> | null = null

  invalidate(): void {
    this.capabilitiesPromise = null
    console.log('[TranscodingService] TranscodingService invalidated capabilities cache')
  }

  cancelTranscode(mediaItemId?: number): boolean {
    if (mediaItemId !== undefined) {
      const controller = this.activeJobs.get(mediaItemId)
      if (!controller) return false
      controller.abort()
      this.activeJobs.delete(mediaItemId)
      console.log(`[TranscodingService] Cancelled transcode job for media item ${mediaItemId}`)
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
      console.log(`[TranscodingService] Aborted transcode job for media item ${id}`)
    }
    this.activeJobs.clear()
  }

  async getCapabilities(options: { refresh?: boolean } = {}): Promise<TranscodingCapabilities> {
    if (this.capabilitiesPromise && !options.refresh) return this.capabilitiesPromise

    this.capabilitiesPromise = (async () => {
      const isFfmpegAvailable = getMediaFileAnalyzer().isFFmpegAvailable()
      const availability = { ffmpeg: isFfmpegAvailable }

      let gpus: GpuInfo[] = []
      try {
        gpus = await GpuDetector.detectGpus({ refresh: options.refresh })
      } catch (e) {
        console.warn('[TranscodingService] GPU detection warning:', e)
      }

      const encoderProbe = await this.probeFfmpegEncoders(gpus)
      const selectedGpu = gpus.find(g => g.vendor === 'NVIDIA') ?? gpus[0]
      const selectedGpuId = selectedGpu ? selectedGpu.id : null

      const capabilities = buildTranscodingCapabilities(
        availability,
        gpus,
        selectedGpuId,
        encoderProbe.encoders,
        encoderProbe.failures
      )

      console.log(
        `[TranscodingService] Hardware capabilities: ${gpus.length} GPU(s) detected (${gpus.map(g => g.name).join(', ') || 'none'}), verified encoders: ${encoderProbe.encoders.join(', ') || 'none'}`
      )

      return capabilities
    })()

    return this.capabilitiesPromise
  }

  private async probeFfmpegEncoders(_gpus: GpuInfo[]): Promise<{ encoders: string[]; failures: string[] }> {
    const ffmpegPath = getMediaFileAnalyzer().getFFmpegPath() || 'ffmpeg'
    return new Promise<{ encoders: string[]; failures: string[] }>((resolve) => {
      const proc = spawn(PathUtils.resolveExecutablePath(ffmpegPath), ['-hide_banner', '-encoders'])
      let output = ''
      proc.stdout.on('data', (data) => { output += data.toString() })
      proc.stderr.on('data', (data) => { output += data.toString() })
      proc.on('error', (error) => {
        resolve({ encoders: [], failures: [`Failed to execute ${ffmpegPath}: ${error.message}`] })
      })
      proc.on('close', (code) => {
        if (code !== 0) {
          return resolve({ encoders: [], failures: [`FFmpeg encoder probe exited with code ${code}`] })
        }
        const ffmpegNames = [...output.matchAll(/^\s*[A-Z.]+\s+(\S+)/gm)].map((match) => match[1])
        const availableEncoders: string[] = []

        if (ffmpegNames.includes('hevc_nvenc')) availableEncoders.push('nvenc_h265')
        if (ffmpegNames.includes('av1_nvenc')) availableEncoders.push('nvenc_av1')
        if (ffmpegNames.includes('hevc_qsv')) availableEncoders.push('qsv_h265')
        if (ffmpegNames.includes('av1_qsv')) availableEncoders.push('qsv_av1')
        if (ffmpegNames.includes('libx265')) availableEncoders.push('x265')
        if (ffmpegNames.includes('libsvtav1')) availableEncoders.push('svt_av1')
        if (ffmpegNames.includes('libx264')) availableEncoders.push('libx264')

        resolve({ encoders: availableEncoders, failures: [] })
      })
    })
  }

  async transcodeMediaItem(
    mediaItem: MediaItem,
    options: TranscodeOptions,
    onProgress?: (progress: number) => void
  ): Promise<{ outputPath: string; outputSize: number }> {
    if (!mediaItem.file_path) {
      throw new Error(`Media item ${mediaItem.title} has no local file path`)
    }

    const inputPath = mediaItem.file_path
    if (!existsSync(inputPath)) {
      throw new Error(`File not found: ${inputPath}`)
    }

    const analysis = await getMediaFileAnalyzer().analyzeCompleteFile(inputPath)
    if (!analysis.success) {
      throw new Error(`Failed to analyze media file: ${analysis.error}`)
    }

    validateHdrTranscode(analysis, options)

    const capabilities = await this.getCapabilities()
    const selectedGpu = capabilities.gpus.find(g => g.id === options.gpuId) ?? capabilities.gpus[0]
    const vendor = options.useGpu !== false && selectedGpu ? selectedGpu.vendor : 'Software'

    const ext = options.targetContainer ? `.${options.targetContainer}` : path.extname(inputPath)
    const baseDir = path.dirname(inputPath)
    const baseName = path.basename(inputPath, path.extname(inputPath))
    const outputPath = path.join(baseDir, `${baseName}.optimized-${randomUUID()}${ext}`)

    const builder = TranscodeCommandFactory.getBuilder(vendor, options)
    const ffmpegArgs = builder.buildFFmpegArgs(inputPath, outputPath, options, analysis)

    const ffmpegPath = getMediaFileAnalyzer().getFFmpegPath() || 'ffmpeg'
    const abortController = new AbortController()
    if (mediaItem.id !== undefined) {
      this.activeJobs.set(mediaItem.id, abortController)
    }

    try {
      await new Promise<void>((resolve, reject) => {
        const proc = spawn(PathUtils.resolveExecutablePath(ffmpegPath), ffmpegArgs, {
          signal: abortController.signal,
          stdio: ['ignore', 'pipe', 'pipe'],
        })

        let stderr = ''
        const totalDurationMs = analysis.duration || (mediaItem.duration ? mediaItem.duration * 1000 : 0)

        proc.stderr.on('data', (data) => {
          const chunk = data.toString()
          stderr += chunk
          if (onProgress && totalDurationMs > 0) {
            const timeMatch = chunk.match(/time=(\d+):(\d+):(\d+(?:\.\d+)?)/)
            if (timeMatch) {
              const hours = parseFloat(timeMatch[1])
              const mins = parseFloat(timeMatch[2])
              const secs = parseFloat(timeMatch[3])
              const currentMs = (hours * 3600 + mins * 60 + secs) * 1000
              const progressPct = Math.min(99, Math.round((currentMs / totalDurationMs) * 100))
              onProgress(progressPct)
            }
          }
        })

        proc.on('close', (code) => {
          if (code === 0) {
            onProgress?.(100)
            resolve()
          } else {
            reject(new TranscodeError(`FFmpeg failed with exit code ${code}`, code ?? undefined, stderr))
          }
        })

        proc.on('error', (err) => {
          if (abortController.signal.aborted) {
            reject(new TranscodeError('Transcode cancelled by user'))
          } else {
            reject(new TranscodeError(`Failed to run FFmpeg: ${err.message}`))
          }
        })
      })

      const stat = await fs.stat(outputPath)
      return { outputPath, outputSize: stat.size }
    } finally {
      if (mediaItem.id !== undefined) {
        this.activeJobs.delete(mediaItem.id)
      }
    }
  }
}
