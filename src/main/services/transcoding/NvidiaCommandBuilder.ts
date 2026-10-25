
import type { ITranscodeCommandBuilder, TranscodeOptions } from './types'
import type { FileAnalysisResult } from '../MediaFileAnalyzer'
import { buildHdrMetadataArgs } from './HdrTranscodingPolicy'
import { appendStreamMappingArgs } from './StreamSelectionPlan'
import { applyTargetTranscodePlan } from './TargetTranscodePlan'
import { APP_CONFIG } from '@main/config'

export class NvidiaCommandBuilder implements ITranscodeCommandBuilder {
  buildFFmpegArgs(input: string, output: string, options: TranscodeOptions, analysis: FileAnalysisResult): string[] {
    if (process.platform === 'win32' && options.gpuDeviceSelector?.kind !== 'directx') throw new Error('The selected NVIDIA adapter could not be mapped to a DirectX device.')
    if (process.platform === 'linux' && options.gpuDeviceSelector?.kind !== 'nvenc') throw new Error('The selected NVIDIA adapter could not be mapped to an NVENC device.')
    if (process.platform !== 'win32' && process.platform !== 'linux') throw new Error('Per-device NVIDIA encoding is unavailable on this platform.')
    const hdrArgs = buildHdrMetadataArgs(analysis, options)
    const args: string[] = [
      '-y',
      ...(process.platform === 'win32' ? ['-init_hw_device', `d3d11va=selected:${options.gpuDeviceSelector?.kind === 'directx' ? options.gpuDeviceSelector.index : ''}`, '-filter_hw_device', 'selected'] : []),
      '-i', input,
      '-fps_mode', 'passthrough'
    ]
    const codec = options.targetCodec === 'av1' ? 'av1_nvenc' : 'hevc_nvenc'
    const cq = (options.crf ?? APP_CONFIG.transcoding.defaultCrf).toString()
    const preset = options.preset || APP_CONFIG.transcoding.defaultPreset

    args.push(
      '-c:v', codec,
      ...(process.platform === 'linux' ? ['-gpu', String(options.gpuDeviceSelector?.kind === 'nvenc' ? options.gpuDeviceSelector.index : '')] : []),
      '-preset', preset,
      '-rc', 'vbr',
      '-cq', cq,
      '-b:v', '0',
      '-b_ref_mode', 'middle',
      '-temporal-aq', '1',
      '-rc-lookahead', '32'
    )

    const is10BitSource = Boolean(
      analysis?.video?.pixelFormat?.includes('10') ||
      analysis?.video?.bitDepth === 10
    )

    if (process.platform === 'linux' && (is10BitSource || options.targetCodec === 'av1')) {
      args.push('-pix_fmt', 'p010le')
    } else if (process.platform === 'linux') {
      args.push('-pix_fmt', 'nv12')
    } else if (is10BitSource || options.targetCodec === 'av1') {
      args.push('-vf', 'format=p010le,hwupload')
    } else {
      args.push('-vf', 'format=nv12,hwupload')
    }

    appendStreamMappingArgs(args, analysis, options)
    args.push(...hdrArgs)
    if (!options.targetConversion && output.toLowerCase().endsWith('.mp4')) {
      args.push('-movflags', '+faststart')
    }
    args.push(output)
    applyTargetTranscodePlan(args, options)
    return args
  }
}
