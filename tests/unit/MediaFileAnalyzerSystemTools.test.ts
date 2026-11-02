import { afterEach, describe, expect, it, vi } from 'vitest'
import { execFileSync } from 'child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

vi.unmock('child_process')

import { MediaFileAnalyzer } from '@main/services/MediaFileAnalyzer'

const originalPath = process.env.PATH
const temporaryDirectories: string[] = []

afterEach(() => {
  if (originalPath === undefined) delete process.env.PATH
  else process.env.PATH = originalPath
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

function resolveSystemFFprobe(): string {
  const command = process.platform === 'win32' ? 'where.exe' : 'which'
  return execFileSync(command, ['ffprobe'], { encoding: 'utf8', env: { ...process.env, PATH: originalPath } })
    .split(/\r?\n/)
    .find(Boolean)!
}

describe('MediaFileAnalyzer system executable ownership', () => {
  it('uses the system FFprobe and FFmpeg commands exposed through PATH', async () => {
    const analyzer = new MediaFileAnalyzer()

    expect(await analyzer.isAvailable()).toBe(true)
    expect(await analyzer.isFFmpegAvailable()).toBe(true)
    expect(analyzer.getFFprobePath()).toBe('ffprobe')
    expect(analyzer.getFFmpegPath()).toBe('ffmpeg')
  })

  it('reports FFprobe analysis available when FFmpeg transcoding is unavailable', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'totality-ffprobe-only-'))
    temporaryDirectories.push(directory)
    const target = path.join(directory, process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe')
    const source = resolveSystemFFprobe()
    if (process.platform === 'win32') fs.copyFileSync(source, target)
    else fs.symlinkSync(source, target)
    process.env.PATH = directory

    const analyzer = new MediaFileAnalyzer()

    expect(await analyzer.isAvailable()).toBe(true)
    expect(await analyzer.isFFmpegAvailable()).toBe(false)
    expect(analyzer.getFFprobePath()).toBe('ffprobe')
    expect(analyzer.getFFmpegPath()).toBeNull()
  })

  it('does not search alternative locations when the process PATH cannot resolve the tools', async () => {
    process.env.PATH = ''
    const analyzer = new MediaFileAnalyzer()

    expect(await analyzer.isAvailable()).toBe(false)
    expect(await analyzer.isFFmpegAvailable()).toBe(false)
    expect(analyzer.getFFprobePath()).toBeNull()
    expect(analyzer.getFFmpegPath()).toBeNull()
  })
})
