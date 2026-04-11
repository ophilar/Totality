import { spawn } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'
import AdmZip from 'adm-zip'
import * as https from 'https'
import { app } from 'electron'
import { createWriteStream, mkdirSync } from 'fs'
import { pipeline } from 'stream/promises'
import { getErrorMessage } from './utils/errorUtils'
import {
  normalizeVideoCodec,
  normalizeResolution,
  normalizeAudioCodec,
} from './MediaNormalizer'
import type { MediaMetadata } from '../providers/base/MediaProvider'
import type { FileAnalysisResult, AnalyzedAudioStream, AnalyzedSubtitleStream, EmbeddedMetadataTags, AnalyzedVideoStream } from '../workers/ffprobe-worker'
import { getLoggingService } from '../services/LoggingService'

export type { FileAnalysisResult, AnalyzedAudioStream, AnalyzedSubtitleStream, EmbeddedMetadataTags, AnalyzedVideoStream }

// FFprobe JSON output types
interface FFprobeStream {
  index: number
  codec_name?: string
  codec_long_name?: string
  codec_type: 'video' | 'audio' | 'subtitle' | 'data'
  profile?: string
  level?: number
  width?: number
  height?: number
  coded_width?: number
  coded_height?: number
  pix_fmt?: string
  color_space?: string
  color_transfer?: string
  color_primaries?: string
  field_order?: string
  r_frame_rate?: string
  avg_frame_rate?: string
  bit_rate?: string
  bits_per_raw_sample?: string
  sample_rate?: string
  channels?: number
  channel_layout?: string
  sample_fmt?: string
  bits_per_sample?: number
  duration?: string
  tags?: {
    language?: string
    title?: string
    BPS?: string
    'BPS-eng'?: string
    NUMBER_OF_BYTES?: string
    'NUMBER_OF_BYTES-eng'?: string
    [key: string]: string | undefined
  }
  disposition?: {
    default: number
    dub: number
    original: number
    comment: number
    lyrics: number
    karaoke: number
    forced: number
    hearing_impaired: number
    visual_impaired: number
    clean_effects: number
    attached_pic: number
    timed_thumbnails: number
  }
  side_data_list?: Array<{
    side_data_type: string
    [key: string]: unknown
  }>
}

interface FFprobeFormat {
  filename: string
  nb_streams: number
  nb_programs: number
  format_name: string
  format_long_name: string
  start_time?: string
  duration?: string
  size?: string
  bit_rate?: string
  probe_score: number
  tags?: {
    [key: string]: string
  }
}

interface FFprobeOutput {
  streams: FFprobeStream[]
  format: FFprobeFormat
}

// Singleton instance
let analyzerInstance: MediaFileAnalyzer | null = null

export function getMediaFileAnalyzer(): MediaFileAnalyzer {
  if (!analyzerInstance) {
    analyzerInstance = new MediaFileAnalyzer()
  }
  return analyzerInstance
}

export class MediaFileAnalyzer {
  private ffprobePath: string | null = null
  private ffprobeChecked: boolean = false
  private availabilityPromise: Promise<boolean> | null = null
  private analysisOverride: Map<string, FileAnalysisResult> = new Map()

  /**
   * For testing: Set a pre-baked analysis result for a specific path
   */
  setAnalysisOverride(filePath: string, result: FileAnalysisResult): void {
    this.analysisOverride.set(filePath, result)
  }

  /**
   * For testing: Clear all analysis overrides
   */
  clearAnalysisOverrides(): void {
    this.analysisOverride.clear()
  }

