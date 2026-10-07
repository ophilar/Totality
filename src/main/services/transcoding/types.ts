import type { FileAnalysisResult } from '../MediaFileAnalyzer'

export interface TranscodeOptions {
  targetCodec?: 'av1' | 'hevc'
  streamSelection?: unknown
  outputMode?: 'copy' | 'quarantine-replace' | 'replace'
  tempDirectory?: string
  priority?: 'low' | 'normal' | 'high'
  useGpu?: boolean
  encoder?: string
  crf?: number
  preset?: string
  customArgs?: string
  gpuId?: string
  transcodingEngine?: 'ffmpeg'
  targetSize?: string
  maxOutputBytes?: number
  optimizationMode?: 'smart' | 'remux_only' | 'transcode'
  qualityProfile?: 'transparent' | 'balanced' | 'maximum_savings'
  encoderPolicy?: 'hardware' | 'software' | 'compare'
  targetProfileId?: string
  targetContainer?: 'mkv' | 'mp4'
  targetAudioCodec?: 'aac' | 'ac3' | 'eac3'
  audioConversions?: Array<{ sourceIndex: number; codec: string; bitrateKbps: number }>
  targetHdrFormat?: 'SDR' | 'HDR10'
  targetConversion?: unknown
}

export interface ITranscodeCommandBuilder {
  buildFFmpegArgs(input: string, output: string, options: TranscodeOptions, analysis: FileAnalysisResult): string[]
}
