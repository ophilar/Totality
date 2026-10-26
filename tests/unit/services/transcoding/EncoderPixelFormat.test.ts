import { describe, expect, it } from 'vitest'
import type { FileAnalysisResult } from '@main/services/MediaFileAnalyzer'
import { IntelCommandBuilder } from '@main/services/transcoding/IntelCommandBuilder'
import { SoftwareCommandBuilder } from '@main/services/transcoding/SoftwareCommandBuilder'

const source: FileAnalysisResult = {
  success: true,
  filePath: 'movie.mkv',
  video: { index: 0, codec: 'hevc', width: 1920, height: 1080, bitDepth: 8, pixelFormat: 'yuv420p' },
  audioTracks: [],
  subtitleTracks: [],
}

const options = {
  targetCodec: 'hevc' as const,
  crf: 22,
  preset: 'medium',
  streamSelection: { audio: 'all' as const, subtitle: 'all' as const },
}

describe('encoder pixel depth', () => {
  it('keeps 8-bit sources 8-bit in software output', () => {
    const args = new SoftwareCommandBuilder().buildFFmpegArgs('movie.mkv', 'movie.mkv', { ...options, encoder: 'x265' }, source)

    expect(args).toContain('yuv420p')
    expect(args).not.toContain('yuv420p10le')
  })

  it.runIf(process.platform === 'win32' || process.platform === 'linux')('keeps 8-bit sources 8-bit in QSV output', () => {
    const gpuDeviceSelector = process.platform === 'win32' ? { kind: 'directx' as const, index: 0 } : { kind: 'drm' as const, path: '/dev/dri/renderD128' }
    const args = new IntelCommandBuilder().buildFFmpegArgs('movie.mkv', 'movie.mkv', {
      ...options,
      encoder: 'qsv_h265',
      gpuDeviceSelector,
    }, source)

    expect(args).toContain('vpp_qsv=format=nv12')
    expect(args).not.toContain('vpp_qsv=format=p010le')
  })
})
