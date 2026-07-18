import { spawn } from 'child_process'
import * as fs from 'fs/promises'
import { existsSync } from 'fs'
import * as path from 'path'
import { getDatabase } from '@main/database/BetterSQLiteService'
import { getLoggingService } from '@main/services/LoggingService'
import { getGeminiService } from '@main/services/GeminiService'
import { getMediaFileAnalyzer } from '@main/services/MediaFileAnalyzer'
import { APP_CONFIG } from '@main/config'
import { PathUtils } from '@main/services/utils/PathUtils'
import { GpuDetector } from '@main/services/utils/GpuDetector'

export interface TranscodeOptions {
  targetCodec?: 'av1' | 'hevc'
  preserveSubtitles?: boolean
  preserveAllAudio?: boolean
  overwriteOriginal?: boolean
  priority?: 'low' | 'normal' | 'high'
  useGpu?: boolean
  encoder?: string
  crf?: number
  preset?: string
  customArgs?: string
  gpuId?: string
  transcodingEngine?: 'handbrake' | 'ffmpeg'
  targetSize?: string
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
  ffmpegArgs?: string[]
  mkvmergeArgs?: string[]
  expectedSizeReduction?: string
  warnings?: string[]
  encoder?: string
  crf?: number
  preset?: string
}

/**
 * TranscodingService
 *
 * Manages external transcoding tools (Handbrake CLI, MKVToolNix)
 * and uses Gemini AI to generate per-video optimized encoding parameters.
 */
export class TranscodingService {
  private handbrakePath: string | null = null
  private availabilityOverride: { handbrake?: boolean } | null = null
  private activeJobs = new Map<number, AbortController>()
  private initializedPromise: Promise<void> | null = null
  private cachedHandbrakeAvailable: boolean | null = null
  private cachedHandbrakeVersion: string | null = null

  constructor() {
    // Initialization is deferred until first use to allow DB to be ready
  }


  invalidate(): void {
    this.initializedPromise = null
    this.handbrakePath = null
    this.cachedHandbrakeAvailable = null
    this.cachedHandbrakeVersion = null
    getLoggingService().debug('[TranscodingService]', 'TranscodingService invalidated caches')
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

    const hbConfig = await db.config.getSetting('handbrake_path')
    
    // Find HandBrakeCLI using standard OS search paths if config is not set
    const possibleHbPaths = PathUtils.getPossibleExecutablePaths('HandBrakeCLI', hbConfig || undefined)

    // Test each possible path and use the first working one
    for (const p of possibleHbPaths) {
      if (await this.testTool(p, ['--version'])) {
        this.handbrakePath = p
        break
      }
    }
    
    // If none worked, fallback to bare command so PATH can be attempted
    if (!this.handbrakePath) {
      this.handbrakePath = hbConfig || (process.platform === 'win32' ? 'HandBrakeCLI.exe' : 'HandBrakeCLI')
    }

    getLoggingService().debug('[TranscodingService]', `Paths initialized - Handbrake: ${this.handbrakePath}`)
  }

  /**
   * For testing: Override tool availability
   */
  setAvailabilityOverride(override: { handbrake?: boolean } | null): void {
    this.availabilityOverride = override
  }

  /**
   * Check which tools are available on the system
   */
  async checkAvailability(): Promise<{ 
    handbrake: boolean; 
    ffmpeg: boolean;
  }> {
    await this.ensureInitialized()

    const analyzer = getMediaFileAnalyzer()
    const ffmpegAvailable = await analyzer.isAvailable()

    if (this.availabilityOverride) {
      return {
        handbrake: this.availabilityOverride.handbrake ?? false,
        ffmpeg: ffmpegAvailable
      }
    }

    if (this.cachedHandbrakeAvailable !== null) {
      return {
        handbrake: this.cachedHandbrakeAvailable,
        ffmpeg: ffmpegAvailable
      }
    }

    const db = getDatabase()
    const isEnabled = (await db.config.getSetting('handbrake_enabled')) !== 'false'
    if (!isEnabled) {
      this.cachedHandbrakeAvailable = false
      return { handbrake: false, ffmpeg: ffmpegAvailable }
    }
    const hb = await this.testTool(this.handbrakePath || 'HandBrakeCLI', ['--version'])
    this.cachedHandbrakeAvailable = hb

    return { 
      handbrake: hb,
      ffmpeg: ffmpegAvailable
    }
  }



