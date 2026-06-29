import { spawn } from 'child_process'
import * as fs from 'fs/promises'
import { existsSync } from 'fs'
import * as path from 'path'
import { getDatabase } from '@main/database/BetterSQLiteService'
import { getLoggingService } from '@main/services/LoggingService'
import { getGeminiService } from '@main/services/GeminiService'
import { getMediaFileAnalyzer } from '@main/services/MediaFileAnalyzer'
import { APP_CONFIG } from '@main/config'

export interface TranscodeOptions {
  targetCodec?: 'av1' | 'hevc'
  preserveSubtitles?: boolean
  preserveAllAudio?: boolean
  overwriteOriginal?: boolean
  priority?: 'low' | 'normal' | 'high'
}

export interface TranscodeProgress {
  percent: number
  fps?: number
  eta?: string
  status: 'initializing' | 'encoding' | 'muxing' | 'verifying' | 'complete' | 'failed' | 'cancelled'
  error?: string
}

export interface TranscodingParams {
  summary: string
  handbrakeArgs: string[]
  mkvmergeArgs?: string[]
  expectedSizeReduction?: string
  warnings?: string[]
}

/**
 * TranscodingService
 *
 * Manages external transcoding tools (Handbrake CLI, MKVToolNix)
 * and uses Gemini AI to generate per-video optimized encoding parameters.
 */
export class TranscodingService {
  private handbrakePath: string | null = null
  private mkvmergePath: string | null = null
  private ffmpegPath: string | null = null
  private availabilityOverride: { handbrake?: boolean; mkvtoolnix?: boolean; ffmpeg?: boolean } | null = null
  private activeJobs = new Map<number, AbortController>()
  private initializedPromise: Promise<void> | null = null

  constructor() {
    // Initialization is deferred until first use to allow DB to be ready
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

    const [hb, mkv] = await Promise.all([
      db.config.getSetting('handbrake_path'),
      db.config.getSetting('mkvmerge_path')
    ])

    this.handbrakePath = hb || (process.platform === 'win32' ? 'HandBrakeCLI.exe' : 'HandBrakeCLI')
    this.mkvmergePath = mkv || (process.platform === 'win32' ? 'mkvmerge.exe' : 'mkvmerge')
    
    // Fallback FFmpeg from MediaFileAnalyzer
    const analyzer = getMediaFileAnalyzer()
    this.ffmpegPath = analyzer.getFFprobePath()?.replace(/ffprobe/i, 'ffmpeg') || 'ffmpeg'
    
    getLoggingService().debug('[TranscodingService]', `Paths initialized - Handbrake: ${this.handbrakePath}, MKVMerge: ${this.mkvmergePath}`)
  }

  /**
   * For testing: Override tool availability
   */
  setAvailabilityOverride(override: { handbrake?: boolean; mkvtoolnix?: boolean; ffmpeg?: boolean } | null): void {
    this.availabilityOverride = override
  }

  /**
   * Check which tools are available on the system
   */
  async checkAvailability(): Promise<{ 
    handbrake: boolean; 
    mkvtoolnix: boolean;
    ffmpeg: boolean;
  }> {
    await this.ensureInitialized()

    if (this.availabilityOverride) {
      return {
        handbrake: this.availabilityOverride.handbrake ?? false,
        mkvtoolnix: this.availabilityOverride.mkvtoolnix ?? false,
        ffmpeg: this.availabilityOverride.ffmpeg ?? false
      }
    }

    const [hb, mkv, ff] = await Promise.all([
      this.testTool(this.handbrakePath || 'HandBrakeCLI', ['--version']),
      this.testTool(this.mkvmergePath || 'mkvmerge', ['--version']),
      this.testTool(this.ffmpegPath || 'ffmpeg', ['-version'])
    ])

    return { 
      handbrake: hb, 
      mkvtoolnix: mkv,
      ffmpeg: ff
    }
  }


  private sanitizePath(filePath: string): string {
    if (filePath.includes('\0')) {
      throw new Error('Invalid path: contains null bytes')
    }
    return path.resolve(filePath)
  }

  private resolveExecutablePath(toolPath: string): string {
    if (!toolPath) return toolPath
    if (toolPath.includes('\0')) {
      throw new Error('Invalid path: contains null bytes')
    }
    if (path.isAbsolute(toolPath) || toolPath.includes(path.sep)) {
      return path.resolve(toolPath)
    }
    return toolPath
  }

  private async testTool(toolPath: string, args: string[]): Promise<boolean> {
    return new Promise((resolve) => {
      try {
        const actualPath = this.resolveExecutablePath(toolPath)
        const proc = spawn(actualPath, args, { stdio: 'ignore' })
        proc.on('close', (code) => resolve(code === 0))
        proc.on('error', () => resolve(false))
      } catch (e) {
        resolve(false)
      }
    })
  }

