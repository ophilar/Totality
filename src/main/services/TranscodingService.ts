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
import { TranscodeCommandFactory } from './transcoding/TranscodeCommandFactory'
import { validateHdrTranscode } from './transcoding/HdrTranscodingPolicy'
import { buildTranscodingCapabilities, resolveSelectedGpuId, TranscodingCapabilities } from './TranscodingCapabilities'
import type { FileAnalysisResult } from './MediaFileAnalyzer'

export class TranscodeError extends Error {
  constructor(message: string, public readonly exitCode?: number, public readonly stderr?: string) {
    super(message)
    this.name = 'TranscodeError'
  }
}

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
  transcodingEngine?: 'ffmpeg'
  targetSize?: string
  aiOptimize?: boolean
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
  ffmpegArgs?: string[]
  mkvmergeArgs?: string[]
  expectedSizeReduction?: string
  warnings?: string[]
  encoder?: string
  crf?: number
  preset?: string
  sourceHdrFormat?: string
}

export interface TranscodeParameterAdvisor {
  advise(request: { prompt: string; system: string }): Promise<{ text: string }>
}

class GeminiTranscodeParameterAdvisor implements TranscodeParameterAdvisor {
  async advise(request: { prompt: string; system: string }): Promise<{ text: string }> {
    return (await getGeminiService().sendMessage({
      messages: [{ role: 'user', content: request.prompt }],
      system: request.system
    }))
  }
}

/**
 * TranscodingService
 *
 * Manages external transcoding tools (Handbrake CLI, MKVToolNix)
 * and uses Gemini AI to generate per-video optimized encoding parameters.
 */
export class TranscodingService {
  private activeJobs = new Map<number, AbortController>()
  private initializedPromise: Promise<void> | null = null
  private capabilitiesPromise: Promise<TranscodingCapabilities> | null = null
  private analysisCache = new Map<string, Awaited<ReturnType<ReturnType<typeof getMediaFileAnalyzer>['analyzeFile']>>>()

  constructor(private parameterAdvisor: TranscodeParameterAdvisor = new GeminiTranscodeParameterAdvisor()) {
    // Initialization is deferred until first use to allow DB to be ready
  }


  invalidate(): void {
    this.initializedPromise = null
    this.capabilitiesPromise = null
    this.analysisCache.clear()
    getLoggingService().debug('[TranscodingService]', 'TranscodingService invalidated caches')
  }

  setParameterAdvisorForTesting(advisor: TranscodeParameterAdvisor): void {
    this.parameterAdvisor = advisor
    this.analysisCache.clear()
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

    getLoggingService().debug('[TranscodingService]', 'FFmpeg-only transcoding paths initialized')
  }

  /**
   * For testing: Override tool availability
   */
  /**
   * Check which tools are available on the system
   */
  async checkAvailability(): Promise<{ ffmpeg: boolean }> {
    await this.ensureInitialized()

    const analyzer = getMediaFileAnalyzer()
    const ffmpegAvailable = await analyzer.isAvailable()

    return { ffmpeg: ffmpegAvailable }
  }

  async getCapabilities(options: { refresh?: boolean } = {}): Promise<TranscodingCapabilities> {
    if (this.capabilitiesPromise && !options.refresh) return this.capabilitiesPromise
    this.capabilitiesPromise = (async () => {
      const [availability, gpus] = await Promise.all([
        this.checkAvailability(),
        GpuDetector.detectGpus({ refresh: options.refresh })
      ])
      const persistedSelection = await getDatabase().config.getSetting('selected_transcoding_gpu_id')
      const selectedGpuId = resolveSelectedGpuId(gpus, persistedSelection === null ? undefined : persistedSelection || null)
      if (persistedSelection === null) {
        await getDatabase().config.setSetting('selected_transcoding_gpu_id', selectedGpuId || '')
      }
      const encoderProbe = await this.probeFfmpegEncoders()
      if (encoderProbe.failures.length > 0) {
        getLoggingService().error('[TranscodingService]', `FFmpeg encoder verification failed: ${encoderProbe.failures.join('; ')}`)
      }
      const capabilities = buildTranscodingCapabilities(availability, gpus, selectedGpuId, encoderProbe.encoders, encoderProbe.failures)
      getLoggingService().info('[TranscodingService]', `Hardware snapshot captured at ${capabilities.detectedAt}: ${gpus.length} GPU(s), encoders=${capabilities.encoders.join(',') || 'none'}`)
      return capabilities
    })()
    return this.capabilitiesPromise
  }

