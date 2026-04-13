import { spawn } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'
import { getDatabase } from '../database/getDatabase'
import { getLoggingService } from './LoggingService'
import { getGeminiService } from './GeminiService'
import { getMediaFileAnalyzer } from './MediaFileAnalyzer'
import { COMPRESSION_ADVICE_SYSTEM_PROMPT } from './ai-system-prompts'

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

  constructor() {
    this.initializePaths()
  }

  /**
   * For testing: Override tool availability
   */
  setAvailabilityOverride(override: { handbrake?: boolean; mkvtoolnix?: boolean; ffmpeg?: boolean } | null): void {
    this.availabilityOverride = override
  }

  private initializePaths() {
    const db = getDatabase()
    this.handbrakePath = db.getSetting('handbrake_path') || (process.platform === 'win32' ? 'HandBrakeCLI.exe' : 'HandBrakeCLI')
    this.mkvmergePath = db.getSetting('mkvmerge_path') || (process.platform === 'win32' ? 'mkvmerge.exe' : 'mkvmerge')
    
    // Fallback FFmpeg from MediaFileAnalyzer
    const analyzer = getMediaFileAnalyzer()
    this.ffmpegPath = analyzer.getFFprobePath()?.replace(/ffprobe/i, 'ffmpeg') || 'ffmpeg'
  }

  /**
   * Check which tools are available on the system
   */
  async checkAvailability(): Promise<{ 
    handbrake: boolean; 
    mkvtoolnix: boolean;
    ffmpeg: boolean;
  }> {
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

  private async testTool(toolPath: string, args: string[]): Promise<boolean> {
    return new Promise((resolve) => {
      try {
        const proc = spawn(toolPath, args, { stdio: 'ignore' })
        proc.on('close', (code) => resolve(code === 0))
        proc.on('error', () => resolve(false))
      } catch (e) {
        resolve(false)
      }
    })
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
    - Audio: ${options.preserveAllAudio ? 'Keep all tracks' : 'Keep main track and commentary if present'}.
    - Subtitles: ${options.preserveSubtitles ? 'Keep all tracks' : 'Discard'}.
    
    Return a JSON object with:
    {
      "summary": "Brief explanation",
      "handbrakeArgs": ["--arg1", "val1", ...],
      "mkvmergeArgs": ["--arg1", "val1", ...],
      "expectedSizeReduction": "e.g. 60%",
      "warnings": []
    }
    
    Important: The handbrakeArgs must be an array of strings suitable for child_process.spawn.
    Do NOT include the input/output paths in handbrakeArgs, they will be added automatically.`

    const systemPrompt = COMPRESSION_ADVICE_SYSTEM_PROMPT + `
    Additional Requirement: 
    - Output must be valid JSON only. 
    - Use "gemini-3.1-flash-lite" level logic for parameters.
    - Focus on HandBrakeCLI specifically.`

    const response = await gemini.sendMessage({
      messages: [{ role: 'user', content: prompt }],
      system: systemPrompt
    })

    try {
      const jsonStr = response.text.replace(/```json\n?|\n?```/g, '').trim()
      const data = JSON.parse(jsonStr) as TranscodingParams
      
      if (!Array.isArray(data.handbrakeArgs)) {
        throw new Error('Invalid response from AI: handbrakeArgs is not an array')
      }
      
      return data
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
    const item = db.media.getItem(mediaItemId)
    if (!item || !item.file_path) throw new Error('Media item or file path not found')

    const availability = await this.checkAvailability()
    if (!availability.handbrake) {
      throw new Error('HandBrakeCLI not found. Please install it and set the path in settings.')
    }

    try {
      onProgress?.({ percent: 0, status: 'initializing' })
      
      const inputPath = item.file_path
      const params = await this.getTranscodeParameters(inputPath, options)
      
      const outputExt = '.mkv' // We prefer MKV for flexibility
      const tempPath = path.join(
        path.dirname(inputPath),
        `.totality_tmp_${path.basename(inputPath, path.extname(inputPath))}${outputExt}`
      )

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
      })

      if (!success) {
        if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath)
        throw new Error('Handbrake encoding failed')
      }

      // Optional: Post-process with mkvmerge if requested
      if (availability.mkvtoolnix && params.mkvmergeArgs && params.mkvmergeArgs.length > 0) {
        onProgress?.({ percent: 100, status: 'muxing' })
        // Muxing logic here if needed to preserve attachments/tags Handbrake might drop
      }

      onProgress?.({ percent: 100, status: 'verifying' })
      
      // Verify the output file exists and is not empty
      if (!fs.existsSync(tempPath) || fs.statSync(tempPath).size === 0) {
        throw new Error('Transcoded file is missing or empty')
      }

      // Atomic replacement
      if (options.overwriteOriginal) {
        getLoggingService().info('[TranscodingService]', `Replacing original file: ${inputPath}`)
        
        // Update DB before moving if the extension changed
        const finalPath = path.join(path.dirname(inputPath), path.basename(inputPath, path.extname(inputPath)) + outputExt)
        
        // Backup original (or just delete if requested)
        const backupPath = inputPath + '.bak'
        fs.renameSync(inputPath, backupPath)
        
        try {
          fs.renameSync(tempPath, finalPath)
          if (fs.existsSync(backupPath)) fs.unlinkSync(backupPath)
          
          // Re-analyze the new file
          const newAnalysis = await getMediaFileAnalyzer().analyzeFile(finalPath)
          if (newAnalysis.success) {
             // Update item in database with new path and stats
             db.media.updatePathAndStats(mediaItemId, finalPath, newAnalysis)
          }
        } catch (err) {
          // Restore from backup if move failed
          if (fs.existsSync(backupPath)) fs.renameSync(backupPath, inputPath)
          throw err
        }
      }

      onProgress?.({ percent: 100, status: 'complete' })
      return true

    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      getLoggingService().error('[TranscodingService]', `Transcode failed for item ${mediaItemId}:`, msg)
      onProgress?.({ percent: 0, status: 'failed', error: msg })
      return false
    }
  }

  private runHandbrake(args: string[], onProgress: (p: any) => void): Promise<boolean> {
    return new Promise((resolve) => {
      const proc = spawn(this.handbrakePath || 'HandBrakeCLI', args)
      
      proc.stdout.on('data', (data) => {
        const line = data.toString()
        // Handbrake progress pattern: Encoding: task 1 of 1, 12.34 % (50.00 fps, avg 45.00 fps, ETA 00h10m00s)
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
