import { spawn } from 'child_process'
import type { ChildProcess } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'
import AdmZip from 'adm-zip'
import * as https from 'https'
import * as http from 'http'
import * as crypto from 'crypto'
import { app } from 'electron'
import { createWriteStream, mkdirSync, copyFileSync, readdirSync, readFileSync, rmSync, chmodSync } from 'fs'
import { pipeline } from 'stream/promises'
import { execFile } from 'child_process'
import { getErrorMessage } from '@main/services/utils/errorUtils'
import {
  normalizeVideoCodec,
  normalizeResolution,
  normalizeAudioCodec,
} from '@main/services/MediaNormalizer'
import type { MediaMetadata } from '@main/providers/base/MediaProvider'
import type { FileAnalysisResult, AnalyzedAudioStream, AnalyzedSubtitleStream, EmbeddedMetadataTags, AnalyzedVideoStream } from '@main/workers/ffprobe-worker'
import { getLoggingService } from '@main/services/LoggingService'
import { PathUtils } from '@main/services/utils/PathUtils'
import { detectHdrFormat } from '@main/types/mediaContracts'
import type { HdrFormat } from '@main/types/mediaContracts'
import { parsePacketByteOutput, toStreamByteMap } from '@main/services/transcoding/StreamByteAccounting'

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
  private readonly deepProcesses = new Map<string, ChildProcess>()
  private ffprobePath: string | null = null
  private ffmpegPath: string | null = null
  private ffprobeChecked: boolean = false
  private availabilityPromise: Promise<boolean> | null = null
  private cachedVersion: string | null | undefined = undefined
  private cachedIsBundledVersion: boolean | undefined = undefined

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
      const actualPath = PathUtils.resolveExecutablePath(this.ffprobePath || 'ffprobe')
      const proc = spawn(actualPath, ['-version'])
      let output = ''
      proc.stdout.on('data', (data) => { output += data.toString() })
      proc.on('close', () => {
        const match = output.match(/ffprobe version (\S+)/)
        resolve(match ? (match[1].match(/^\d+(?:\.\d+){0,3}/)?.[0] || match[1]) : 'unknown')
      })
      proc.on('error', () => resolve(null))
    })

    return this.cachedVersion || null
  }

  /**
   * Check if FFprobe and FFmpeg are available on the system
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
    const possibleFFprobePaths = PathUtils.getPossibleExecutablePaths('ffprobe', this.getBundledPath('ffprobe'))
    const possibleFFmpegPaths = PathUtils.getPossibleExecutablePaths('ffmpeg', this.getBundledPath('ffmpeg'))

    // Find ffprobe
    for (const probePath of possibleFFprobePaths) {
      if (await this.testBinary(probePath)) {
        this.ffprobePath = probePath
        this.ffprobeChecked = true
        break
      }
    }

    // Find ffmpeg
    for (const ffmpegPath of possibleFFmpegPaths) {
      if (await this.testBinary(ffmpegPath)) {
        this.ffmpegPath = ffmpegPath
        break
      }
    }

    if (this.ffprobePath) {
      getLoggingService().info('[MediaFileAnalyzer]', `Found FFprobe at: ${this.ffprobePath}`)
    }
    if (this.ffmpegPath) {
      getLoggingService().info('[MediaFileAnalyzer]', `Found FFmpeg at: ${this.ffmpegPath}`)
    }

    this.ffprobeChecked = true
    return !!this.ffprobePath
  }

  private async testBinary(binaryPath: string): Promise<boolean> {
    return new Promise((resolve) => {
      try {
        const actualPath = PathUtils.resolveExecutablePath(binaryPath)
        const proc = spawn(actualPath, ['-version'], { stdio: 'ignore', timeout: 5000 })
        proc.on('close', (code) => resolve(code === 0))
        proc.on('error', (err: NodeJS.ErrnoException) => {
          if (err.code === 'ENOENT') {
            getLoggingService().debug('[MediaFileAnalyzer]', `Failed to spawn ${actualPath}: ${err.message}`)
          } else {
            getLoggingService().warn('[MediaFileAnalyzer]', `Failed to spawn ${actualPath}: ${err.message}`)
          }
          resolve(false)
        })
      } catch (err) {
        getLoggingService().warn('[MediaFileAnalyzer]', `Invalid path ${binaryPath}`)
        resolve(false)
      }
    })
  }

  getBundledPath(binaryName: string): string {
    const isWin = process.platform === 'win32'
    const ext = isWin ? '.exe' : ''
    const userDataPath = app.getPath('userData')
    return path.join(userDataPath, 'ffprobe', binaryName + ext) // Bundled usually installs together
  }

  getBundledFFprobePath(): string {
    return this.getBundledPath('ffprobe')
  }

  getFFmpegPath(): string | null {
    return this.ffmpegPath
  }

  /**
   * Perform deep analysis of a media file (bitrate variance, volume peaks)
   */
  async deepAnalyzeFile(filePath: string, options: { scanBitrate?: boolean; detectVolume?: boolean; requestId?: string } = {}): Promise<Partial<FileAnalysisResult>> {
    if (!await this.isAvailable()) throw new Error('FFmpeg/FFprobe not available')
    
    const results: Partial<FileAnalysisResult> = { success: true, filePath, audioTracks: [], subtitleTracks: [], deepAnalysis: {} }
    const deepAnalysis = results.deepAnalysis ?? (results.deepAnalysis = {})
    const startTime = Date.now()

    if (options.detectVolume && this.ffmpegPath) {
      const vol = await this.detectAudioVolume(filePath, options.requestId)
        results.audioTracks = [{ index: 0, codec: 'unknown', channels: 0, isDefault: false, hasObjectAudio: false, ...vol }] // Simplified for first track for now
    }

    if (options.scanBitrate) {
      const bitrate = await this.analyzeBitrateVariance(filePath, options.requestId)
      results.deepAnalysis = { ...results.deepAnalysis, ...bitrate }
    }

    deepAnalysis.scanDurationMs = Date.now() - startTime
    return results
  }

  cancelDeepAnalysis(requestId: string): void {
    this.deepProcesses.get(requestId)?.kill()
    this.deepProcesses.delete(requestId)
  }

  private async detectAudioVolume(filePath: string, requestId?: string): Promise<{ peakVolumeDB: number; meanVolumeDB: number }> {
    const sanitizedPath = PathUtils.sanitizeAbsolutePath(filePath)
    return new Promise((resolve, reject) => {
      const args = ['-i', `file:${sanitizedPath}`, '-af', 'volumedetect', '-vn', '-sn', '-dn', '-f', 'null', '-']
      const proc = spawn(this.ffmpegPath || 'ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'], timeout: 300000 })
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

  private async analyzeBitrateVariance(filePath: string, requestId?: string): Promise<{ peakBitrate: number; avgBitrate: number; bitrateVariance: number; isVariableBitrate: boolean }> {
    const sanitizedPath = PathUtils.sanitizeAbsolutePath(filePath)
    return new Promise((resolve, reject) => {
      // Use ffprobe to get packet sizes for the first video stream
      const args = ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'packet=size,duration_time', '-of', 'compact=p=0:nk=1', `file:${sanitizedPath}`]
      const proc = spawn(this.ffprobePath || 'ffprobe', args, { stdio: ['ignore', 'pipe', 'pipe'], timeout: 300000 })
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
          const [sizeStr, durStr] = line.split('|')
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
    const updateAvailable = currentVersion && latestVersion ? this.compareVersions(latestVersion, currentVersion) > 0 : false
    getLoggingService().info('[MediaFileAnalyzer]', `FFmpeg update check: current=${currentVersion || 'unavailable'}, latest=${latestVersion || 'unavailable'}, available=${updateAvailable}`)
    return { currentVersion, latestVersion, updateAvailable }
  }

  private normalizeVersion(version: string): string {
    return version.match(/^\d+(?:\.\d+)*/)?.[0] || version
  }

  private compareVersions(a: string, b: string): number {
    const left = this.normalizeVersion(a).split('.').map(Number)
    const right = this.normalizeVersion(b).split('.').map(Number)
    for (let i = 0; i < Math.max(left.length, right.length); i++) {
      const difference = (left[i] || 0) - (right[i] || 0)
      if (difference !== 0) return difference > 0 ? 1 : -1
    }
    return 0
  }

  async installFFprobe(onProgress?: (p: { stage: string; percent: number }) => void): Promise<{ success: boolean; error?: string; path?: string }> {
    const downloadInfo = this.getDownloadInfo()
    if (!downloadInfo) {
      const error = `FFmpeg installation is unsupported on ${process.platform}`
      getLoggingService().error('[MediaFileAnalyzer]', error)
      return { success: false, error }
    }
    const ffprobeDir = path.join(app.getPath('userData'), 'ffprobe')
    const tempDir = path.join(app.getPath('userData'), 'ffprobe-temp')
    try {
      mkdirSync(ffprobeDir, { recursive: true })
      rmSync(tempDir, { recursive: true, force: true })
      mkdirSync(tempDir, { recursive: true })
      const archivePath = path.join(tempDir, 'download' + (downloadInfo.isZip ? '.zip' : '.tar.xz'))
      await this.downloadFile(downloadInfo.url, archivePath, (p) => onProgress?.({ stage: 'Downloading...', percent: Math.round(p) }))
      const checksumText = await this.downloadText(downloadInfo.checksumUrl)
      const expectedChecksum = checksumText.match(/\b[a-f0-9]{64}\b/i)?.[0]?.toLowerCase()
      if (!expectedChecksum) throw new Error('Vendor did not provide a SHA-256 checksum for the FFmpeg archive')
      const actualChecksum = crypto.createHash('sha256').update(readFileSync(archivePath)).digest('hex').toLowerCase()
      if (actualChecksum !== expectedChecksum) throw new Error('FFmpeg archive SHA-256 verification failed')
      if (downloadInfo.isZip) {
        const zip = new AdmZip(archivePath)
        zip.extractAllTo(tempDir, true)
      } else {
        await new Promise<void>((resolve, reject) => execFile('tar', ['-xJf', archivePath, '-C', tempDir], (error) => error ? reject(error) : resolve()))
      }
      const findExtracted = (name: string): string | null => {
        const visit = (dir: string): string | null => {
          for (const entry of readdirSync(dir, { withFileTypes: true })) {
            const candidate = path.join(dir, entry.name)
            if (entry.isDirectory()) { const found = visit(candidate); if (found) return found }
            else if (entry.name.toLowerCase() === `${name}.exe` || entry.name.toLowerCase() === name) return candidate
          }
          return null
        }
        return visit(tempDir)
      }
      const extractedProbe = findExtracted('ffprobe')
      const extractedFfmpeg = findExtracted('ffmpeg')
      if (!extractedProbe) throw new Error('Downloaded archive did not contain ffprobe')
      const finalProbePath = this.getBundledFFprobePath()
      copyFileSync(extractedProbe, finalProbePath)
      if (extractedFfmpeg) copyFileSync(extractedFfmpeg, this.getBundledPath('ffmpeg'))
      if (process.platform !== 'win32') {
        chmodSync(finalProbePath, 0o755)
        if (extractedFfmpeg) chmodSync(this.getBundledPath('ffmpeg'), 0o755)
      }
      const binarySize = readFileSync(finalProbePath).byteLength
      if (binarySize < 1_000_000) throw new Error(`FFprobe binary is suspiciously small (${binarySize} bytes)`)
      if (!await this.verifyInstalledBinary(finalProbePath, 'ffprobe')) throw new Error('Installed FFprobe failed verification')
      getLoggingService().info('[MediaFileAnalyzer]', `FFprobe SHA-256: ${crypto.createHash('sha256').update(readFileSync(finalProbePath)).digest('hex')}`)
      this.ffprobePath = this.getBundledFFprobePath()
      this.ffmpegPath = extractedFfmpeg ? this.getBundledPath('ffmpeg') : this.ffmpegPath
      this.ffprobeChecked = true
      this.cachedVersion = undefined
      this.cachedIsBundledVersion = undefined
      getLoggingService().info('[MediaFileAnalyzer]', `Installed FFmpeg tools: ffprobe=${this.ffprobePath}, ffmpeg=${this.ffmpegPath || 'not included'}`)
      rmSync(tempDir, { recursive: true, force: true })
      return { success: true, path: this.ffprobePath }
    } catch (e) {
      const error = getErrorMessage(e)
      getLoggingService().error('[MediaFileAnalyzer]', 'FFmpeg tool installation failed:', error)
      rmSync(tempDir, { recursive: true, force: true })
      return { success: false, error }
    }
  }

  private verifyInstalledBinary(binaryPath: string, expectedName: string): Promise<boolean> {
    return new Promise(resolve => {
      const proc = spawn(binaryPath, ['-version'], { stdio: ['ignore', 'pipe', 'pipe'], timeout: 5000 })
      let output = ''
      proc.stdout?.on('data', data => { output += data.toString() })
      proc.stderr?.on('data', data => { output += data.toString() })
      proc.on('close', code => resolve(code === 0 && output.toLowerCase().includes(expectedName)))
      proc.on('error', () => resolve(false))
    })
  }

  private getDownloadInfo(): { url: string; checksumUrl: string; isZip: boolean } | null {
    if (process.platform === 'win32') return { url: 'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip', checksumUrl: 'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip.sha256', isZip: true }
    return null
  }

  private async downloadText(url: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const request = (requestUrl: string, redirects = 0): void => {
        if (redirects > 5) { reject(new Error('Too many redirects')); return }
        const client = requestUrl.startsWith('https:') ? https : http
        client.get(requestUrl, response => {
          if ([301, 302, 303, 307, 308].includes(response.statusCode || 0) && response.headers.location) { response.resume(); request(new URL(response.headers.location, requestUrl).toString(), redirects + 1); return }
          if (response.statusCode !== 200) { response.resume(); reject(new Error(`Checksum download failed with status ${response.statusCode}`)); return }
          let body = ''; response.setEncoding('utf8'); response.on('data', chunk => { body += chunk }); response.on('end', () => resolve(body))
        }).on('error', reject)
      }
      request(url)
    })
  }

  private async downloadFile(url: string, dest: string, onProgress: (p: number) => void): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = (requestUrl: string, redirects = 0): void => {
        if (redirects > 5) { reject(new Error('Too many redirects')); return }
        const client = requestUrl.startsWith('https:') ? https : http
        client.get(requestUrl, (res) => {
          if ([301, 302, 303, 307, 308].includes(res.statusCode || 0) && res.headers.location) {
            res.resume()
            request(new URL(res.headers.location, requestUrl).toString(), redirects + 1)
            return
          }
          if (res.statusCode !== 200) { res.resume(); reject(new Error(`Download failed with status ${res.statusCode}`)); return }
        const total = parseInt(res.headers['content-length'] || '0', 10)
        let downloaded = 0
        const file = createWriteStream(dest)
        res.on('data', (c) => { downloaded += c.length; if (total) onProgress((downloaded / total) * 100) })
        pipeline(res, file).then(() => resolve()).catch(reject)
        }).on('error', reject)
      }
      request(url)
    })
  }

  async uninstallFFprobe(): Promise<boolean> {
    const p = this.getBundledFFprobePath()
    if (fs.existsSync(p)) fs.unlinkSync(p); this.ffprobePath = null; this.ffprobeChecked = false; return true
  }

  async isBundledVersion(): Promise<boolean> {
    if (this.cachedIsBundledVersion !== undefined) return this.cachedIsBundledVersion
    if (!this.ffprobePath) await this.isAvailable()
    this.cachedIsBundledVersion = this.ffprobePath === this.getBundledFFprobePath()
    return this.cachedIsBundledVersion
  }

  /**
   * Extract embedded artwork from an audio file
   */
  async extractArtwork(audioFilePath: string, outputPath: string): Promise<boolean> {
    if (!this.ffprobePath || !this.ffmpegPath) await this.isAvailable()
    if (!this.ffmpegPath) throw new Error('FFmpeg is required to extract artwork')

    try {
      const sanitizedInput = PathUtils.sanitizeAbsolutePath(audioFilePath)
      const sanitizedOutput = PathUtils.sanitizeAbsolutePath(outputPath)
      const actualFFmpegPath = PathUtils.resolveExecutablePath(this.ffmpegPath)

      return new Promise((resolve, reject) => {
        const outputDir = path.dirname(sanitizedOutput)
        if (!fs.existsSync(outputDir)) mkdirSync(outputDir, { recursive: true })

        const args = ['-i', `file:${sanitizedInput}`, '-an', '-vcodec', 'copy', '-y', sanitizedOutput]
        const proc = spawn(actualFFmpegPath, args, { stdio: 'ignore', timeout: 30000 })

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

  canInstall(): boolean {
    return process.arch === 'x64' && (process.platform === 'win32' || process.platform === 'darwin' || process.platform === 'linux')
  }

  /**
   * Analyze a media file and return detailed metadata
   */
  async analyzeFile(filePath: string): Promise<FileAnalysisResult> {
    if (!await this.isAvailable()) {
      throw new Error('FFprobe is not installed or available on this system')
    }

    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`)
    }

    const ffprobeOutput = await this.runFFprobe(filePath)
    return this.parseFFprobeOutput(filePath, ffprobeOutput)
  }

  async measureStreamBytes(filePath: string): Promise<Record<number, number>> {
    const sanitizedPath = PathUtils.sanitizeAbsolutePath(filePath)
    const actualPath = PathUtils.resolveExecutablePath(this.ffprobePath || 'ffprobe')
    return new Promise((resolve, reject) => {
      const args = [
        '-v', 'error',
        '-show_entries', 'packet=stream_index,size',
        '-of', 'csv=p=0',
        `file:${sanitizedPath}`,
      ]
      const proc = spawn(actualPath, args, { stdio: ['ignore', 'pipe', 'pipe'] })
      let stdout = ''
      let stderr = ''
      const timeout = setTimeout(() => {
        proc.kill('SIGKILL')
        reject(new Error('FFprobe stream byte measurement timed out after 60 seconds'))
      }, 60_000)
      proc.stdout.on('data', data => { stdout += data.toString() })
      proc.stderr.on('data', data => { stderr += data.toString() })
      proc.once('error', error => {
        clearTimeout(timeout)
        reject(error)
      })
      proc.once('close', code => {
        clearTimeout(timeout)
        if (code !== 0) {
          reject(new Error(stderr || `FFprobe stream byte measurement exited with code ${code}`))
          return
        }
        try {
          resolve(toStreamByteMap(parsePacketByteOutput(stdout)))
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
        results.set(filePath, { success: false, error: 'FFprobe not installed', filePath, audioTracks: [], subtitleTracks: [] })
      }
      return results
    }

    const { getFFprobeWorkerPool } = await import('./FFprobeWorkerPool')
    const pool = getFFprobeWorkerPool()
    await pool.initialize(this.ffprobePath!)
    return await pool.analyzeFiles(filePaths, onProgress, signal)
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

  private async runFFprobe(filePath: string): Promise<FFprobeOutput> {
    const sanitizedPath = PathUtils.sanitizeAbsolutePath(filePath)
    return new Promise((resolve, reject) => {
      const args = ['-v', 'quiet', '-print_format', 'json', '-show_format', '-show_streams', `file:${sanitizedPath}`]
      const actualPath = PathUtils.resolveExecutablePath(this.ffprobePath || 'ffprobe')
      const proc = spawn(actualPath, args, { stdio: ['ignore', 'pipe', 'pipe'], timeout: 60000 })
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

  private parseFFprobeOutput(filePath: string, output: FFprobeOutput): FileAnalysisResult {
    const result: FileAnalysisResult = { success: true, filePath, audioTracks: [], subtitleTracks: [] }
    if (output.format) {
      result.container = output.format.format_name
      result.fileSize = output.format.size ? parseInt(output.format.size, 10) : undefined
      result.duration = output.format.duration ? Math.round(parseFloat(output.format.duration) * 1000) : undefined
      result.overallBitrate = output.format.bit_rate ? Math.round(parseInt(output.format.bit_rate, 10) / 1000) : undefined
      
      if (output.format.tags) {
        const t = output.format.tags
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
          colorTransfer: stream.color_transfer,
          colorPrimaries: stream.color_primaries,
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
          title: stream.tags?.title,
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

  private detectHdrFormat(stream: FFprobeStream): HdrFormat {
    const sideData = stream.side_data_list?.map(item => item.side_data_type.toLowerCase()) ?? []
    return detectHdrFormat({
      colorTransfer: stream.color_transfer,
      colorPrimaries: stream.color_primaries,
      colorSpace: stream.color_space,
      sideDataTypes: sideData,
      profile: stream.profile
    })
  }

  private detectObjectAudio(stream: FFprobeStream): boolean {
    const codec = stream.codec_name?.toLowerCase() || ''
    const profile = stream.profile?.toLowerCase() || ''
    const title = stream.tags?.title?.toLowerCase() || ''

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