  private async probeFfmpegEncoders(): Promise<{ encoders: string[]; failures: string[] }> {
    const ffmpegPath = getMediaFileAnalyzer().getFFmpegPath()
    if (!ffmpegPath) return { encoders: [], failures: ['FFmpeg path is unavailable'] }
    return new Promise(resolve => {
      const proc = spawn(PathUtils.resolveExecutablePath(ffmpegPath), ['-hide_banner', '-encoders'])
      let output = ''
      proc.stdout.on('data', data => { output += data.toString() })
      proc.stderr.on('data', data => { output += data.toString() })
      proc.on('error', error => resolve({ encoders: [], failures: [`Failed to execute ${ffmpegPath}: ${error.message}`] }))
      proc.on('close', code => {
        if (code !== 0) return resolve({ encoders: [], failures: [`FFmpeg encoder probe exited with code ${code}`] })
        const ffmpegNames = [...output.matchAll(/^\s*[A-Z.]+\s+(\S+)/gm)].map(match => match[1])
        const aliases: Record<string, string> = {
          hevc_nvenc: 'nvenc_h265',
          av1_nvenc: 'nvenc_av1',
          hevc_qsv: 'qsv_h265',
          av1_qsv: 'qsv_av1',
          libx265: 'x265',
          libsvtav1: 'svt_av1',
          libx264: 'libx264'
        }
        const names = ffmpegNames.map(name => aliases[name] || name)
        getLoggingService().debug('[TranscodingService]', `FFmpeg encoder verification completed: ${names.length} encoders found`)
        resolve({ encoders: names, failures: [] })
      })
    })
  }