  /**
   * Check if FFprobe is available on the system
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

  private async checkAvailability(): Promise<boolean> {
    const possiblePaths = this.getPossibleFFprobePaths()

    for (const probePath of possiblePaths) {
      try {
        const available = await this.testFFprobe(probePath)
        if (available) {
          this.ffprobePath = probePath
          this.ffprobeChecked = true
          getLoggingService().info('[MediaFileAnalyzer]', `Found FFprobe at: ${probePath === 'ffprobe' ? 'system PATH' : 'bundled'}`)
          return true
        }
      } catch (error) { throw error }
    }

    this.ffprobeChecked = true
    return false
  }

  /**
   * Get FFprobe version string
   */
  async getVersion(): Promise<string | null> {
    if (!await this.isAvailable()) return null

    return new Promise((resolve) => {
      const actualPath = (this.ffprobePath && (path.isAbsolute(this.ffprobePath) || this.ffprobePath.includes(path.sep))) ? path.resolve(this.ffprobePath) : (this.ffprobePath || 'ffprobe')
      const proc = spawn(actualPath, ['-version'])
      let output = ''
      proc.stdout.on('data', (data) => { output += data.toString() })
      proc.on('close', () => {
        const match = output.match(/ffprobe version (\S+)/)
        resolve(match ? match[1] : 'unknown')
      })
      proc.on('error', () => resolve(null))
    })
  }

  /**
   * Check the latest available FFprobe version
   */
  async checkLatestVersion(): Promise<string | null> {
    const platform = process.platform
    try {
      if (platform === 'win32') return await this.fetchLatestVersionWindows()
      if (platform === 'darwin') return await this.fetchLatestVersionMacOS()
      if (platform === 'linux') return await this.fetchLatestVersionLinux()
    } catch (error) {
      getLoggingService().error('[MediaFileAnalyzer]', '[MediaFileAnalyzer] Failed to check latest version:', error)
    }
    return null
  }

  private fetchLatestVersionWindows(): Promise<string | null> {
    return new Promise((resolve) => {
      https.get('https://www.gyan.dev/ffmpeg/builds/release-version', (res) => {
        if (res.statusCode !== 200) { resolve(null); return }
        let data = ''; res.on('data', (c) => { data += c }); res.on('end', () => resolve(data.trim() || null))
      }).on('error', () => resolve(null))
    })
  }

  private fetchLatestVersionMacOS(): Promise<string | null> {
    return new Promise((resolve) => {
      const req = https.request('https://evermeet.cx/ffmpeg/getrelease/ffprobe/zip', { method: 'HEAD' }, (res) => {
        if (res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307) {
          const loc = res.headers.location
          if (loc) { const m = loc.match(/ffprobe-([0-9.]+)\.zip/); if (m) { resolve(m[1]); return } }
        }
        resolve(null)
      })
      req.on('error', () => resolve(null)); req.end()
    })
  }

  private fetchLatestVersionLinux(): Promise<string | null> {
    return new Promise((resolve) => {
      https.get('https://johnvansickle.com/ffmpeg/release-readme.txt', (res) => {
        if (res.statusCode !== 200) { resolve(null); return }
        let data = ''; res.on('data', (c) => { data += c }); res.on('end', () => {
          const m = data.match(/version:\s*([0-9.]+)/i); resolve(m ? m[1] : null)
        })
      }).on('error', () => resolve(null))
    })
  }

  async checkForUpdate(): Promise<{ currentVersion: string | null; latestVersion: string | null; updateAvailable: boolean }> {
    const currentVersion = await this.getVersion()
    const latestVersion = await this.checkLatestVersion()
    const updateAvailable = currentVersion && latestVersion ? latestVersion !== currentVersion : false
    return { currentVersion, latestVersion, updateAvailable }
  }

  async installFFprobe(onProgress?: (p: { stage: string; percent: number }) => void): Promise<{ success: boolean; error?: string; path?: string }> {
    const downloadInfo = this.getDownloadInfo()
    if (!downloadInfo) return { success: false, error: 'Unsupported platform' }
    const ffprobeDir = path.join(app.getPath('userData'), 'ffprobe')
    const finalPath = this.getBundledFFprobePath()
    try {
      mkdirSync(ffprobeDir, { recursive: true })
      const archivePath = path.join(ffprobeDir, 'download' + (downloadInfo.isZip ? '.zip' : '.tar.xz'))
      await this.downloadFile(downloadInfo.url, archivePath, (p) => onProgress?.({ stage: 'Downloading...', percent: Math.round(p) }))
      // Simple extraction implementation for brevity in this refactor
      const zip = new AdmZip(archivePath)
      zip.extractAllTo(ffprobeDir, true)
      this.ffprobePath = finalPath
      this.ffprobeChecked = true
      return { success: true, path: finalPath }
    } catch (e) {
      return { success: false, error: getErrorMessage(e) }
    }
  }

