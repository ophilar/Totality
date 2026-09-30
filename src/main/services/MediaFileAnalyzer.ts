import { spawn } from 'child_process'
import type { ChildProcess } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'
import {
  normalizeVideoCodec,
  normalizeResolution,
  normalizeAudioCodec,
} from '@main/services/MediaNormalizer'
import type { MediaMetadata } from '@main/providers/base/MediaProvider'
import type { FileAnalysisResult, AnalyzedAudioStream, AnalyzedSubtitleStream, EmbeddedMetadataTags, AnalyzedVideoStream } from '@main/workers/ffprobe-worker'
import { getLoggingService } from '@main/services/LoggingService'
import { PathUtils } from '@main/services/utils/PathUtils'
import { FFPROBE_ANALYSIS_ARGS, parseFFprobeOutput, type FFprobeOutput } from '@main/workers/ffprobe-worker'
import { StreamByteAccumulator } from '@main/services/transcoding/StreamByteAccounting'

export type { FileAnalysisResult, AnalyzedAudioStream, AnalyzedSubtitleStream, EmbeddedMetadataTags, AnalyzedVideoStream }

const SYSTEM_FFPROBE_COMMAND = 'ffprobe'
const SYSTEM_FFMPEG_COMMAND = 'ffmpeg'

// Singleton instance
let analyzerInstance: MediaFileAnalyzer | null = null

export function getMediaFileAnalyzer(): MediaFileAnalyzer {
  if (!analyzerInstance) {
    analyzerInstance = new MediaFileAnalyzer()
  }
  return analyzerInstance
}

export class MediaFileAnalyzer {
  private readonly deepProcesses = new Map<string, ChildProcess>()
  private ffprobePath: string | null = null
  private ffmpegPath: string | null = null
  private ffprobeChecked: boolean = false
  private availabilityPromise: Promise<boolean> | null = null
  private cachedVersion: string | null | undefined = undefined

  /**
   * Get FFprobe version string
   */
  async getVersion(): Promise<string | null> {
    if (this.cachedVersion !== undefined) return this.cachedVersion

    if (!await this.isAvailable()) {
      this.cachedVersion = null
      return null
    }

    this.cachedVersion = await new Promise<string | null>((resolve) => {
      const proc = spawn(this.requireFFprobePath(), ['-version'])
      let output = ''
      proc.stdout.on('data', (data) => { output += data.toString() })
      proc.on('close', () => {
        const match = output.match(/ffprobe version (\S+)/)
        resolve(match ? (match[1].match(/^\d+(?:\.\d+){0,3}/)?.[0] || match[1]) : 'unknown')
      })
      proc.on('error', (error) => {
        getLoggingService().warn('[MediaFileAnalyzer]', 'Failed to query system FFprobe version:', error)
        resolve(null)
      })
    })

    return this.cachedVersion || null
  }

  /**
   * Check whether system FFprobe is available to the Totality process.
   */
  async isAvailable(): Promise<boolean> {
    if (this.ffprobeChecked && this.ffprobePath) return true
    if (this.ffprobeChecked) return false
    if (this.availabilityPromise) return this.availabilityPromise
    this.availabilityPromise = this.checkAvailability()
    try {
      return await this.availabilityPromise
    } finally {
      this.availabilityPromise = null
    }
  }

  /**
   * Check whether system FFmpeg is available to the Totality process.
   */
  async isFFmpegAvailable(): Promise<boolean> {
    await this.isAvailable()
    return this.ffmpegPath !== null
  }

  private async checkAvailability(): Promise<boolean> {
    const [ffprobeAvailable, ffmpegAvailable] = await Promise.all([
      this.testBinary(SYSTEM_FFPROBE_COMMAND),
      this.testBinary(SYSTEM_FFMPEG_COMMAND),
    ])

    this.ffprobePath = ffprobeAvailable ? SYSTEM_FFPROBE_COMMAND : null
    this.ffmpegPath = ffmpegAvailable ? SYSTEM_FFMPEG_COMMAND : null
    this.ffprobeChecked = true

    if (ffprobeAvailable) {
      getLoggingService().info('[MediaFileAnalyzer]', 'System FFprobe is available through the process PATH')
    }
    if (ffmpegAvailable) {
      getLoggingService().info('[MediaFileAnalyzer]', 'System FFmpeg is available through the process PATH')
    }

    return ffprobeAvailable
  }

