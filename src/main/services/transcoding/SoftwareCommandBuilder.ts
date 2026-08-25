import * as os from 'os'
import { ITranscodeCommandBuilder } from './types'
import { TranscodeOptions } from '../TranscodingService'
import { FileAnalysisResult } from '../MediaFileAnalyzer'
import { buildHdrMetadataArgs } from './HdrTranscodingPolicy'
import { appendStreamMappingArgs } from './StreamSelectionPlan'

export class SoftwareCommandBuilder implements ITranscodeCommandBuilder {
  buildFFmpegArgs(input: string, output: string, options: TranscodeOptions, _analysis: FileAnalysisResult): string[] {
    const hdrArgs = buildHdrMetadataArgs(_analysis)
    const codec = options.targetCodec === 'av1' ? 'libsvtav1' : 'libx265'
    const crf = (options.crf ?? 22).toString()
    
    // Generic CPU reserve: leave at least 1-2 cores for UI and OS responsiveness
    const totalCpus = os.cpus()?.length || 4
    const softwareThreads = Math.max(1, totalCpus > 4 ? totalCpus - 2 : totalCpus - 1)

    const sourceBitrate = _analysis?.video?.bitrate || _analysis?.overallBitrate || (_analysis?.duration && _analysis?.fileSize ? Math.round((_analysis.fileSize * 8) / _analysis.duration) : undefined)

    const args: string[] = [
      '-y',
      '-threads', softwareThreads.toString(),
      '-i', input,
      '-fps_mode', 'cfr',
      ...(options.targetCodec === 'av1' ? ['-svtav1-params', 'tune=0'] : []),
      '-c:v', codec,
      '-crf', crf,
      '-preset', options.preset || 'medium',
      ...(sourceBitrate ? ['-maxrate', `${sourceBitrate}`, '-bufsize', `${sourceBitrate * 2}`] : []),
      '-pix_fmt', 'yuv420p10le'
    ]

    appendStreamMappingArgs(args, _analysis, options)
    args.push(...hdrArgs)
    args.push(output)
    return args
  }

}
