
import type { ITranscodeCommandBuilder, TranscodeOptions } from './types'
import type { FileAnalysisResult } from '../MediaFileAnalyzer'
import { buildHdrMetadataArgs } from './HdrTranscodingPolicy'
import { appendStreamMappingArgs } from './StreamSelectionPlan'
import { applyTargetTranscodePlan } from './TargetTranscodePlan'
import { APP_CONFIG } from '@main/config'
import { getEncoderBitDepth } from './EncoderPixelFormat'

export class IntelCommandBuilder implements ITranscodeCommandBuilder {
  buildFFmpegArgs(input: string, output: string, options: TranscodeOptions, analysis: FileAnalysisResult): string[] {
    if (process.platform === 'win32' && options.gpuDeviceSelector?.kind !== 'directx') throw new Error('The selected Intel adapter could not be mapped to a DirectX device.')
    if (process.platform === 'linux' && options.gpuDeviceSelector?.kind !== 'drm') throw new Error('The selected Intel adapter has no DRM render device.')
    if (process.platform !== 'win32' && process.platform !== 'linux') throw new Error('Per-device Intel QSV encoding is unavailable on this platform.')
    const hdrArgs = buildHdrMetadataArgs(analysis, options)
    const bitDepth = getEncoderBitDepth(analysis, options)
    const codec = options.targetCodec === 'av1' ? 'av1_qsv' : 'hevc_qsv'
    const quality = (options.crf ?? APP_CONFIG.transcoding.defaultIntelQuality).toString()
    const surfaceFormat = bitDepth === 10 ? 'p010le' : 'nv12'

    const args: string[] = [
      '-y',
      '-init_hw_device', process.platform === 'win32'
        ? `qsv=selected:hw,child_device=${options.gpuDeviceSelector?.kind === 'directx' ? options.gpuDeviceSelector.index : ''},child_device_type=d3d11va`
        : `qsv=selected:hw,child_device=${options.gpuDeviceSelector?.kind === 'drm' ? options.gpuDeviceSelector.path : ''}`,
      '-filter_hw_device', 'selected',
      '-hwaccel', 'qsv', '-hwaccel_output_format', 'qsv', '-hwaccel_device', 'selected',
      '-i', input,
      '-fps_mode', 'passthrough',
      '-vf', `vpp_qsv=format=${surfaceFormat}`,
      '-c:v', codec,
      '-preset', options.preset || APP_CONFIG.transcoding.defaultIntelPreset,
      '-global_quality', quality,
    ]

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
