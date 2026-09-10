import { afterEach, describe, expect, it, vi } from 'vitest'

vi.unmock('child_process')

import { MediaFileAnalyzer } from '@main/services/MediaFileAnalyzer'

const originalPath = process.env.PATH

afterEach(() => {
  if (originalPath === undefined) delete process.env.PATH
  else process.env.PATH = originalPath
})

describe('MediaFileAnalyzer system executable ownership', () => {
  it('uses the system FFprobe and FFmpeg commands exposed through PATH', async () => {
    const analyzer = new MediaFileAnalyzer()

    expect(await analyzer.isAvailable()).toBe(true)
    expect(await analyzer.isFFmpegAvailable()).toBe(true)
    expect(analyzer.getFFprobePath()).toBe('ffprobe')
    expect(analyzer.getFFmpegPath()).toBe('ffmpeg')
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