  private getDownloadInfo() {
    if (process.platform === 'win32') return { url: 'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip', isZip: true }
    if (process.platform === 'darwin') return { url: 'https://evermeet.cx/ffmpeg/getrelease/ffprobe/zip', isZip: true }
    return null
  }

  private async downloadFile(url: string, dest: string, onProgress: (p: number) => void): Promise<void> {
    return new Promise((resolve, reject) => {
      https.get(url, (res) => {
        const total = parseInt(res.headers['content-length'] || '0', 10)
        let downloaded = 0
        const file = createWriteStream(dest)
        res.on('data', (c) => { downloaded += c.length; if (total) onProgress((downloaded / total) * 100) })
        pipeline(res, file).then(() => resolve()).catch(reject)
      }).on('error', reject)
    })
  }

  async uninstallFFprobe(): Promise<boolean> {
    const p = this.getBundledFFprobePath()
    try { if (fs.existsSync(p)) fs.unlinkSync(p); this.ffprobePath = null; this.ffprobeChecked = false; return true }
    catch (error) { throw error }
  }

  async isBundledVersion(): Promise<boolean> {
    if (!this.ffprobePath) await this.isAvailable()
    return this.ffprobePath === this.getBundledFFprobePath()
  }

  /**
   * Extract embedded artwork from an audio file
   */
  async extractArtwork(audioFilePath: string, outputPath: string): Promise<boolean> {
    if (!this.ffprobePath) await this.isAvailable()
    if (!this.ffprobePath) return false

    try {
      const sanitizedInput = this.sanitizePath(audioFilePath)
      const sanitizedOutput = this.sanitizePath(outputPath)

      // Derive ffmpeg path from ffprobe path
      const ffmpegPath = this.ffprobePath.replace(/ffprobe(\.exe)?$/i, (match) => {
        return match.toLowerCase().includes('.exe') ? 'ffmpeg.exe' : 'ffmpeg'
      })

      const actualFFmpegPath = (fs.existsSync(ffmpegPath) || ffmpegPath.includes(path.sep)) ? path.resolve(ffmpegPath) : 'ffmpeg'

      return new Promise((resolve) => {
        const outputDir = path.dirname(sanitizedOutput)
        if (!fs.existsSync(outputDir)) mkdirSync(outputDir, { recursive: true })

        const args = ['-i', `file:${sanitizedInput}`, '-an', '-vcodec', 'copy', '-y', sanitizedOutput]
        const proc = spawn(actualFFmpegPath, args, { stdio: 'ignore', timeout: 30000 })

        proc.on('close', (code) => {
          if (code === 0 && fs.existsSync(sanitizedOutput) && fs.statSync(sanitizedOutput).size > 0) resolve(true)
          else { if (fs.existsSync(sanitizedOutput)) fs.unlinkSync(sanitizedOutput); resolve(false) }
        })
        proc.on('error', () => resolve(false))
      })
    } catch (error) {
      getLoggingService().error('[MediaFileAnalyzer]', 'Failed to extract artwork:', error)
      return false
    }
  }

  canInstall(): boolean {
    return process.arch === 'x64' && (process.platform === 'win32' || process.platform === 'darwin' || process.platform === 'linux')
  }

  /**
   * Analyze a media file and return detailed metadata
   */
  async analyzeFile(filePath: string): Promise<FileAnalysisResult> {
    const override = this.analysisOverride.get(filePath)
    if (override) return override

    if (!await this.isAvailable()) {
      return { success: false, error: 'FFprobe not installed', filePath, audioTracks: [], subtitleTracks: [] }
    }

    if (!fs.existsSync(filePath)) {
      return { success: false, error: `File not found: ${filePath}`, filePath, audioTracks: [], subtitleTracks: [] }
    }

    try {
      const ffprobeOutput = await this.runFFprobe(filePath)
      return this.parseFFprobeOutput(filePath, ffprobeOutput)
    } catch (error: unknown) {
      return {
        success: false,
        error: getErrorMessage(error) || 'Failed to analyze file',
        filePath,
        audioTracks: [],
        subtitleTracks: [],
      }
    }
  }

