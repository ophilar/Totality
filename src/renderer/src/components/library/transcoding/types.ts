export interface TranscodeOptions {
  targetCodec: 'av1' | 'hevc'
  preserveSubtitles: boolean
  preserveAllAudio: boolean
  overwriteOriginal: boolean
  useGpu: boolean
  gpuId: string
  encoder: string
  crf: number
  preset: string
  customArgs: string
  transcodingEngine: 'handbrake' | 'ffmpeg'
  targetSize: string
  aiOptimize?: boolean
}

export interface TranscodingParams {
  summary: string
  handbrakeArgs: string[]
  ffmpegArgs?: string[]
  expectedSizeReduction?: string
  warnings?: string[]
  encoder?: string
  crf?: number
  preset?: string
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
  status?: 'encoding' | 'complete' | 'failed' | 'cancelled'
  mediaItemId?: number
  logs?: string[]
}

export interface Availability {
  handbrake: boolean
  mkvtoolnix: boolean
  ffmpeg: boolean
}
