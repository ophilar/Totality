import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { app } from 'electron'
import * as fs from 'node:fs'
import * as path from 'node:path'

vi.unmock('child_process')

import { MediaFileAnalyzer } from '@main/services/MediaFileAnalyzer'

function managedToolsDirectory(): string {
  return path.join(app.getPath('userData'), 'ffprobe')
}

function copyExecutable(source: string, destination: string): void {
  fs.mkdirSync(path.dirname(destination), { recursive: true })
  fs.copyFileSync(source, destination)
  if (process.platform !== 'win32') fs.chmodSync(destination, 0o755)
}

describe('MediaFileAnalyzer managed executable ownership', () => {
  beforeEach(() => {
    fs.rmSync(managedToolsDirectory(), { recursive: true, force: true })
  })

  afterEach(() => {
    fs.rmSync(managedToolsDirectory(), { recursive: true, force: true })
  })

  it('does not adopt system FFprobe or FFmpeg when managed executables are absent', async () => {
    const analyzer = new MediaFileAnalyzer()

    expect(await analyzer.isAvailable()).toBe(false)
    expect(await analyzer.isFFmpegAvailable()).toBe(false)
    expect(analyzer.getFFprobePath()).toBeNull()
    expect(analyzer.getFFmpegPath()).toBeNull()
  })

  it('distinguishes managed FFprobe analysis availability from FFmpeg transcoding availability', async () => {
    const analyzer = new MediaFileAnalyzer()
    copyExecutable(process.execPath, analyzer.getBundledFFprobePath())

    expect(await analyzer.isAvailable()).toBe(true)
    expect(await analyzer.isFFmpegAvailable()).toBe(false)
    expect(analyzer.getFFprobePath()).toBe(analyzer.getBundledFFprobePath())
    expect(analyzer.getFFmpegPath()).toBeNull()
  })
})
