import { promises as fs } from 'node:fs'
import path from 'node:path'

export interface RemuxStream { index: number; codec_type: string; codec_name?: string; profile?: string; channel_layout?: string; hasObjectAudio?: boolean; tags?: { language?: string; title?: string }; disposition?: Record<string, number> }
export interface RemuxProbe { streams: RemuxStream[]; duration?: number; size?: number }
export interface RemuxRunner { run(args: string[]): Promise<void>; probe(filePath: string): Promise<RemuxProbe> }
export interface RemuxFingerprint { size: number; mtimeMs: number; sha256?: string }
export interface RemuxFileOps { mkdir(path: string): Promise<void>; rename(from: string, to: string): Promise<void>; remove(path: string): Promise<void>; copy?(from: string, to: string): Promise<void>; exists?(path: string): Promise<boolean> }
export interface RemuxOptions {
  quarantineDirectory: string
  retainedAudioIndexes: number[]
  sourceAudioStreams?: RemuxStream[]
  sourceFingerprint?: RemuxFingerprint
  fingerprint?: (filePath: string) => Promise<RemuxFingerprint>
  fileOps?: RemuxFileOps
  logger?: (message: string) => void
  auditLogDirectory?: string
  statfsProvider?: (dirPath: string) => Promise<{ bavail: number; bsize: number }>
}

export interface OptimizationAuditEntry {
  timestamp: string
  action: string
  sourcePath: string
  quarantinePath?: string
  status: 'succeeded' | 'failed'
  bytesSaved?: number
  error?: string
}

export class LanguageRemuxService {
  constructor(private readonly ffmpeg: RemuxRunner) {}

  static async assertRecoverability(
    filePath: string,
    quarantineDirectory: string,
    statfsProvider?: (dirPath: string) => Promise<{ bavail: number; bsize: number }>
  ): Promise<void> {
    const stat = await fs.stat(filePath)
    await fs.mkdir(quarantineDirectory, { recursive: true })
    const testFile = path.join(quarantineDirectory, `.write-test-${Date.now()}-${Math.random().toString(36).slice(2)}.tmp`)
    await fs.writeFile(testFile, '')
    await fs.rm(testFile, { force: true })

    const provider = statfsProvider || (typeof fs.statfs === 'function' ? (p: string) => fs.statfs(p) : undefined)
    if (provider) {
      const stats = await provider(quarantineDirectory)
      const freeSpace = stats.bavail * stats.bsize
      const requiredHeadroom = stat.size * 1.2
      if (freeSpace < requiredHeadroom) {
        throw new Error(`Insufficient disk headroom for quarantine: requires ~${Math.round(requiredHeadroom / 1024 / 1024)}MB, available: ${Math.round(freeSpace / 1024 / 1024)}MB`)
      }
    } else {
      throw new Error('Filesystem statfs is unavailable; cannot prove recoverability headroom')
    }
  }

  static async recordAuditLog(entry: OptimizationAuditEntry, auditLogDirectory: string): Promise<void> {
    await fs.mkdir(auditLogDirectory, { recursive: true })
    const dateStr = new Date().toISOString().slice(0, 10)
    const logFile = path.join(auditLogDirectory, `optimization_audit_${dateStr}.jsonl`)
    await fs.appendFile(logFile, JSON.stringify(entry) + '\n', 'utf-8')
  }