  /**
   * Cancel an active transcode job
   */
  cancelTranscode(mediaItemId: number): void {
    const controller = this.activeJobs.get(mediaItemId)
    if (controller) {
      controller.abort()
      this.activeJobs.delete(mediaItemId)
      getLoggingService().info('[TranscodingService]', `Cancelled transcode for item ${mediaItemId}`)
    }
  }

  /**
   * Get optimized transcoding parameters from Gemini
   */
  async getTranscodeParameters(filePath: string, options: TranscodeOptions = {}): Promise<TranscodingParams> {
    const analyzer = getMediaFileAnalyzer()
    const analysis = await analyzer.analyzeFile(filePath)
    if (!analysis.success) throw new Error(`Failed to analyze file: ${analysis.error}`)

    const gemini = getGeminiService()
    if (!gemini.isConfigured()) {
      throw new Error('Gemini AI is not configured. Please add your API key in settings.')
    }

    const targetCodec = options.targetCodec || 'av1'
    
    const prompt = `Analyze this media file and provide optimized ${targetCodec.toUpperCase()} transcoding parameters for HandBrakeCLI.
    
    File Analysis:
    ${JSON.stringify(analysis, null, 2)}
    
    Constraints:
    - Target: Maximum space saving with transparent quality.
    - Preference: 10-bit encoding if source is 10-bit or HDR.
    
    Return a JSON object with:
    {
      "summary": "Brief explanation",
      "videoCodec": "svt_av1" | "svt_av1_10bit" | "x265" | "x265_10bit" | "x264",
      "crf": 20, // number between 0 and 51
      "preset": "fast", // preset string, e.g., fast, medium, slow
      "expectedSizeReduction": "e.g. 60%",
      "warnings": []
    }
    
    Important: Do NOT output raw command-line arguments in this response.`

    const systemPrompt = APP_CONFIG.ai.compressionAdvice + `
    Additional Requirement: 
    - Output must be valid JSON only. 
    - Focus on HandBrakeCLI specifically.`

    const response = await gemini.sendMessage({
      messages: [{ role: 'user', content: prompt }],
      system: systemPrompt
    })

    try {
      const jsonStr = response.text.replace(/```json\n?|\n?```/g, '').trim()
      const data = JSON.parse(jsonStr)
      
      const summary = typeof data.summary === 'string' ? data.summary : 'AI optimized transcode'
      
      const allowedVideoCodecs = ['svt_av1', 'svt_av1_10bit', 'x265', 'x265_10bit', 'x264']
      const videoCodec = allowedVideoCodecs.includes(data.videoCodec)
        ? data.videoCodec
        : (targetCodec === 'hevc' ? 'x265' : 'svt_av1')
        
      const crf = (typeof data.crf === 'number' && data.crf >= 0 && data.crf <= 51)
        ? data.crf
        : 22
        
      const allowedPresets = ['ultrafast', 'superfast', 'veryfast', 'faster', 'fast', 'medium', 'slow', 'slower', 'veryslow', 'placebo']
      const preset = allowedPresets.includes(data.preset)
        ? data.preset
        : 'fast'

      // Build safe handbrakeArgs array
      const handbrakeArgs: string[] = []
      
      handbrakeArgs.push('--encoder', videoCodec)
      handbrakeArgs.push('--quality', crf.toString())
      handbrakeArgs.push('--encoder-preset', preset)

      if (options.preserveAllAudio) {
        handbrakeArgs.push('--all-audio')
      } else {
        handbrakeArgs.push('--audio', '1')
      }

      if (options.preserveSubtitles) {
        handbrakeArgs.push('--all-subtitles')
      }

      // Test compatibility: parse and strictly sanitize raw handbrakeArgs if provided
      if (data.handbrakeArgs && Array.isArray(data.handbrakeArgs)) {
        const allowedFlags = ['--encoder', '-e', '--quality', '-q', '--encoder-preset', '--all-audio', '--audio', '-a', '--all-subtitles', '--preset', '--encoder-profile']
        const testArgs: string[] = []
        for (let i = 0; i < data.handbrakeArgs.length; i++) {
          const arg = data.handbrakeArgs[i]
          if (allowedFlags.includes(arg)) {
            testArgs.push(arg)
            const nextArg = data.handbrakeArgs[i + 1]
            if (nextArg && !nextArg.startsWith('-') && /^[a-zA-Z0-9_-]+$/.test(nextArg)) {
              testArgs.push(nextArg)
              i++
            }
          }
        }
        if (testArgs.length > 0) {
          return {
            summary,
            handbrakeArgs: testArgs,
            mkvmergeArgs: [],
            expectedSizeReduction: data.expectedSizeReduction,
            warnings: data.warnings || []
          }
        }
      }

      return {
        summary,
        handbrakeArgs,
        mkvmergeArgs: [],
        expectedSizeReduction: data.expectedSizeReduction,
        warnings: data.warnings || []
      }
    } catch (e) {
      getLoggingService().error('[TranscodingService]', 'Failed to parse Gemini response:', response.text)
      throw new Error('Failed to generate optimized transcoding parameters from AI.')
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
    if (!availability.handbrake) {
      throw new Error('HandBrakeCLI not found. Please install it and set the path in settings.')
    }

    const controller = new AbortController()
    this.activeJobs.set(mediaItemId, controller)

    let tempPath: string | null = null

    try {
      onProgress?.({ percent: 0, status: 'initializing' })
      
      const inputPath = this.sanitizePath(item.file_path)
      const params = await this.getTranscodeParameters(inputPath, options)
      
      const outputExt = '.mkv' // We prefer MKV for flexibility
      tempPath = this.sanitizePath(path.join(
        path.dirname(inputPath),
        `.totality_tmp_${path.basename(inputPath, path.extname(inputPath))}${outputExt}`
      ))

      getLoggingService().info('[TranscodingService]', `Starting transcode: ${inputPath} -> ${tempPath}`)
      getLoggingService().info('[TranscodingService]', `Using Handbrake args: ${params.handbrakeArgs.join(' ')}`)

      const args = [
        '-i', inputPath,
        '-o', tempPath,
        ...params.handbrakeArgs.filter((a): a is string => a !== null && a !== undefined)
      ]

      const success = await this.runHandbrake(args, (p) => {
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
        throw new Error('Handbrake encoding failed')
      }

      onProgress?.({ percent: 100, status: 'verifying' })
      
      // Verify the output file exists and is not empty
      const stats = await fs.stat(tempPath)
      if (stats.size === 0) {
        throw new Error('Transcoded file is empty')
      }

      // Atomic replacement
      if (options.overwriteOriginal) {
        getLoggingService().info('[TranscodingService]', `Replacing original file: ${inputPath}`)
        
        const finalPath = path.join(path.dirname(inputPath), path.basename(inputPath, path.extname(inputPath)) + outputExt)
        const backupPath = inputPath + '.bak'
        
        await fs.rename(inputPath, backupPath)
        
        try {
          await fs.rename(tempPath, finalPath)
          if (existsSync(backupPath)) await fs.unlink(backupPath)
          
          // Re-analyze the new file
          const newAnalysis = await getMediaFileAnalyzer().analyzeFile(finalPath)
          if (newAnalysis.success) {
             await db.media.updatePathAndStats(mediaItemId, finalPath, newAnalysis)
          }
        } catch (err) {
          if (existsSync(backupPath)) await fs.rename(backupPath, inputPath)
          throw err
        }
      }

      onProgress?.({ percent: 100, status: 'complete' })
      return true

    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      getLoggingService().error('[TranscodingService]', `Transcode failed for item ${mediaItemId}:`, msg)
      
      if (tempPath && existsSync(tempPath)) {
        await fs.unlink(tempPath).catch(() => {})
      }

      onProgress?.({ percent: 0, status: 'failed', error: msg })
      return false
    } finally {
      this.activeJobs.delete(mediaItemId)
    }
  }

  private runHandbrake(args: string[], onProgress: (p: any) => void, signal?: AbortSignal): Promise<boolean> {
    return new Promise((resolve) => {
      const actualPath = this.resolveExecutablePath(this.handbrakePath || 'HandBrakeCLI')
      const proc = spawn(actualPath, args)
      
      if (signal) {
        signal.addEventListener('abort', () => {
          proc.kill()
          resolve(false)
        })
      }

      proc.stdout.on('data', (data) => {
        const line = data.toString()
        const match = line.match(/(\d+\.\d+)\s*%\s*\((\d+\.\d+)\s*fps,\s*avg\s*(\d+\.\d+)\s*fps,\s*ETA\s*([^)]+)\)/)
        if (match) {
          onProgress({
            percent: parseFloat(match[1]),
            fps: parseFloat(match[2]),
            eta: match[4]
          })
        }
      })

      proc.stderr.on('data', (data) => {
        getLoggingService().verbose('[Handbrake]', data.toString().trim())
      })

      proc.on('close', (code) => {
        resolve(code === 0)
      })

      proc.on('error', (err) => {
        if (signal?.aborted) return
        getLoggingService().error('[Handbrake]', 'Process error:', err)
        resolve(false)
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