  private async testBinary(command: string): Promise<boolean> {
    return new Promise((resolve) => {
      const proc = spawn(command, ['-version'], { stdio: 'ignore', timeout: 5000 })
      proc.on('close', (code) => resolve(code === 0))
      proc.on('error', (error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') {
          getLoggingService().debug('[MediaFileAnalyzer]', `${command} is unavailable through the process PATH`)
        } else {
          getLoggingService().warn('[MediaFileAnalyzer]', `Failed to execute ${command}: ${error.message}`)
        }
        resolve(false)
      })
    })
  }

  getFFmpegPath(): string | null {
    return this.ffmpegPath
  }

  private requireFFprobePath(): string {
    if (!this.ffprobePath) throw new Error('FFprobe is unavailable through the system PATH')
    return this.ffprobePath
  }

  private requireFFmpegPath(): string {
    if (!this.ffmpegPath) throw new Error('FFmpeg is unavailable through the system PATH')
    return this.ffmpegPath
  }

  /**
   * Perform deep analysis of a media file (bitrate variance, volume peaks)
   */
  async deepAnalyzeFile(filePath: string, options: { scanBitrate?: boolean; detectVolume?: boolean; requestId?: string; signal?: AbortSignal } = {}): Promise<Partial<FileAnalysisResult>> {
    if (!await this.isAvailable()) throw new Error('FFprobe is unavailable through the system PATH')

    const logging = getLoggingService()
    const results: Partial<FileAnalysisResult> = { success: true, filePath, audioTracks: [], subtitleTracks: [], deepAnalysis: {} }
    const deepAnalysis = results.deepAnalysis ?? (results.deepAnalysis = {})
    const startTime = Date.now()

    if (options.detectVolume) {
      const volumeStartedAt = Date.now()
      logging.debug('[MediaFileAnalyzer]', 'Starting audio volume detection')
      const vol = await this.detectAudioVolume(filePath, options.requestId, options.signal)
      logging.debug('[MediaFileAnalyzer]', `Completed audio volume detection in ${Date.now() - volumeStartedAt}ms`)
      results.audioTracks = [{ index: 0, codec: 'unknown', channels: 0, isDefault: false, hasObjectAudio: false, ...vol }]
    }

    if (options.scanBitrate) {
      const bitrateStartedAt = Date.now()
      logging.debug('[MediaFileAnalyzer]', 'Starting bitrate variance analysis')
      const bitrate = await this.analyzeBitrateVariance(filePath, options.requestId, options.signal)
      logging.debug('[MediaFileAnalyzer]', `Completed bitrate variance analysis in ${Date.now() - bitrateStartedAt}ms`)
      results.deepAnalysis = { ...results.deepAnalysis, ...bitrate }
    }

    deepAnalysis.scanDurationMs = Date.now() - startTime
    return results
  }

  cancelDeepAnalysis(requestId: string): void {
    this.deepProcesses.get(requestId)?.kill()
    this.deepProcesses.delete(requestId)
  }

  private async detectAudioVolume(filePath: string, requestId?: string, signal?: AbortSignal): Promise<{ peakVolumeDB: number; meanVolumeDB: number }> {
    const sanitizedPath = PathUtils.sanitizeAbsolutePath(filePath)
    const ffmpegCommand = this.requireFFmpegPath()
    return new Promise((resolve, reject) => {
      const args = ['-i', `file:${sanitizedPath}`, '-af', 'volumedetect', '-vn', '-sn', '-dn', '-f', 'null', '-']
      const proc = spawn(ffmpegCommand, args, { stdio: ['ignore', 'ignore', 'pipe'], signal })
      if (requestId) this.deepProcesses.set(requestId, proc)

      let stderr = ''
      proc.stderr.on('data', (d) => { stderr += d.toString() })

      proc.on('close', (code) => {
        if (requestId) this.deepProcesses.delete(requestId)
        if (code !== 0) return reject(new Error(`FFmpeg exited with code ${code}`))

        const maxVolumeMatch = stderr.match(/max_volume:\s+(-?[0-9.]+)\s+dB/)
        const meanVolumeMatch = stderr.match(/mean_volume:\s+(-?[0-9.]+)\s+dB/)
        if (maxVolumeMatch && meanVolumeMatch) {
          resolve({
            peakVolumeDB: parseFloat(maxVolumeMatch[1]),
            meanVolumeDB: parseFloat(meanVolumeMatch[1])
          })
        } else {
          reject(new Error('Failed to parse volume detection output'))
        }
      })
      proc.on('error', reject)
    })
  }

  private async analyzeBitrateVariance(filePath: string, requestId?: string, signal?: AbortSignal): Promise<{ peakBitrate: number; avgBitrate: number; bitrateVariance: number; isVariableBitrate: boolean }> {
    const sanitizedPath = PathUtils.sanitizeAbsolutePath(filePath)
    const ffprobeCommand = this.requireFFprobePath()
    return new Promise((resolve, reject) => {
      // Use ffprobe to get packet sizes for the first video stream
      const args = ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'packet=size,duration_time', '-of', 'compact=p=0:nk=1', `file:${sanitizedPath}`]
      const proc = spawn(ffprobeCommand, args, { stdio: ['ignore', 'pipe', 'pipe'], signal })
      if (requestId) this.deepProcesses.set(requestId, proc)

      let stdout = ''
      proc.stdout.on('data', (d) => { stdout += d.toString() })

      proc.on('close', (code) => {
        if (requestId) this.deepProcesses.delete(requestId)
        if (code !== 0) return reject(new Error(`FFprobe exited with code ${code}`))

        const lines = stdout.trim().split('\n')
        if (lines.length < 10) return reject(new Error('Insufficient data for bitrate analysis'))

        let totalBytes = 0
        let totalDuration = 0
        let maxBitrate = 0

        // Windowed bitrate calculation (1-second sliding window)
        const windowSize = 1.0 // seconds
        let currentWindowBytes = 0
        let currentWindowDuration = 0
        const windowQueue: Array<{ bytes: number, duration: number }> = []
        const bitrates: number[] = []

        for (const line of lines) {
          const [durStr, sizeStr] = line.split('|')
          const size = parseInt(sizeStr, 10)
          const duration = parseFloat(durStr)
          if (isNaN(size) || isNaN(duration)) continue

          totalBytes += size
          totalDuration += duration

          currentWindowBytes += size
          currentWindowDuration += duration
          windowQueue.push({ bytes: size, duration })

          while (currentWindowDuration > windowSize && windowQueue.length > 0) {
            const first = windowQueue.shift()!
            currentWindowBytes -= first.bytes
            currentWindowDuration -= first.duration
          }

          if (currentWindowDuration > 0.5) { // Only sample if we have at least half a second
            const windowBitrate = (currentWindowBytes * 8) / currentWindowDuration / 1000 // kbps
            if (windowBitrate > maxBitrate) maxBitrate = windowBitrate
            bitrates.push(windowBitrate)
          }
        }

        const avgBitrate = (totalBytes * 8) / totalDuration / 1000

        // Calculate variance
        const squareDiffs = bitrates.map(b => Math.pow(b - avgBitrate, 2))
        const variance = squareDiffs.reduce((a, b) => a + b, 0) / squareDiffs.length
        const stdDev = Math.sqrt(variance)

        resolve({
          peakBitrate: Math.round(maxBitrate),
          avgBitrate: Math.round(avgBitrate),
          bitrateVariance: Math.round(stdDev),
          isVariableBitrate: stdDev > (avgBitrate * 0.1) // More than 10% deviation
        })
      })
      proc.on('error', reject)
    })
  }

  /**
   * Extract embedded artwork from an audio file
   */
  async extractArtwork(audioFilePath: string, outputPath: string): Promise<boolean> {
    if (!this.ffprobePath || !this.ffmpegPath) await this.isAvailable()
    const ffmpegCommand = this.requireFFmpegPath()

    try {
      const sanitizedInput = PathUtils.sanitizeAbsolutePath(audioFilePath)
      const sanitizedOutput = PathUtils.sanitizeAbsolutePath(outputPath)

      return new Promise((resolve, reject) => {
        const outputDir = path.dirname(sanitizedOutput)
        if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true })

        const args = ['-i', `file:${sanitizedInput}`, '-an', '-vcodec', 'copy', '-y', sanitizedOutput]
        const proc = spawn(ffmpegCommand, args, { stdio: 'ignore', timeout: 30000 })

        proc.on('close', (code) => {
          if (code === 0 && fs.existsSync(sanitizedOutput) && fs.statSync(sanitizedOutput).size > 0) resolve(true)
          else {
            if (fs.existsSync(sanitizedOutput)) fs.unlinkSync(sanitizedOutput)
            resolve(false)
          }
        })
        proc.on('error', (err) => reject(new Error(`Failed to spawn FFmpeg: ${err.message}`)))
      })
    } catch (error) {
      getLoggingService().error('[MediaFileAnalyzer]', 'Failed to extract artwork:', error)
      throw error
    }
  }

  /**
   * Analyze a media file and return detailed metadata
   */
  async analyzeFile(filePath: string, signal?: AbortSignal): Promise<FileAnalysisResult> {
    if (!await this.isAvailable()) {
      throw new Error('FFprobe is unavailable through the system PATH')
    }

    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`)
    }

    const ffprobeOutput = await this.runFFprobe(filePath, signal)
    return parseFFprobeOutput(filePath, ffprobeOutput)
  }

  async analyzeCompleteFile(filePath: string, options: { scanBitrate?: boolean; detectVolume?: boolean; requestId?: string; signal?: AbortSignal } = {}): Promise<FileAnalysisResult> {
    const logging = getLoggingService()
    const startedAt = Date.now()
    let stage = 'metadata probe'
    logging.debug('[MediaFileAnalyzer]', `Starting ${stage}`)
    try {
      const fileAnalysis = await this.analyzeFile(filePath, options.signal)
      logging.debug('[MediaFileAnalyzer]', `Completed ${stage} in ${Date.now() - startedAt}ms`)

      stage = 'stream byte measurement'
      const streamBytesStartedAt = Date.now()
      logging.debug('[MediaFileAnalyzer]', `Starting ${stage}`)
      const streamBytes = await this.measureStreamBytes(filePath, options.signal)
      logging.debug('[MediaFileAnalyzer]', `Completed ${stage} in ${Date.now() - streamBytesStartedAt}ms`)

      stage = 'deep analysis'
      const deepAnalysisStartedAt = Date.now()
      logging.debug('[MediaFileAnalyzer]', `Starting ${stage}`)
      const deepAnalysis = await this.deepAnalyzeFile(filePath, {
        scanBitrate: options.scanBitrate ?? true,
        detectVolume: options.detectVolume ?? true,
        requestId: options.requestId,
        signal: options.signal,
      })
      if (!deepAnalysis.success) throw new Error(deepAnalysis.error || `Deep analysis failed for ${filePath}`)
      logging.debug('[MediaFileAnalyzer]', `Completed ${stage} in ${Date.now() - deepAnalysisStartedAt}ms`)

      return {
        ...fileAnalysis,
        streamBytes,
        audioTracks: deepAnalysis.audioTracks?.length ? deepAnalysis.audioTracks : fileAnalysis.audioTracks,
        deepAnalysis: deepAnalysis.deepAnalysis,
      }
    } catch (error) {
      if (options.signal?.aborted) {
        logging.info('[MediaFileAnalyzer]', `Cancelled during ${stage} after ${Date.now() - startedAt}ms`)
      } else {
        logging.error('[MediaFileAnalyzer]', `Failed during ${stage} after ${Date.now() - startedAt}ms`, error)
      }
      throw error
    }
  }

  async measureStreamBytes(filePath: string, signal?: AbortSignal): Promise<Record<number, number>> {
    const sanitizedPath = PathUtils.sanitizeAbsolutePath(filePath)
    const ffprobeCommand = this.requireFFprobePath()
    return new Promise((resolve, reject) => {
      const args = [
        '-v', 'error',
        '-show_entries', 'packet=stream_index,size',
        '-of', 'csv=p=0',
        `file:${sanitizedPath}`,
      ]
      const proc = spawn(ffprobeCommand, args, { stdio: ['ignore', 'pipe', 'pipe'], signal })
      const streamByteAccumulator = new StreamByteAccumulator()
      let stderr = ''
      let outputError: unknown
      proc.stdout.on('data', data => {
        if (outputError) return
        try {
          streamByteAccumulator.write(data.toString())
        } catch (error) {
          outputError = error
          proc.kill('SIGKILL')
        }
      })
      proc.stderr.on('data', data => { stderr += data.toString() })
      proc.once('error', error => {
        reject(error)
      })
      proc.once('close', code => {
        if (outputError) {
          reject(outputError)
          return
        }
        if (code !== 0) {
          reject(new Error(stderr || `FFprobe stream byte measurement exited with code ${code}: ${sanitizedPath}`))
          return
        }
        try {
          resolve(streamByteAccumulator.finish())
        } catch (error) {
          reject(error)
        }
      })
    })
  }

  /**
   * Analyze multiple files in parallel
   */
  async analyzeFilesParallel(
    filePaths: string[],
    onProgress?: (current: number, total: number, currentFile: string) => void,
    signal?: AbortSignal
  ): Promise<Map<string, FileAnalysisResult>> {
    if (!await this.isAvailable()) {
      const results = new Map<string, FileAnalysisResult>()
      for (const filePath of filePaths) {
        results.set(filePath, { success: false, error: 'FFprobe unavailable through system PATH', filePath, audioTracks: [], subtitleTracks: [] })
      }
      return results
    }

    const { getFFprobeWorkerPool } = await import('./FFprobeWorkerPool')
    const pool = getFFprobeWorkerPool()
    await pool.initialize(this.requireFFprobePath())
    return await pool.analyzeFiles(filePaths, onProgress, signal)
  }

  /**
   * Get the current FFprobe executable reference.
   */
  getFFprobePath(): string | null {
    return this.ffprobePath
  }

  /**
   * Check if metadata needs enhancement from FFprobe.
   */
  needsEnhancement(metadata: MediaMetadata): boolean {
    return (
      !metadata.videoBitrate ||
      !metadata.height ||
      !metadata.width ||
      metadata.hdrFormat === undefined ||
      !metadata.audioBitrate ||
      !metadata.audioChannels
    )
  }

  /**
   * Enhance existing metadata with results from FFprobe analysis.
   */
  enhanceMetadata(metadata: MediaMetadata, analysis: FileAnalysisResult): MediaMetadata {
    if (!analysis.success) return metadata

    const enhanced = { ...metadata }

    if (analysis.video) {
      const v = analysis.video
      enhanced.width = v.width
      enhanced.height = v.height
      enhanced.resolution = normalizeResolution(v.width, v.height)
      enhanced.videoCodec = normalizeVideoCodec(v.codec)
      enhanced.videoBitrate = v.bitrate
      enhanced.videoFrameRate = v.frameRate
      enhanced.colorBitDepth = v.bitDepth
      enhanced.hdrFormat = v.hdrFormat
      enhanced.videoProfile = v.profile
      enhanced.colorSpace = v.colorSpace
    }

    if (analysis.duration) enhanced.duration = analysis.duration
    if (analysis.fileSize) enhanced.fileSize = analysis.fileSize
    if (analysis.container) enhanced.container = analysis.container

    if (analysis.audioTracks && analysis.audioTracks.length > 0) {
      enhanced.audioTracks = analysis.audioTracks.map((track) => ({
        codec: normalizeAudioCodec(track.codec, track.profile),
        channels: track.channels,
        bitrate: track.bitrate,
        sampleRate: track.sampleRate,
        language: track.language,
        isDefault: track.isDefault,
        hasObjectAudio: track.hasObjectAudio,
      }))

      const bestAudio = this.selectBestAudioTrack(analysis.audioTracks)
      if (bestAudio) {
        enhanced.audioCodec = normalizeAudioCodec(bestAudio.codec, bestAudio.profile)
        enhanced.audioChannels = bestAudio.channels
        enhanced.audioBitrate = bestAudio.bitrate
        enhanced.hasObjectAudio = bestAudio.hasObjectAudio
      }
    }

    if (analysis.subtitleTracks && analysis.subtitleTracks.length > 0) {
      enhanced.subtitleTracks = analysis.subtitleTracks.map((track) => ({
        codec: track.codec,
        language: track.language,
        title: track.title,
        isDefault: track.isDefault,
        isForced: track.isForced,
      }))
    }

    if (analysis.embeddedMetadata) {
      const tags = analysis.embeddedMetadata
      if (tags.year && !enhanced.year) enhanced.year = tags.year

      if (enhanced.type === 'episode') {
        if (tags.showName && !enhanced.seriesTitle) enhanced.seriesTitle = tags.showName
        if (tags.seasonNumber && !enhanced.seasonNumber) enhanced.seasonNumber = tags.seasonNumber
        if (tags.episodeNumber && !enhanced.episodeNumber) enhanced.episodeNumber = tags.episodeNumber
        if (tags.episodeTitle && !enhanced.title) enhanced.title = tags.episodeTitle
      } else if (tags.title && !enhanced.title) {
        enhanced.title = tags.title
      }
    }

    return enhanced
  }

  private selectBestAudioTrack(tracks: AnalyzedAudioStream[]): AnalyzedAudioStream | undefined {
    if (!tracks || tracks.length === 0) return undefined
    if (tracks.length === 1) return tracks[0]

    let bestTrack = tracks[0]
    let bestScore = this.calculateAudioTrackScoreInternal(bestTrack)

    for (let i = 1; i < tracks.length; i++) {
      const score = this.calculateAudioTrackScoreInternal(tracks[i])
      if (score > bestScore) {
        bestScore = score
        bestTrack = tracks[i]
      }
    }
    return bestTrack
  }

  private calculateAudioTrackScoreInternal(track: AnalyzedAudioStream): number {
    let score = 0
    const codecLower = track.codec.toLowerCase()
    if (track.hasObjectAudio) score += 10000
    if (codecLower.includes('truehd') || codecLower.includes('dts-hd') || codecLower === 'dtshd' || codecLower === 'flac' || codecLower.includes('pcm') || codecLower === 'alac') {
      score += 5000
    }
    if (codecLower.includes('eac3') || codecLower.includes('e-ac-3') || codecLower.includes('dd+')) {
      score += 3000
    } else if (codecLower.includes('ac3') || codecLower.includes('ac-3') || codecLower === 'dts') {
      score += 2000
    } else if (codecLower === 'aac') {
      score += 1000
    }
    score += (track.channels || 2) * 100
    score += track.bitrate || 0
    return score
  }

  // ============================================================================
  // PRIVATE HELPERS
  // ============================================================================

  private async runFFprobe(filePath: string, signal?: AbortSignal): Promise<FFprobeOutput> {
    const sanitizedPath = PathUtils.sanitizeAbsolutePath(filePath)
    return new Promise((resolve, reject) => {
      const args = [...FFPROBE_ANALYSIS_ARGS, `file:${sanitizedPath}`]
      const proc = spawn(this.requireFFprobePath(), args, { stdio: ['ignore', 'pipe', 'pipe'], signal })
      let stdout = ''
      let stderr = ''
      proc.stdout.on('data', (data) => { stdout += data.toString() })
      proc.stderr.on('data', (data) => { stderr += data.toString() })
      proc.on('close', (code) => {
        if (code === 0 && stdout) {
          try { resolve(JSON.parse(stdout) as FFprobeOutput) }
          catch (e) { reject(new Error(`Failed to parse FFprobe output: ${(e as Error).message}`)) }
        } else {
          reject(new Error(stderr || `FFprobe exited with code ${code}`))
        }
      })
      proc.on('error', (error) => reject(error))
    })
  }

}