  /**
   * Get HandBrake CLI version string
   */
  async getVersion(): Promise<string | null> {
    await this.ensureInitialized()

    if (this.cachedHandbrakeVersion !== null) {
      return this.cachedHandbrakeVersion
    }

    if (!this.handbrakePath) return null

    const version = await new Promise<string | null>((resolve) => {
      try {
        const actualPath = PathUtils.resolveExecutablePath(this.handbrakePath || '')
        const proc = spawn(actualPath, ['--version'])
        let output = ''
        proc.stdout.on('data', (data) => { output += data.toString() })
        proc.stderr.on('data', (data) => { output += data.toString() })
        proc.on('close', () => {
          const match = output.match(/HandBrake\s+([^\s]+)/i)
          resolve(match ? match[1] : 'unknown')
        })
        proc.on('error', () => resolve(null))
      } catch (e) {
        resolve(null)
      }
    })

    this.cachedHandbrakeVersion = version
    return version
  }

  private async testTool(toolPath: string, args: string[]): Promise<boolean> {
    return new Promise((resolve) => {
      try {
        const actualPath = PathUtils.resolveExecutablePath(toolPath)
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
    const targetCodec = options.targetCodec || 'av1'
    const hasManualOverrides = options.encoder && options.crf !== undefined && options.preset

    let selectedVendor: 'NVIDIA' | 'Intel' | 'AMD' | 'Apple' | 'Unknown' = 'Unknown'
    let gpuName = ''
    if (options.useGpu || options.gpuId) {
      const gpus = await GpuDetector.detectGpus()
      if (gpus.length === 0) {
        throw new Error('GPU acceleration requested, but no GPUs were detected on the machine.')
      }
      let matchedGpu = gpus[0]
      if (options.gpuId) {
        const found = gpus.find(g => g.id === options.gpuId)
        if (!found) {
          throw new Error(`Requested GPU ID "${options.gpuId}" is not available on the machine.`)
        }
        matchedGpu = found
      }
      selectedVendor = matchedGpu.vendor
      gpuName = matchedGpu.name
      if (selectedVendor === 'Unknown') {
        throw new Error(`GPU acceleration is not supported for GPU: "${matchedGpu.name}". Supported vendors are NVIDIA, Intel, AMD, and Apple.`)
      }
    }

    let expectedEncoder = ''
    if (options.useGpu || options.gpuId) {
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

    let summary = 'AI optimized transcode'
    let videoCodec = options.encoder
    let crf = options.crf
    let preset = options.preset
    let expectedSizeReduction = 'e.g. 50%'
    let warnings: string[] = []

    if (!hasManualOverrides) {
      if (!gemini.isConfigured()) {
        summary = 'Handbrake transcoding (AI not configured)'
      } else {
        const sizeConstraint = options.targetSize === 'ai-recommended'
          ? '- Target Size: Recommend the optimal target size that preserves maximum transparent visual quality while maximizing space savings.'
          : options.targetSize
            ? `- Target Size: The user has requested a target file size of ${options.targetSize}. Adjust the CRF value and preset parameters to try to reach or stay below this target size while maintaining acceptable quality.`
            : '- Target: Maximum space saving with transparent quality.';

        const prompt = `Analyze this media file and provide optimized ${targetCodec.toUpperCase()} transcoding parameters for HandBrakeCLI.
        
        File Analysis:
        ${JSON.stringify(analysis, null, 2)}
        
        Constraints:
        ${sizeConstraint}
        - Preference: 10-bit encoding if source is 10-bit or HDR.
        ${(options.useGpu || options.gpuId) ? `- Hardware Acceleration: Use GPU encoder (${expectedEncoder}) for ${gpuName} as the videoCodec.` : ''}
        
        Return a JSON object with:
        {
          "summary": "Brief explanation",
          "videoCodec": "${expectedEncoder}", // use this exact encoder
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

        try {
          const response = await gemini.sendMessage({
            messages: [{ role: 'user', content: prompt }],
            system: systemPrompt
          })
          const jsonStr = response.text.replace(/```json\n?|\n?```/g, '').trim()
          const data = JSON.parse(jsonStr)
          
          summary = typeof data.summary === 'string' ? data.summary : 'AI optimized transcode'
          if (!videoCodec) videoCodec = data.videoCodec
          if (crf === undefined) crf = data.crf
          if (!preset) preset = data.preset
          expectedSizeReduction = data.expectedSizeReduction || expectedSizeReduction
          warnings = data.warnings || []
        } catch (e) {
          getLoggingService().error('[TranscodingService]', 'Failed to parse Gemini response or fetch parameters:', e)
          throw new Error(`Failed to generate optimized transcoding parameters: ${e instanceof Error ? e.message : String(e)}`)
        }
      }
    } else {
      summary = 'User-defined custom parameters'
      expectedSizeReduction = 'Custom'
    }

    // Set defaults if still not resolved
    if (!videoCodec) {
      videoCodec = expectedEncoder
    }

    // Normalize encoder names for HandBrake CLI compatibility
    if (videoCodec === 'av1_nvenc') {
      videoCodec = 'nvenc_av1'
    }

    if (crf === undefined) {
      crf = 22
    }
    if (!preset) {
      preset = 'fast'
    }

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
      
    const finalCrf = (typeof crf === 'number' && crf >= 0 && crf <= 51)
      ? crf
      : 22
      
    const allowedPresets = ['ultrafast', 'superfast', 'veryfast', 'faster', 'fast', 'medium', 'slow', 'slower', 'veryslow', 'placebo', 'hq', 'hp', 'bd', 'll', 'llhq', 'llhp', 'lossless']
    const finalPreset = allowedPresets.includes(preset)
      ? preset
      : 'fast'

    // Build safe handbrakeArgs array
    const handbrakeArgs: string[] = []
    
    handbrakeArgs.push('--encoder', videoCodec)
    handbrakeArgs.push('--quality', finalCrf.toString())
    handbrakeArgs.push('--encoder-preset', finalPreset)

    if (options.preserveAllAudio) {
      handbrakeArgs.push('--all-audio')
    } else {
      handbrakeArgs.push('--audio', '1')
    }

    if (options.preserveSubtitles) {
      handbrakeArgs.push('--all-subtitles')
    }

    // Add custom args if present
    if (options.customArgs) {
      const parts = options.customArgs.match(/"[^"]*"|'[^']*'|\S+/g) || []
      const safeRegex = /^[a-zA-Z0-9\-_\+=\/:,\.\*"'\s]+$/
      for (const part of parts) {
        const cleaned = part.replace(/^["']|["']$/g, '').trim()
        if (cleaned && safeRegex.test(cleaned)) {
          handbrakeArgs.push(cleaned)
        }
      }
    }

    // Build equivalent ffmpegArgs array
    const encoderMap: Record<string, string> = {
      'svt_av1': 'libsvtav1',
      'svt_av1_10bit': 'libsvtav1',
      'x265': 'libx265',
      'x265_10bit': 'libx265',
      'x264': 'libx264',
      'nvenc_h264': 'h264_nvenc',
      'nvenc_h265': 'hevc_nvenc',
      'nvenc_h265_10bit': 'hevc_nvenc',
      'nvenc_av1': 'av1_nvenc',
      'nvenc_av1_10bit': 'av1_nvenc',
      'qsv_av1': 'av1_qsv',
      'qsv_h265': 'hevc_qsv',
      'qsv_h265_10bit': 'hevc_qsv',
      'qsv_h264': 'h264_qsv',
      'av1_amf': 'av1_amf',
      'hevc_amf': 'hevc_amf',
      'vce_h264': 'h264_amf',
      'vt_h264': 'h264_videotoolbox',
      'vt_h265': 'hevc_videotoolbox'
    }

    const ffmpegEncoder = encoderMap[videoCodec] || 'libx265'
    const ffmpegArgs: string[] = ['-y', '-i', '<input>']
    ffmpegArgs.push('-c:v', ffmpegEncoder)

    if (videoCodec.endsWith('_10bit')) {
      ffmpegArgs.push('-pix_fmt', 'yuv420p10le')
    }

    if (ffmpegEncoder.includes('nvenc')) {
      ffmpegArgs.push('-rc', 'constqp', '-cq', finalCrf.toString())
    } else if (ffmpegEncoder.includes('qsv')) {
      ffmpegArgs.push('-global_quality', finalCrf.toString())
    } else {
      ffmpegArgs.push('-crf', finalCrf.toString())
    }

    if (finalPreset) {
      ffmpegArgs.push('-preset', finalPreset)
    }

    if (options.preserveAllAudio) {
      ffmpegArgs.push('-c:a', 'copy')
    } else {
      ffmpegArgs.push('-map', '0:v:0', '-map', '0:a:0?', '-c:a', 'copy')
    }

    if (options.preserveSubtitles) {
      ffmpegArgs.push('-map', '0:s?', '-c:s', 'copy')
    }

    if (options.preserveAllAudio) {
      ffmpegArgs.push('-map', '0')
    }

    ffmpegArgs.push('<output>')

    return {
      summary,
      handbrakeArgs,
      ffmpegArgs,
      mkvmergeArgs: [],
      expectedSizeReduction,
      warnings,
      encoder: videoCodec,
      crf: finalCrf,
      preset: finalPreset
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
    if (engine === 'handbrake' && !availability.handbrake) {
      throw new Error('HandBrakeCLI is not available on this system.')
    }
    if (engine === 'ffmpeg' && !availability.ffmpeg) {
      throw new Error('FFmpeg is not available on this system.')
    }

    const controller = new AbortController()
    this.activeJobs.set(mediaItemId, controller)

    let tempPath: string | null = null

    try {
      onProgress?.({ percent: 0, status: 'initializing' })
      
      const inputPath = PathUtils.sanitizeAbsolutePath(item.file_path)
      const params = await this.getTranscodeParameters(inputPath, options)
      
      const outputExt = '.mkv' // We prefer MKV for flexibility
      tempPath = PathUtils.sanitizeAbsolutePath(path.join(
        path.dirname(inputPath),
        `.totality_tmp_${path.basename(inputPath, path.extname(inputPath))}${outputExt}`
      ))

      const useFfmpeg = engine === 'ffmpeg'
      let success = false

      if (useFfmpeg) {
        getLoggingService().info('[TranscodingService]', `Starting FFmpeg transcode: ${inputPath} -> ${tempPath}`)
        success = await this.runFFmpeg(inputPath, tempPath, params, options, (p) => {
          onProgress?.({ 
            percent: p.percent, 
            fps: p.fps, 
            eta: p.eta, 
            status: 'encoding' 
          })
        }, controller.signal)
      } else {
        getLoggingService().info('[TranscodingService]', `Starting Handbrake transcode: ${inputPath} -> ${tempPath}`)
        getLoggingService().info('[TranscodingService]', `Using Handbrake args: ${params.handbrakeArgs.join(' ')}`)

        const args = [
          '-i', inputPath,
          '-o', tempPath,
          ...params.handbrakeArgs.filter((a): a is string => a !== null && a !== undefined)
        ]

        success = await this.runHandbrake(args, (p) => {
          onProgress?.({ 
            percent: p.percent, 
            fps: p.fps, 
            eta: p.eta, 
            status: 'encoding' 
          })
        }, controller.signal)
      }

      if (!success) {
        if (controller.signal.aborted) {
          if (tempPath && existsSync(tempPath)) {
            try { await fs.unlink(tempPath) } catch (e) { getLoggingService().warn('[TranscodingService]', 'Failed to clean up temp file on abort:', e) }
          }
          onProgress?.({ percent: 0, status: 'cancelled' })
          return false
        }
        throw new Error(useFfmpeg ? 'FFmpeg encoding failed' : 'Handbrake encoding failed')
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
        
        // Remove original and rename directly. Atomic moves cross-device are not supported by rename, but rename works on same device.
        if (existsSync(inputPath)) await fs.unlink(inputPath)
        await fs.rename(tempPath, finalPath)
        
        // Re-analyze the new file
        const newAnalysis = await getMediaFileAnalyzer().analyzeFile(finalPath)
        if (newAnalysis.success) {
           await db.media.updatePathAndStats(mediaItemId, finalPath, newAnalysis)
        }
      }

      onProgress?.({ percent: 100, status: 'complete' })
      return true

    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      getLoggingService().error('[TranscodingService]', `Transcode failed for item ${mediaItemId}:`, msg)
      
      if (tempPath && existsSync(tempPath)) {
        try { await fs.unlink(tempPath) } catch (e) { getLoggingService().warn('[TranscodingService]', 'Failed to clean up temp file:', e) }
      }

      onProgress?.({ percent: 0, status: 'failed', error: msg })
      return false
    } finally {
      this.activeJobs.delete(mediaItemId)
    }
  }

  private runHandbrake(args: string[], onProgress: (p: any) => void, signal?: AbortSignal): Promise<boolean> {
    return new Promise((resolve) => {
      const actualPath = PathUtils.resolveExecutablePath(this.handbrakePath || 'HandBrakeCLI')
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

  private runFFmpeg(
    inputPath: string,
    outputPath: string,
    params: TranscodingParams,
    options: TranscodeOptions,
    onProgress: (p: any) => void,
    signal?: AbortSignal
  ): Promise<boolean> {
    return new Promise((resolve) => {
      const analyzer = getMediaFileAnalyzer()
      const ffmpegPath = analyzer.getFFmpegPath() || 'ffmpeg'
      const actualPath = PathUtils.resolveExecutablePath(ffmpegPath)

      // Map Handbrake encoders to FFmpeg encoders
      const encoderMap: Record<string, string> = {
        'svt_av1': 'libsvtav1',
        'svt_av1_10bit': 'libsvtav1',
        'x265': 'libx265',
        'x265_10bit': 'libx265',
        'x264': 'libx264',
        'nvenc_h264': 'h264_nvenc',
        'nvenc_h265': 'hevc_nvenc',
        'nvenc_h265_10bit': 'hevc_nvenc',
        'nvenc_av1': 'av1_nvenc',
        'nvenc_av1_10bit': 'av1_nvenc',
        'qsv_av1': 'av1_qsv',
        'qsv_h265': 'hevc_qsv',
        'qsv_h265_10bit': 'hevc_qsv',
        'qsv_h264': 'h264_qsv',
        'av1_amf': 'av1_amf',
        'hevc_amf': 'hevc_amf',
        'vce_h264': 'h264_amf',
        'vt_h264': 'h264_videotoolbox',
        'vt_h265': 'hevc_videotoolbox'
      }

      const encoder = params.encoder || 'x265'
      const ffmpegEncoder = encoderMap[encoder] || 'libx265'
      const args: string[] = ['-y', '-i', inputPath]

      // Video settings
      args.push('-c:v', ffmpegEncoder)

      // Apply 10-bit pixel format if encoder ends with _10bit or target is 10-bit
      if (encoder.endsWith('_10bit')) {
        args.push('-pix_fmt', 'yuv420p10le')
      }

      // Quality setting (CRF / CQ)
      const crf = typeof params.crf === 'number' ? params.crf : 22
      if (ffmpegEncoder.includes('nvenc')) {
        args.push('-rc', 'constqp', '-cq', crf.toString())
      } else if (ffmpegEncoder.includes('qsv')) {
        args.push('-global_quality', crf.toString())
      } else {
        args.push('-crf', crf.toString())
      }

      // Preset setting
      if (params.preset) {
        args.push('-preset', params.preset)
      }

      // Audio mapping
      if (options.preserveAllAudio) {
        args.push('-c:a', 'copy')
      } else {
        args.push('-map', '0:v:0', '-map', '0:a:0?', '-c:a', 'copy')
      }

      // Subtitle mapping
      if (options.preserveSubtitles) {
        args.push('-map', '0:s?', '-c:s', 'copy')
      }

      // If we didn't use map above, make sure we map video
      if (options.preserveAllAudio) {
        args.push('-map', '0')
      }

      args.push(outputPath)

      getLoggingService().info('[TranscodingService]', `Starting FFmpeg transcode: ${ffmpegPath} ${args.join(' ')}`)

      const proc = spawn(actualPath, args)

      if (signal) {
        signal.addEventListener('abort', () => {
          proc.kill()
          resolve(false)
        })
      }

      // Parse FFmpeg progress
      let durationSeconds = 0
      proc.stderr.on('data', (data) => {
        const line = data.toString()
        getLoggingService().verbose('[FFmpeg]', line.trim())

        // Extract duration first time
        if (durationSeconds === 0) {
          const durMatch = line.match(/Duration:\s*(\d+):(\d+):(\d+\.\d+)/)
          if (durMatch) {
            durationSeconds = parseInt(durMatch[1], 10) * 3600 + parseInt(durMatch[2], 10) * 60 + parseFloat(durMatch[3])
          }
        }

        // Parse time and speed
        const timeMatch = line.match(/time=\s*(\d+):(\d+):(\d+\.\d+)/)
        const fpsMatch = line.match(/fps=\s*(\d+(\.\d+)?)/)
        const speedMatch = line.match(/speed=\s*(\d+(\.\d+)?)x/)
        
        if (timeMatch && durationSeconds > 0) {
          const currentTime = parseInt(timeMatch[1], 10) * 3600 + parseInt(timeMatch[2], 10) * 60 + parseFloat(timeMatch[3])
          const percent = Math.min(99.9, (currentTime / durationSeconds) * 100)
          const fps = fpsMatch ? parseFloat(fpsMatch[1]) : 0
          const speed = speedMatch ? parseFloat(speedMatch[1]) : 1
          
          let eta = 'unknown'
          if (speed > 0 && fps > 0) {
            const remainingSec = (durationSeconds - currentTime) / speed
            const etaMin = Math.floor(remainingSec / 60)
            const etaSec = Math.floor(remainingSec % 60)
            eta = `${etaMin}m ${etaSec}s`
          }

          onProgress({ percent, fps, eta })
        }
      })

      proc.on('close', (code) => {
        resolve(code === 0)
      })

      proc.on('error', (err) => {
        if (signal?.aborted) return
        getLoggingService().error('[FFmpeg]', 'Process error:', err)
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
