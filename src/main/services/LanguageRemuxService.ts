import { promises as fs } from 'node:fs'
import path from 'node:path'

export interface RemuxProbe { streams: Array<{ index: number; codec_type: string; tags?: { language?: string }; disposition?: Record<string, number> }>; duration?: number; size?: number }
export interface RemuxRunner { run(args: string[]): Promise<void>; probe(filePath: string): Promise<RemuxProbe> }
export interface RemuxOptions { quarantineDirectory: string; retainedAudioIndexes: number[]; logger?: (message: string) => void }

export class LanguageRemuxService {
  constructor(private readonly ffmpeg: RemuxRunner) {}

  async remux(filePath: string, options: RemuxOptions): Promise<{ activePath: string; quarantinePath: string; verifiedProbe: RemuxProbe }> {
    const directory = path.dirname(filePath)
    const temporaryPath = path.join(directory, `.${path.basename(filePath)}.totality-remux.tmp`)
    const quarantinePath = path.join(options.quarantineDirectory, path.basename(filePath))
    const log = options.logger || (() => undefined)
    await fs.mkdir(options.quarantineDirectory, { recursive: true })
    try {
      const maps = ['-map', '0:v:0', ...options.retainedAudioIndexes.flatMap(index => ['-map', `0:${index}`]), '-map', '0:s?', '-map', '0:t?', '-map_chapters', '0', '-map_metadata', '0']
      await this.ffmpeg.run(['-i', filePath, ...maps, '-c', 'copy', '-y', temporaryPath])
      const source = await this.ffmpeg.probe(filePath), output = await this.ffmpeg.probe(temporaryPath)
      if (!output.size || output.size <= 0) throw new Error('Remux output is empty')
      if (output.duration == null || source.duration == null || Math.abs(output.duration - source.duration) > 1) throw new Error('Remux duration verification failed')
      const outputAudio = new Set(output.streams.filter(s => s.codec_type === 'audio').map(s => s.index))
      if (outputAudio.size !== options.retainedAudioIndexes.length) throw new Error('Remux audio stream inventory verification failed')
      await fs.rename(filePath, quarantinePath)
      await fs.rename(temporaryPath, filePath)
      log(`Activated verified language remux and quarantined original: ${filePath}`)
      return { activePath: filePath, quarantinePath, verifiedProbe: output }
    } catch (error) {
      await fs.rm(temporaryPath, { force: true })
      log(`Language remux failed; active source retained: ${error instanceof Error ? error.message : String(error)}`)
      throw error
    }
  }
}
