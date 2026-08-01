import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EventEmitter } from 'events'
import { TranscodingService, TranscodeError, TranscodeOptions } from '../../../src/main/services/TranscodingService'
import { TranscodeCommandFactory } from '../../../src/main/services/transcoding/TranscodeCommandFactory'
import { GpuDetector } from '../../../src/main/services/utils/GpuDetector'
import { getMediaFileAnalyzer } from '../../../src/main/services/MediaFileAnalyzer'
import * as childProcess from 'child_process'

vi.mock('../../../src/main/database/BetterSQLiteService', () => ({
  getDatabase: () => ({
    isInitialized: true,
    config: {
      getSetting: vi.fn().mockResolvedValue(null)
    }
  })
}))

vi.mock('../../../src/main/services/LoggingService', () => ({
  getLoggingService: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    verbose: vi.fn()
  })
}))

vi.mock('../../../src/main/services/GeminiService', () => ({
  getGeminiService: () => ({
    isConfigured: () => false,
    sendMessage: vi.fn()
  })
}))

vi.mock('../../../src/main/services/MediaFileAnalyzer', () => ({
  getMediaFileAnalyzer: () => ({
    analyzeFile: vi.fn().mockResolvedValue({
      success: true,
      filePath: 'input.mp4',
      video: {
        index: 0,
        codec: 'h264',
        width: 1920,
        height: 1080,
        pix_fmt: 'yuv420p10le'
      },
      audioTracks: [],
      subtitleTracks: []
    }),
    isAvailable: vi.fn().mockResolvedValue(true),
    getFFmpegPath: vi.fn().mockReturnValue('ffmpeg')
  })
}))

vi.mock('../../../src/main/services/utils/GpuDetector', () => ({
  GpuDetector: {
    detectGpus: vi.fn().mockResolvedValue([
      { id: 'gpu-0', name: 'NVIDIA GeForce RTX 4090', vendor: 'NVIDIA' }
    ])
  }
}))

describe('TranscodeError', () => {
  it('constructs with message, exitCode, and stderr', () => {
    const err = new TranscodeError('Process failed', 1, 'Error: invalid codec')
    expect(err).toBeInstanceOf(Error)
    expect(err.name).toBe('TranscodeError')
    expect(err.message).toBe('Process failed')
    expect(err.exitCode).toBe(1)
    expect(err.stderr).toBe('Error: invalid codec')
  })
})

describe('TranscodingService', () => {
  let service: TranscodingService

  beforeEach(() => {
    vi.clearAllMocks()
    service = new TranscodingService()
  })

  describe('getTranscodeParameters', () => {
    it('delegates to TranscodeCommandFactory to get hardware builders', async () => {
      const getBuilderSpy = vi.spyOn(TranscodeCommandFactory, 'getBuilder')

      const options: TranscodeOptions = {
        targetCodec: 'hevc',
        useGpu: true,
        crf: 20,
        preset: 'p6'
      }

      const params = await service.getTranscodeParameters('input.mp4', options)

      expect(getBuilderSpy).toHaveBeenCalledWith('NVIDIA', expect.objectContaining({
        targetCodec: 'hevc',
        useGpu: true,
        crf: 20,
        preset: 'p6'
      }))

      expect(params.ffmpegArgs).toContain('-hwaccel')
      expect(params.ffmpegArgs).toContain('cuda')
      expect(params.ffmpegArgs).toContain('hevc_nvenc')
      expect(params.handbrakeArgs).toContain('--encoder')
      expect(params.handbrakeArgs).toContain('nvenc_h265_10bit')
    })

    it('delegates to SoftwareCommandBuilder when useGpu is false', async () => {
      const getBuilderSpy = vi.spyOn(TranscodeCommandFactory, 'getBuilder')

      const options: TranscodeOptions = {
        targetCodec: 'av1',
        useGpu: false,
        crf: 24,
        preset: 'medium'
      }

      const params = await service.getTranscodeParameters('input.mp4', options)

      expect(getBuilderSpy).toHaveBeenCalledWith('Unknown', expect.objectContaining({
        targetCodec: 'av1',
        crf: 24
      }))

      expect(params.ffmpegArgs).toContain('libsvtav1')
      expect(params.handbrakeArgs).toContain('svt_av1_10bit')
    })
  })

  describe('Process Diagnostic Error Tracking', () => {
    it('runFFmpeg throws TranscodeError with stderr diagnostic log on process exit failure', async () => {
      const mockProc = new EventEmitter() as any
      mockProc.stdout = new EventEmitter()
      mockProc.stderr = new EventEmitter()
      mockProc.kill = vi.fn()

      vi.spyOn(childProcess, 'spawn').mockReturnValue(mockProc)

      const options: TranscodeOptions = { useGpu: false }
      const params = await service.getTranscodeParameters('input.mp4', options)

      const runPromise = (service as any).runFFmpeg(
        'input.mp4',
        'output.mkv',
        params,
        options,
        vi.fn()
      )

      mockProc.stderr.emit('data', Buffer.from('[ffmpeg] Invalid video stream parameters\n'))
      mockProc.stderr.emit('data', Buffer.from('Conversion failed!\n'))
      mockProc.emit('close', 1)

      await expect(runPromise).rejects.toThrow(TranscodeError)
      await runPromise.catch((err: TranscodeError) => {
        expect(err.exitCode).toBe(1)
        expect(err.stderr).toContain('[ffmpeg] Invalid video stream parameters')
        expect(err.stderr).toContain('Conversion failed!')
      })
    })

    it('runHandbrake throws TranscodeError with stderr diagnostic log on process failure', async () => {
      const mockProc = new EventEmitter() as any
      mockProc.stdout = new EventEmitter()
      mockProc.stderr = new EventEmitter()
      mockProc.kill = vi.fn()

      vi.spyOn(childProcess, 'spawn').mockReturnValue(mockProc)

      const runPromise = (service as any).runHandbrake(
        ['--encoder', 'x265'],
        vi.fn()
      )

      mockProc.stderr.emit('data', Buffer.from('Handbrake error: Muxing failed\n'))
      mockProc.emit('close', 2)

      await expect(runPromise).rejects.toThrow(TranscodeError)
      await runPromise.catch((err: TranscodeError) => {
        expect(err.exitCode).toBe(2)
        expect(err.stderr).toContain('Handbrake error: Muxing failed')
      })
    })
  })
})
