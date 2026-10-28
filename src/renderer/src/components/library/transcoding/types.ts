import type {
  TranscodeOptions as MainTranscodeOptions,
  TranscodeProgress as MainTranscodeProgress,
} from '@main/services/TranscodingService'
import type { ShowTranscodePreflight, ShowTranscodeRequest } from '@main/services/TranscodingService'

export type TranscodeOptions = MainTranscodeOptions & Required<Pick<MainTranscodeOptions,
  'useGpu' | 'gpuId' | 'encoder' | 'preset' | 'customArgs' | 'transcodingEngine' | 'targetSize'
>>

export type { PlannedOptimizationOperation, ShowTranscodePreflight, ShowTranscodeRequest } from '@main/services/TranscodingService'

export interface SavedShowPreflight {
  request: ShowTranscodeRequest
  result: ShowTranscodePreflight
}

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
  options: unknown
  error?: string
}

export type TranscodeProgress = Pick<MainTranscodeProgress,
  'percent' | 'fps' | 'speed' | 'eta' | 'error'
> & {
  status?: MainTranscodeProgress['status']
  mediaItemId?: number
  logs?: string[]
}

export interface Availability {
  ffmpeg: boolean
}