  static createDefaultRunner(ffmpegPath: string, ffprobePath: string): RemuxRunner {
    return {
      run: async (args: string[]) => {
        const { spawn } = await import('node:child_process')
        return new Promise<void>((resolve, reject) => {
          const child = spawn(ffmpegPath, args, { stdio: ['ignore', 'ignore', 'pipe'] })
          let stderr = ''
          child.stderr?.on('data', (d) => { stderr += d.toString() })
          child.on('error', reject)
          child.on('close', (code) => code === 0 ? resolve() : reject(new Error(stderr || `FFmpeg exited with code ${code}`)))
        })
      },
      probe: async (filePath: string) => {
        const { spawn } = await import('node:child_process')
        return new Promise<RemuxProbe>((resolve, reject) => {
          const child = spawn(ffprobePath, ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', filePath], { stdio: ['ignore', 'pipe', 'pipe'] })
          let stdout = '', stderr = ''
          child.stdout?.on('data', (d) => { stdout += d.toString() })
          child.stderr?.on('data', (d) => { stderr += d.toString() })
          child.on('error', reject)
          child.on('close', (code) => {
            if (code !== 0) return reject(new Error(stderr || `FFprobe exited with code ${code}`))
            try {
              const parsed = JSON.parse(stdout) as { streams?: RemuxStream[]; format?: { duration?: string; size?: string } }
              const durationSeconds = Number(parsed.format?.duration)
              resolve({
                streams: parsed.streams || [],
                duration: Number.isFinite(durationSeconds) ? durationSeconds * 1000 : undefined,
                size: Number(parsed.format?.size),
              })
            } catch (err) {
              reject(err)
            }
          })
        })
      },
    }
  }

  async remux(filePath: string, options: RemuxOptions): Promise<{ activePath: string; quarantinePath: string; verifiedProbe: RemuxProbe }> {
    if (options.auditLogDirectory) {
      await LanguageRemuxService.assertRecoverability(filePath, options.quarantineDirectory, options.statfsProvider)
    }
    const directory = path.dirname(filePath)
    const temporaryPath = path.join(directory, `.${path.basename(filePath)}.totality-remux.tmp`)
    const quarantinePath = path.join(options.quarantineDirectory, path.basename(filePath))
    const log = options.logger || (() => undefined)
    const fileOps = options.fileOps || { mkdir: async (value: string) => { await fs.mkdir(value, { recursive: true }) }, rename: (from: string, to: string) => fs.rename(from, to), remove: (value: string) => fs.rm(value, { force: true }), copy: (from: string, to: string) => fs.copyFile(from, to), exists: async (value: string) => { try { await fs.access(value); return true } catch { return false } } }
    await fileOps.mkdir(options.quarantineDirectory)
    try {
      if (options.sourceFingerprint && options.fingerprint) {
        const current = await options.fingerprint(filePath)
        if (current.size !== options.sourceFingerprint.size || current.mtimeMs !== options.sourceFingerprint.mtimeMs || (options.sourceFingerprint.sha256 !== undefined && current.sha256 !== options.sourceFingerprint.sha256)) throw new Error('Source file changed since optimization analysis')
      }
      const maps = ['-map', '0:v:0', ...options.retainedAudioIndexes.flatMap(index => ['-map', `0:${index}`]), '-map', '0:s?', '-map', '0:t?', '-map_chapters', '0', '-map_metadata', '0']
      await this.ffmpeg.run(['-i', filePath, ...maps, '-c', 'copy', '-y', temporaryPath])
      const source = await this.ffmpeg.probe(filePath), output = await this.ffmpeg.probe(temporaryPath)
      if (!output.size || output.size <= 0) throw new Error('Remux output is empty')
      if (output.duration == null || source.duration == null || Math.abs(output.duration - source.duration) > 1) throw new Error('Remux duration verification failed')
      const expectedAudio = options.sourceAudioStreams || []
      const outputAudio = output.streams.filter(s => s.codec_type === 'audio')
      if (outputAudio.length !== options.retainedAudioIndexes.length) throw new Error('Remux audio stream inventory verification failed')
      if (expectedAudio.length > 0) {
        const retained = options.retainedAudioIndexes.map(index => expectedAudio.find(stream => stream.index === index)).filter((stream): stream is RemuxStream => !!stream)
        if (retained.length !== options.retainedAudioIndexes.length || !retained.every((source, index) => this.sameAudioSignature(source, outputAudio[index]))) throw new Error('Remux retained audio verification failed')
      }
      if (fileOps.exists && await fileOps.exists(quarantinePath)) throw new Error('Quarantine destination already exists')
      await this.moveToQuarantine(filePath, quarantinePath, fileOps)
      try {
        await fileOps.rename(temporaryPath, filePath)
      } catch (error) {
        await fileOps.rename(quarantinePath, filePath)
        throw error
      }
      if (options.auditLogDirectory) {
        const outputStat = await fs.stat(filePath)
        await LanguageRemuxService.recordAuditLog({
          timestamp: new Date().toISOString(),
          action: 'language-remux',
          sourcePath: filePath,
          quarantinePath,
          status: 'succeeded',
          bytesSaved: (options.sourceFingerprint?.size ?? 0) - outputStat.size,
        }, options.auditLogDirectory)
      }
      log(`Activated verified language remux and quarantined original: ${filePath}`)
      return { activePath: filePath, quarantinePath, verifiedProbe: output }
    } catch (error) {
      await fileOps.remove(temporaryPath)
      if (options.auditLogDirectory) {
        await LanguageRemuxService.recordAuditLog({
          timestamp: new Date().toISOString(),
          action: 'language-remux',
          sourcePath: filePath,
          status: 'failed',
          error: error instanceof Error ? error.message : String(error),
        }, options.auditLogDirectory)
      }
      log(`Language remux failed; active source retained: ${error instanceof Error ? error.message : String(error)}`)
      throw error
    }
  }

  private sameAudioSignature(source: RemuxStream, output: RemuxStream): boolean {
    return source.codec_name === output.codec_name && source.profile === output.profile && source.channel_layout === output.channel_layout &&
      source.tags?.language === output.tags?.language && source.tags?.title === output.tags?.title &&
      source.hasObjectAudio === output.hasObjectAudio &&
      JSON.stringify(source.disposition || {}) === JSON.stringify(output.disposition || {})
  }

  private async moveToQuarantine(filePath: string, quarantinePath: string, fileOps: RemuxFileOps): Promise<void> {
    try {
      await fileOps.rename(filePath, quarantinePath)
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'EXDEV') || !fileOps.copy) throw error
      await fileOps.copy(filePath, quarantinePath)
      await fileOps.remove(filePath)
    }
  }
}
