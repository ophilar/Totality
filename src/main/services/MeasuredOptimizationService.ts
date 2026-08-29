import { spawn } from 'node:child_process'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { getMediaFileAnalyzer } from './MediaFileAnalyzer'
import { PathUtils } from './utils/PathUtils'
import type { MeasuredCandidate } from './MeasuredOptimizationPolicy'

export interface MeasurementProcessRunner {
  run(binary: string, args: string[]): Promise<string>
}

class ChildProcessMeasurementRunner implements MeasurementProcessRunner {
  run(binary: string, args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = spawn(PathUtils.resolveExecutablePath(binary), args, { stdio: ['ignore', 'pipe', 'pipe'], timeout: 30 * 60 * 1000 })
      let output = ''
      let error = ''
      child.stdout.on('data', data => { output += data.toString() })
      child.stderr.on('data', data => { error += data.toString() })
      child.once('error', reject)
      child.once('close', code => code === 0 ? resolve(output + error) : reject(new Error(error || `FFmpeg exited with code ${code}`)))
    })
  }
}

export interface MeasuredSampleRequest {
  inputPath: string
  outputDirectory: string
  candidates: Array<MeasuredCandidate & { ffmpegArgs: string[] }>
}

export interface MeasuredSampleResult {
  candidates: MeasuredCandidate[]
  vmafAvailable: boolean
  cambiAvailable: boolean
}

export class MeasuredOptimizationService {
  constructor(private readonly processRunner: MeasurementProcessRunner = new ChildProcessMeasurementRunner()) {}

  async measure(request: MeasuredSampleRequest): Promise<MeasuredSampleResult> {
    const ffmpegPath = getMediaFileAnalyzer().getFFmpegPath()
    if (!ffmpegPath) throw new Error('FFmpeg path is unavailable for measured optimization')
    const filters = await this.processRunner.run(ffmpegPath, ['-hide_banner', '-filters'])
    const vmafAvailable = /libvmaf/i.test(filters)
    const vmafOptions = vmafAvailable ? await this.processRunner.run(ffmpegPath, ['-hide_banner', '-h', 'filter=libvmaf']) : ''
    const cambiAvailable = /cambi/i.test(vmafOptions)
    if (!vmafAvailable) throw new Error('FFmpeg does not provide the libvmaf filter required for measured optimization')
    if (!cambiAvailable) throw new Error('FFmpeg does not provide the CAMBI filter required for measured optimization')
    if (request.candidates.length === 0) throw new Error('At least one measured encoder candidate is required')

    await fs.mkdir(request.outputDirectory, { recursive: true })
    const measured: MeasuredCandidate[] = []
    for (const candidate of request.candidates) {
      const outputPath = path.join(request.outputDirectory, `${candidate.encoder}-${candidate.quality}-${candidate.preset}.mkv`)
      const args = candidate.ffmpegArgs.map(arg => arg === '<input>' ? PathUtils.sanitizeAbsolutePath(request.inputPath) : arg === '<output>' ? outputPath : arg)
      await this.processRunner.run(ffmpegPath, args)
      const stat = await fs.stat(outputPath)
      if (stat.size <= 0) throw new Error(`Measured candidate produced an empty output: ${candidate.encoder}`)
      const vmafLog = path.join(request.outputDirectory, `${candidate.encoder}-${candidate.quality}-${candidate.preset}.vmaf.json`)
      const cambiLog = path.join(request.outputDirectory, `${candidate.encoder}-${candidate.quality}-${candidate.preset}.cambi.json`)
      await this.processRunner.run(ffmpegPath, ['-v', 'error', '-i', PathUtils.sanitizeAbsolutePath(request.inputPath), '-i', outputPath, '-lavfi', `libvmaf=feature=name=cambi:log_fmt=json:log_path=${vmafLog}`, '-f', 'null', '-'])
      const vmaf = JSON.parse(await fs.readFile(vmafLog, 'utf8')) as { pooled_metrics?: { vmaf?: number; cambi?: number }; frames?: Array<{ metrics?: { vmaf?: number; cambi?: number } }> }
      const frameScores = (vmaf.frames ?? []).map(frame => frame.metrics?.vmaf).filter((score): score is number => typeof score === 'number').sort((left, right) => left - right)
      const vmafMean = vmaf.pooled_metrics?.vmaf
      if (vmafMean === undefined || frameScores.length === 0) throw new Error(`VMAF output was incomplete for ${candidate.encoder}`)
      const cambiMean = vmaf.pooled_metrics?.cambi
      if (cambiMean === undefined) throw new Error(`CAMBI output was incomplete for ${candidate.encoder}`)
      measured.push({ ...candidate, outputBytes: stat.size, vmafMean, vmafP5: frameScores[Math.floor(frameScores.length * 0.05)], cambiMean })
      await Promise.all([fs.rm(outputPath, { force: true }), fs.rm(vmafLog, { force: true }), fs.rm(cambiLog, { force: true })])
    }
    return { candidates: measured, vmafAvailable, cambiAvailable }
  }

}