  async setSelectedGpu(gpuId: string | null): Promise<TranscodingCapabilities> {
    const capabilities = await this.getCapabilities()
    if (gpuId !== null && !capabilities.gpus.some(gpu => gpu.id === gpuId)) {
      throw new Error(`Requested GPU ID "${gpuId}" is not available.`)
    }
    await getDatabase().config.setSetting('selected_transcoding_gpu_id', gpuId || '')
    this.capabilitiesPromise = Promise.resolve({ ...capabilities, selectedGpuId: gpuId })
    return this.capabilitiesPromise
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
    let analysis = this.analysisCache.get(filePath)
    if (!analysis) {
      analysis = await analyzer.analyzeFile(filePath)
      if (analysis.success) this.analysisCache.set(filePath, analysis)
    }
    if (!analysis.success) throw new Error(`Failed to analyze file: ${analysis.error}`)
    validateHdrTranscode(analysis)

    const targetCodec = options.targetCodec || 'av1'
    const hasManualOverrides = options.encoder && options.crf !== undefined && options.preset

    let selectedVendor: 'NVIDIA' | 'Intel' | 'AMD' | 'Apple' | 'Unknown' = 'Unknown'
    let gpuName = ''
    let selectedGpuIdForOptions: string | undefined
    let capabilitiesForOptions: TranscodingCapabilities | undefined
    if (options.useGpu || options.gpuId) {
      const capabilities = await this.getCapabilities()
      capabilitiesForOptions = capabilities
      const selectedGpuId = options.gpuId || capabilities.selectedGpuId
      selectedGpuIdForOptions = selectedGpuId || undefined
      if (!selectedGpuId) {
        throw new Error('GPU acceleration requested, but no GPU is selected. Select a verified GPU or disable GPU acceleration.')
      }
      const matchedGpu = capabilities.gpus.find(gpu => gpu.id === selectedGpuId)
      if (!matchedGpu) {
        throw new Error(`Requested GPU ID "${selectedGpuId}" is not available on the machine.`)
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
    if (capabilitiesForOptions && capabilitiesForOptions.probeFailures.length > 0) {
      throw new Error(`FFmpeg encoder verification failed for the selected device: ${capabilitiesForOptions.probeFailures.join('; ')}`)
    }
    if (capabilitiesForOptions && capabilitiesForOptions.verifiedEncoders.length > 0 && !capabilitiesForOptions.verifiedEncoders.includes(expectedEncoder)) {
      throw new Error(`The selected device cannot produce ${targetCodec.toUpperCase()} with verified FFmpeg encoder ${expectedEncoder}.`)
    }

    let summary = 'AI optimized transcode'
    let videoCodec = options.encoder
    let crf = options.crf
    let preset = options.preset
    let expectedSizeReduction = 'e.g. 50%'
    let warnings: string[] = []

    if (!hasManualOverrides && options.aiOptimize !== false) {
      if (this.parameterAdvisor instanceof GeminiTranscodeParameterAdvisor && !getGeminiService().isConfigured()) {
        summary = 'FFmpeg transcoding (AI not configured)'
      } else {
        const sizeConstraint = options.targetSize === 'ai-recommended'
          ? '- Target Size: Recommend the optimal target size that preserves maximum transparent visual quality while maximizing space savings.'
          : options.targetSize
            ? `- Target Size: The user has requested a target file size of ${options.targetSize}. Adjust the CRF value and preset parameters to try to reach or stay below this target size while maintaining acceptable quality.`
            : '- Target: Maximum space saving with transparent quality.';

        const prompt = `Analyze this media file and provide optimized ${targetCodec.toUpperCase()} transcoding parameters for FFmpeg.
        
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
        - Focus on FFmpeg and the selected hardware/software encoder specifically.`

        try {
          const response = await this.parameterAdvisor.advise({ prompt, system: systemPrompt })
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
      
    const allowedPresets = ['ultrafast', 'superfast', 'veryfast', 'faster', 'fast', 'medium', 'slow', 'slower', 'veryslow', 'placebo', 'hq', 'hp', 'bd', 'll', 'llhq', 'llhp', 'lossless', 'p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'quality']
    const finalPreset = allowedPresets.includes(preset || '')
      ? preset!
      : 'fast'

    const resolvedOptions: TranscodeOptions = {
      ...options,
      targetCodec,
      gpuId: selectedGpuIdForOptions,
      encoder: videoCodec,
      crf: finalCrf,
      preset: finalPreset
    }

    const builder = TranscodeCommandFactory.getBuilder(selectedVendor, resolvedOptions)
    const ffmpegArgs = builder.buildFFmpegArgs('<input>', '<output>', resolvedOptions, analysis)

    // Add custom args if present
    if (options.customArgs) {
      const parts = options.customArgs.match(/"[^"]*"|'[^']*'|\S+/g) || []
      const safeRegex = /^[a-zA-Z0-9\-_+=/\\:,.*"'\s]+$/
      for (const part of parts) {
        const cleaned = part.replace(/^["']|["']$/g, '').trim()
        if (cleaned && safeRegex.test(cleaned)) {
          ffmpegArgs.push(cleaned)
        }
      }
    }

    return {
      summary,
      ffmpegArgs,
      mkvmergeArgs: [],
      expectedSizeReduction,
      warnings,
      encoder: videoCodec,
      crf: finalCrf,
      preset: finalPreset,
      sourceHdrFormat: analysis.video?.hdrFormat
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
    if (engine === 'ffmpeg' && !availability.ffmpeg) {
      throw new Error('FFmpeg is not available on this system.')
    }

    const controller = new AbortController()
    this.activeJobs.set(mediaItemId, controller)

    let tempPath: string | null = null

    try {
      onProgress?.({ percent: 0, status: 'initializing' })
      
      const inputPath = PathUtils.sanitizeAbsolutePath(item.file_path)
      const params = await this.getTranscodeParameters(inputPath, { ...options, aiOptimize: false })
      
      const outputExt = '.mkv' // We prefer MKV for flexibility
      tempPath = PathUtils.sanitizeAbsolutePath(path.join(
        path.dirname(inputPath),
        `.totality_tmp_${path.basename(inputPath, path.extname(inputPath))}${outputExt}`
      ))

      getLoggingService().info('[TranscodingService]', `Starting FFmpeg transcode: ${inputPath} -> ${tempPath}`)
      const success = await this.runFFmpeg(inputPath, tempPath, params, options, (p) => {
          onProgress?.({ 
            percent: p.percent, 
            fps: p.fps, 
            eta: p.eta, 
            status: 'encoding' 
          })
        }, controller.signal)

      if (!success) {
        if (controller.signal.aborted) {
          if (tempPath && existsSync(tempPath)) {
            try { await fs.unlink(tempPath) } catch (e) { getLoggingService().warn('[TranscodingService]', 'Failed to clean up temp file on abort:', e) }
          }
          onProgress?.({ percent: 0, status: 'cancelled' })
          return false
        }
        throw new Error('FFmpeg encoding failed')
      }

      onProgress?.({ percent: 100, status: 'verifying' })
      
      // Verify the output file exists and is not empty
      const stats = await fs.stat(tempPath)
      if (stats.size === 0) {
        throw new Error('Transcoded file is empty')
      }

      const outputAnalysis = await getMediaFileAnalyzer().analyzeFile(tempPath)
      if (!outputAnalysis.success || !outputAnalysis.video) {
        throw new Error(`Transcoded output verification failed: ${outputAnalysis.error || 'video stream not detected'}`)
      }
      if (params.sourceHdrFormat?.toLowerCase() === 'hdr10' && outputAnalysis.video.hdrFormat?.toLowerCase() !== 'hdr10') {
        throw new Error('Transcoded output verification failed: HDR10 metadata was not preserved')
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
      const msg = error instanceof TranscodeError && error.stderr
        ? `${error.message}: ${error.stderr.slice(-4000).trim()}`
        : error instanceof Error ? error.message : String(error)
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

  private runFFmpeg(
    inputPath: string,
    outputPath: string,
    params: TranscodingParams,
    options: TranscodeOptions,
    onProgress: (p: TranscodeProgress) => void,
    signal?: AbortSignal
  ): Promise<boolean> {
    return new Promise((resolve, reject) => {
      const analyzer = getMediaFileAnalyzer()
      const ffmpegPath = analyzer.getFFmpegPath() || 'ffmpeg'
      const actualPath = PathUtils.resolveExecutablePath(ffmpegPath)

      let args: string[] = []
      if (params.ffmpegArgs && params.ffmpegArgs.length > 0) {
        args = params.ffmpegArgs.map(arg => {
          if (arg === '<input>') return inputPath
          if (arg === '<output>') return outputPath
          return arg
        })
      } else {
        const builder = TranscodeCommandFactory.getBuilder(undefined, options)
        args = builder.buildFFmpegArgs(inputPath, outputPath, options, {} as FileAnalysisResult)
      }

      getLoggingService().info('[TranscodingService]', `Starting FFmpeg transcode: ${ffmpegPath} ${args.join(' ')}`)

      const proc = spawn(actualPath, args)
      let stderrBuffer = ''

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
        stderrBuffer += line
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

          onProgress({ percent, fps, eta, status: 'encoding' })
        }
      })

      proc.on('close', (code) => {
        if (code === 0) {
          resolve(true)
        } else {
          if (signal?.aborted) {
            resolve(false)
          } else {
            const stderrSnippet = stderrBuffer.trim()
            reject(new TranscodeError(`FFmpeg process failed with exit code ${code}`, code ?? undefined, stderrSnippet))
          }
        }
      })

      proc.on('error', (err) => {
        if (signal?.aborted) return resolve(false)
        getLoggingService().error('[FFmpeg]', 'Process error:', err)
        reject(new TranscodeError(`FFmpeg process execution error: ${err.message}`, undefined, stderrBuffer.trim()))
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
