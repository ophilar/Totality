export interface TranscodeOptions {
  targetCodec: 'av1' | 'hevc'
  outputMode: 'copy' | 'quarantine-replace' | 'replace'
  tempDirectory?: string
  streamSelection?:
    | { audio: 'all'; subtitle: 'all'; subtitleLanguageWhitelist?: string[]; defaultSubtitle?: 'preserve' | 'none' }
    | { audio: 'original-and-protected'; originalLanguage: string; subtitle: 'all'; subtitleLanguageWhitelist?: string[]; defaultSubtitle?: 'preserve' | 'none' }
  useGpu: boolean
  gpuId: string
  encoder: string
  crf?: number
  preset: string
  customArgs: string
  transcodingEngine: 'ffmpeg'
  targetSize: string
  maxOutputBytes?: number
  optimizationMode?: 'smart' | 'remux_only' | 'transcode'
  qualityProfile?: 'transparent' | 'balanced' | 'maximum_savings'
  encoderPolicy?: 'hardware' | 'software' | 'compare'
  targetProfileId?: string
}

export type { ShowTranscodePreflight } from '@main/services/TranscodingService'

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
