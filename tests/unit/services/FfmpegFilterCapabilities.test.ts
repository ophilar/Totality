import { describe, expect, it } from 'vitest'
import { parseFfmpegFilterNames, requireFfmpegFilters } from '@main/services/transcoding/FfmpegFilterCapabilities'

describe('FFmpeg filter capabilities', () => {
  it('parses available filter names from FFmpeg output', () => {
    expect(parseFfmpegFilterNames(`Filters:\n T.. = Timeline support\n ... scale V->V Scale the input video\n ..C zscale V->V Scale and convert video\n .. libvmaf VV->V Calculate VMAF\n .. libplacebo N->V Apply GPU filters\n`)).toEqual(['scale', 'zscale', 'libvmaf', 'libplacebo'])
  })

  it('reports required filters absent from the selected FFmpeg build', () => {
    expect(() => requireFfmpegFilters('Filters:\n ... scale V->V Scale video', ['libvmaf', 'libplacebo']))
      .toThrow('FFmpeg is missing required filters: libvmaf, libplacebo')
  })
})
