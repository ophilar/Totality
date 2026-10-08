import type { TranscodeOptions as MainTranscodeOptions } from '@main/services/TranscodingService'

export type TranscodeOptions = MainTranscodeOptions & Required<Pick<MainTranscodeOptions,
  'targetCodec' | 'outputMode' | 'useGpu' | 'gpuId' | 'encoder' | 'preset' | 'customArgs' | 'transcodingEngine' | 'targetSize'
>>

export type { PlannedOptimizationOperation, ShowTranscodePreflight } from '@main/services/TranscodingService'

export interface TranscodingParams {
  summary: string
  ffmpegArgs?: string[]
  expectedSizeReduction?: string
  warnings?: string[]
  encoder?: string
  crf?: number
  preset?: string
  audioTracks?: Array<{ index: number; codec: string; language?: string; title?: string; channels: number; isDefault: boolean; hasObjectAudio: boolean }>
  subtitleTracks?: Array<{ index: number; codec: string; language?: string; title?: string; isDefault: boolean; isForced: boolean }>
}

export interface GpuInfo {
  id: string
  name: string
  vendor: 'NVIDIA' | 'Intel' | 'AMD' | 'Apple' | 'Unknown'
}

export interface PresetTemplate {
  name: string
  options: TranscodeOptions
}

export interface TranscodeProgress {
  percent: number
  fps?: number
  speed?: string
  eta?: string
  error?: string
  status?: 'encoding' | 'initializing' | 'muxing' | 'verifying' | 'complete' | 'failed' | 'cancelled'
  mediaItemId?: number
  logs?: string[]
}

export interface Availability {
  ffmpeg: boolean
}
