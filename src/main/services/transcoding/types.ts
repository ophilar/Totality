
import type { FileAnalysisResult } from '../MediaFileAnalyzer'
import type { GpuEncoderDeviceSelector } from '../utils/GpuDetector'

export interface TranscodeOptions {
  playbackPolicy?: 'allow-transcoding' | 'avoid-video-transcoding' | 'direct-play'
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
  gpuDeviceSelector?: GpuEncoderDeviceSelector
  transcodingEngine?: 'ffmpeg'
  targetSize?: string
  maxOutputBytes?: number
  optimizationMode?: 'smart' | 'remux_only' | 'transcode'
  qualityProfile?: 'transparent' | 'balanced' | 'maximum_savings'
  encoderPolicy?: 'automatic' | 'hardware' | 'software' | 'compare'
  targetProfileId?: string | null
  targetContainer?: 'mkv' | 'mp4'
  targetAudioCodec?: 'aac' | 'ac3' | 'eac3'
  audioConversions?: Array<{ sourceIndex: number; codec: string; bitrateKbps: number }>
  /** Internal: measured candidate is encoding a software-decoded FFV1 reference. */
  measurementReferenceInput?: boolean
  targetHdrFormat?: 'SDR' | 'HDR10'
  targetConversion?: unknown
}

export interface ITranscodeCommandBuilder {
  buildFFmpegArgs(input: string, output: string, options: TranscodeOptions, analysis: FileAnalysisResult): string[]
}