  /**
   * Analyze multiple files in parallel
   */
  async analyzeFilesParallel(
    filePaths: string[],
    onProgress?: (current: number, total: number, currentFile: string) => void
  ): Promise<Map<string, FileAnalysisResult>> {
    if (!await this.isAvailable()) {
      const results = new Map<string, FileAnalysisResult>()
      for (const filePath of filePaths) {
        results.set(filePath, { success: false, error: 'FFprobe not installed', filePath, audioTracks: [], subtitleTracks: [] })
      }
      return results
    }

    try {
      const { getFFprobeWorkerPool } = await import('./FFprobeWorkerPool')
      const pool = getFFprobeWorkerPool()
      await pool.initialize(this.ffprobePath!)
      return await pool.analyzeFiles(filePaths, onProgress)
    } catch (error) {
      // Fallback
      const results = new Map<string, FileAnalysisResult>()
      for (let i = 0; i < filePaths.length; i++) {
        const filePath = filePaths[i]
        onProgress?.(i + 1, filePaths.length, path.basename(filePath))
        results.set(filePath, await this.analyzeFile(filePath))
      }
      return results
    }
  }

  /**
   * Get the current FFprobe path
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

  getBundledFFprobePath(): string {
    const userDataPath = app.getPath('userData')
    const ffprobeDir = path.join(userDataPath, 'ffprobe')
    return process.platform === 'win32' ? path.join(ffprobeDir, 'ffprobe.exe') : path.join(ffprobeDir, 'ffprobe')
  }

  private getPossibleFFprobePaths(): string[] {
    const paths: string[] = [this.getBundledFFprobePath(), 'ffprobe']
    if (process.platform === 'win32') {
      paths.push('C:\\ffmpeg\\bin\\ffprobe.exe', 'C:\\Program Files\\ffmpeg\\bin\\ffprobe.exe')
    } else if (process.platform === 'darwin') {
      paths.push('/usr/local/bin/ffprobe', '/opt/homebrew/bin/ffprobe')
    } else {
      paths.push('/usr/bin/ffprobe', '/usr/local/bin/ffprobe')
    }
    return paths
  }

  /**
   * Sanitize a file path to prevent command injection and ensure it's absolute
   */
  private sanitizePath(filePath: string): string {
    if (filePath.includes('\0')) {
      throw new Error('Invalid path: contains null bytes')
    }
    return path.resolve(filePath)
  }

  private async testFFprobe(probePath: string): Promise<boolean> {
    return new Promise((resolve) => {
      const actualPath = (probePath && (path.isAbsolute(probePath) || probePath.includes(path.sep))) ? path.resolve(probePath) : probePath
      const proc = spawn(actualPath, ['-version'], { stdio: 'ignore', timeout: 5000 })
      proc.on('close', (code) => resolve(code === 0))
      proc.on('error', () => resolve(false))
    })
  }

  private async runFFprobe(filePath: string): Promise<FFprobeOutput> {
    const sanitizedPath = this.sanitizePath(filePath)
    return new Promise((resolve, reject) => {
      const args = ['-v', 'quiet', '-print_format', 'json', '-show_format', '-show_streams', `file:${sanitizedPath}`]
      const actualPath = (this.ffprobePath && (path.isAbsolute(this.ffprobePath) || this.ffprobePath.includes(path.sep))) ? path.resolve(this.ffprobePath) : (this.ffprobePath || 'ffprobe')
      const proc = spawn(actualPath, args, { stdio: ['ignore', 'pipe', 'pipe'], timeout: 60000 })
      let stdout = ''
      let stderr = ''
      proc.stdout.on('data', (data) => { stdout += data.toString() })
      proc.stderr.on('data', (data) => { stderr += data.toString() })
      proc.on('close', (code) => {
        if (code === 0 && stdout) {
          try { resolve(JSON.parse(stdout) as FFprobeOutput) }
          catch (e) { reject(new Error('Failed to parse FFprobe output')) }
        } else {
          reject(new Error(stderr || `FFprobe exited with code ${code}`))
        }
      })
      proc.on('error', (error) => reject(error))
    })
  }

