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
  transcodingEngine: 'ffmpeg'
  targetSize: string
  aiOptimize?: boolean
}

export interface TranscodingParams {
  summary: string
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
  status?: 'encoding' | 'initializing' | 'muxing' | 'verifying' | 'complete' | 'failed' | 'cancelled'
  mediaItemId?: number
  logs?: string[]
}

export interface Availability {
  /** Legacy compatibility field; always false after the FFmpeg-only migration. */
  handbrake: boolean
  mkvtoolnix: boolean
  ffmpeg: boolean
}
