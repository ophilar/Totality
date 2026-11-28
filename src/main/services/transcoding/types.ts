
import type { FileAnalysisResult } from '../MediaFileAnalyzer'
import type { GpuEncoderDeviceSelector } from '../utils/GpuDetector'

import type { StreamSelectionPolicy } from './StreamSelectionPlan'
import type { TargetTranscodePlan } from './TargetTranscodePlan'
import type { OptimizationVideoCodec } from './OptimizationCodecPolicy'

/** Shared resolved and request-time options for planning, command builders and execution. */
export interface TranscodeOptions {
  playbackPolicy?: 'allow-transcoding' | 'avoid-video-transcoding' | 'direct-play'
  targetProfileMode?: 'advisory'
  targetCodec?: OptimizationVideoCodec
  streamSelection?: StreamSelectionPolicy
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
  targetContainerSelection?: 'automatic' | 'user-selected'
  targetAudioCodec?: 'aac' | 'ac3' | 'eac3'
  audioConversions?: Array<{ sourceIndex: number; codec: string; bitrateKbps: number }>
  /** Internal: the measurement candidate decodes an FFV1 lossless reference. */
  measurementReferenceInput?: boolean
  targetHdrFormat?: 'SDR' | 'HDR10'
  targetConversion?: TargetTranscodePlan
  /** Internal calibration control; normal optimization uses the configured sample duration. */
  measurementSampleDurationSeconds?: number
  /** Internal calibration control; normal optimization uses the configured search budget. */
  measurementCandidateBudget?: number
  measurementSamplePositions?: readonly number[]
}

export interface ITranscodeCommandBuilder {
  buildFFmpegArgs(input: string, output: string, options: TranscodeOptions, analysis: FileAnalysisResult): string[]
}