  private parseFFprobeOutput(filePath: string, output: FFprobeOutput): FileAnalysisResult {
    const result: FileAnalysisResult = { success: true, filePath, audioTracks: [], subtitleTracks: [] }
    if (output.format) {
      result.container = output.format.format_name
      result.fileSize = output.format.size ? parseInt(output.format.size, 10) : undefined
      result.duration = output.format.duration ? Math.round(parseFloat(output.format.duration) * 1000) : undefined
      result.overallBitrate = output.format.bit_rate ? Math.round(parseInt(output.format.bit_rate, 10) / 1000) : undefined
      
      if (output.format.tags) {
        const t = output.format.tags as any
        result.embeddedMetadata = {
          title: t.title || t.TITLE,
          year: t.date ? parseInt(t.date, 10) : undefined,
          showName: t.show || t.SHOW,
          seasonNumber: t.season_number ? parseInt(t.season_number, 10) : undefined,
          episodeNumber: t.episode_sort ? parseInt(t.episode_sort, 10) : undefined,
        }
      }
    }

    for (const stream of output.streams) {
      if (stream.codec_type === 'video' && !result.video) {
        result.video = {
          index: stream.index,
          codec: stream.codec_name || 'unknown',
          width: stream.width || 0,
          height: stream.height || 0,
          bitrate: stream.bit_rate ? Math.round(parseInt(stream.bit_rate, 10) / 1000) : undefined,
          frameRate: stream.avg_frame_rate ? (() => {
            const parts = stream.avg_frame_rate.split('/')
            if (parts.length === 2) {
              const num = parseFloat(parts[0])
              const den = parseFloat(parts[1])
              return den !== 0 ? num / den : undefined
            }
            return parseFloat(stream.avg_frame_rate) || undefined
          })() : undefined,
          hdrFormat: this.detectHdrFormat(stream),
          bitDepth: stream.bits_per_raw_sample ? parseInt(stream.bits_per_raw_sample, 10) : undefined,
          profile: stream.profile,
          colorSpace: stream.color_space,
        }
      } else if (stream.codec_type === 'audio') {
        result.audioTracks.push({
          index: stream.index,
          codec: stream.codec_name || 'unknown',
          channels: stream.channels || 2,
          bitrate: stream.bit_rate ? Math.round(parseInt(stream.bit_rate, 10) / 1000) : undefined,
          isDefault: stream.disposition?.default === 1,
          hasObjectAudio: this.detectObjectAudio(stream),
          language: stream.tags?.language,
          profile: stream.profile,
          sampleRate: stream.sample_rate ? parseInt(stream.sample_rate, 10) : undefined,
        })
      } else if (stream.codec_type === 'subtitle') {
        result.subtitleTracks.push({
          index: stream.index,
          codec: stream.codec_name || 'unknown',
          language: stream.tags?.language,
          title: stream.tags?.title,
          isDefault: stream.disposition?.default === 1,
          isForced: stream.disposition?.forced === 1,
        })
      }
    }
    return result
  }

  private detectHdrFormat(stream: FFprobeStream): string | undefined {
    const colorTransfer = stream.color_transfer?.toLowerCase() || ''
    const colorPrimaries = stream.color_primaries?.toLowerCase() || ''
    const colorSpace = stream.color_space?.toLowerCase() || ''

    if (
      (colorTransfer.includes('smpte2084') || colorTransfer.includes('pq')) &&
      (colorPrimaries.includes('bt2020') || colorSpace.includes('bt2020'))
    ) {
      return 'HDR10'
    }

    if (colorTransfer.includes('arib-std-b67') || colorTransfer.includes('hlg')) {
      return 'HLG'
    }

    return undefined
  }

  private detectObjectAudio(stream: FFprobeStream): boolean {
    const codec = stream.codec_name?.toLowerCase() || ''
    const profile = stream.profile?.toLowerCase() || ''
    const title = (stream.tags as any)?.title?.toLowerCase() || ''

    if (codec === 'truehd' && (profile.includes('atmos') || title.includes('atmos'))) {
      return true
    }
    if (codec === 'eac3' && (profile.includes('atmos') || title.includes('atmos'))) {
      return true
    }
    if (codec.includes('dts') && (profile.includes('x') || title.includes('dts:x') || title.includes('dts-x'))) {
      return true
    }

    return false
  }
}
