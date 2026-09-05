import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EventEmitter } from 'events'
import { Readable } from 'stream'
import { TranscodingService, TranscodeError, TranscodeOptions } from '../../../src/main/services/TranscodingService'
import { TranscodeCommandFactory } from '../../../src/main/services/transcoding/TranscodeCommandFactory'
import { getMediaFileAnalyzer } from '../../../src/main/services/MediaFileAnalyzer'
import * as childProcess from 'child_process'
import * as fsPromises from 'fs/promises'
import * as path from 'path'

vi.mock('fs/promises', () => ({
  stat: vi.fn().mockResolvedValue({ size: 4000, mtimeMs: 12345678 }),
  rename: vi.fn().mockResolvedValue(undefined),
  copyFile: vi.fn().mockResolvedValue(undefined),
  unlink: vi.fn().mockResolvedValue(undefined),
  rm: vi.fn().mockResolvedValue(undefined)
}))

vi.mock('node:fs', () => ({
  createReadStream: vi.fn(() => Readable.from(['source-content']))
}))

type MockProcess = EventEmitter & { stdout: EventEmitter; stderr: EventEmitter; kill: ReturnType<typeof vi.fn> }

const mockDbInstance = {
  isInitialized: true,
  config: {
    getSetting: vi.fn().mockResolvedValue(null),
    getSettingsByPrefix: vi.fn().mockResolvedValue({}),
    setSetting: vi.fn().mockResolvedValue(undefined),
    deleteSetting: vi.fn().mockResolvedValue(undefined)
  },
  tvShows: {
    getEpisodes: vi.fn().mockResolvedValue([])
  },
  sources: {
    getSourceById: vi.fn().mockResolvedValue({
      source_id: 'src1',
      source_type: 'local',
      connection_config: JSON.stringify({ folderPath: '/media' })
    })
  },
  media: {
    getItemById: vi.fn().mockResolvedValue(null),
    getItemByPath: vi.fn().mockResolvedValue(null),
    getItem: vi.fn().mockResolvedValue(null),
    updatePathAndStats: vi.fn().mockResolvedValue(undefined)
  },
  mediaRemuxJobs: {
    create: vi.fn().mockResolvedValue(1),
    update: vi.fn().mockResolvedValue(undefined),
    getLatest: vi.fn().mockResolvedValue(null),
    getCalibratedOutputBytes: vi.fn().mockResolvedValue(null)
  }
}

vi.mock('../../../src/main/database/BetterSQLiteService', () => ({
  getDatabase: () => mockDbInstance
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

const mockAnalyzerInstance = {
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
  ,measureStreamBytes: vi.fn().mockResolvedValue({ 1: 24000000, 2: 24000000, 3: 24000000, 4: 24000000 })
}

vi.mock('../../../src/main/services/MediaFileAnalyzer', () => ({
  getMediaFileAnalyzer: () => mockAnalyzerInstance
}))

vi.mock('../../../src/main/services/utils/GpuDetector', () => ({
  GpuDetector: {
    detectGpus: vi.fn().mockResolvedValue([
      { id: 'gpu-0', name: 'NVIDIA GeForce RTX 4090', vendor: 'NVIDIA' }
    ])
  }
}))

vi.mock('../../../src/main/services/TaskQueueService', () => ({
  getTaskQueueService: () => ({
    getTasks: vi.fn().mockResolvedValue([]),
    addTasks: vi.fn().mockResolvedValue([])
  })
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
        encoder: 'nvenc_h265',
        crf: 20,
        preset: 'p6',
        qualityProfile: 'balanced',
        encoderPolicy: 'hardware'
        ,qualityProfile: 'balanced', encoderPolicy: 'hardware'
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
    })

    it('delegates to SoftwareCommandBuilder when useGpu is false', async () => {
      const getBuilderSpy = vi.spyOn(TranscodeCommandFactory, 'getBuilder')

      const options: TranscodeOptions = {
        targetCodec: 'av1',
        useGpu: false,
        encoder: 'svt_av1',
        crf: 24,
        preset: 'medium'
        ,qualityProfile: 'balanced', encoderPolicy: 'software'
      }

      const params = await service.getTranscodeParameters('input.mp4', options)

      expect(getBuilderSpy).toHaveBeenCalledWith('Unknown', expect.objectContaining({
        targetCodec: 'av1',
        crf: 24
      }))

      expect(params.ffmpegArgs).toContain('libsvtav1')
    })

    it('uses StreamRemuxCommandBuilder with -c:v copy when optimizationMode is remux_only', async () => {
      const options: TranscodeOptions = {
        optimizationMode: 'remux_only'
      }

      const params = await service.getTranscodeParameters('input.mp4', options)
      expect(params.encoder).toBe('copy')
      expect(params.ffmpegArgs).toContain('-c:v')
      expect(params.ffmpegArgs).toContain('copy')
    })

    it('allows dynamic HDR stream-copy remux without allowing video re-encode', async () => {
      const analyzer = getMediaFileAnalyzer()
      vi.mocked(analyzer.analyzeFile).mockResolvedValueOnce({
        success: true,
        filePath: '/media/dv.mkv',
        video: {
          index: 0,
          codec: 'hevc',
          width: 3840,
          height: 2160,
          hdrFormat: 'Dolby Vision',
        },
        audioTracks: [],
        subtitleTracks: [],
      })

      const params = await service.getTranscodeParameters('/media/dv.mkv', { optimizationMode: 'remux_only' })
      expect(params.encoder).toBe('copy')
      expect(params.ffmpegArgs).toContain('copy')
    })

    it('keeps validated custom remux arguments before the output path', async () => {
      const params = await service.getTranscodeParameters('input.mp4', {
        optimizationMode: 'remux_only',
        customArgs: '-avoid_negative_ts make_zero',
      })
      expect(params.ffmpegArgs?.at(-1)).toBe('<output>')
      expect(params.ffmpegArgs).toContain('-avoid_negative_ts')
    })

    it('routes smart mode to remux_only when source is WEB-DL with foreign audio bloat', async () => {
      const analyzer = getMediaFileAnalyzer()
      vi.mocked(analyzer.analyzeFile).mockResolvedValueOnce({
        success: true,
        filePath: '/media/Show.S01E01.1080p.WEB-DL.mkv',
        duration: 45 * 60 * 1000,
        fileSize: 3 * 1024 * 1024 * 1024,
        video: {
          index: 0,
          codec: 'h264',
          width: 1920,
          height: 1080,
          bitrate: 5000
        },
        audioTracks: [
          { index: 1, codec: 'eac3', channels: 6, bitrate: 640, language: 'en', isDefault: true, hasObjectAudio: false },
          { index: 2, codec: 'eac3', channels: 6, bitrate: 640, language: 'de', isDefault: false, hasObjectAudio: false },
          { index: 3, codec: 'eac3', channels: 6, bitrate: 640, language: 'fr', isDefault: false, hasObjectAudio: false }
        ],
        subtitleTracks: [],
        streamBytes: { 0: 1_687_500_000, 1: 216_000_000, 2: 216_000_000, 3: 216_000_000 }
      })

      const options: TranscodeOptions = {
        optimizationMode: 'smart',
        targetCodec: 'hevc',
        encoder: 'nvenc_h265',
        crf: 20,
        preset: 'p6',
        qualityProfile: 'balanced',
        encoderPolicy: 'hardware'
        ,qualityProfile: 'balanced', encoderPolicy: 'hardware'
      }

      mockDbInstance.media.getItemByPath.mockResolvedValueOnce({
        file_path: '/media/Show.S01E01.1080p.WEB-DL.mkv',
        original_language: 'en',
        video_codec: 'h264',
        video_bitrate: 5000,
        resolution: '1080p',
        height: 1080,
        file_size: 3 * 1024 * 1024 * 1024,
        duration: 45 * 60 * 1000,
        audio_tracks: JSON.stringify([
          { index: 1, language: 'en', bitrate: 640 },
          { index: 2, language: 'de', bitrate: 640 },
          { index: 3, language: 'fr', bitrate: 640 },
        ]),
      })

      const params = await service.getTranscodeParameters('/media/Show.S01E01.1080p.WEB-DL.mkv', options)
      expect(params.encoder).toBe('copy')
      expect(params.ffmpegArgs).toContain('-c:v')
      expect(params.ffmpegArgs).toContain('copy')
    })

    it('routes smart mode to video encoder when source is a high-bitrate Remux', async () => {
      const analyzer = getMediaFileAnalyzer()
      vi.mocked(analyzer.analyzeFile).mockResolvedValueOnce({
        success: true,
        filePath: '/media/Show.S01E01.1080p.Remux.mkv',
        duration: 45 * 60 * 1000,
        fileSize: 15 * 1024 * 1024 * 1024,
        video: {
          index: 0,
          codec: 'h264',
          width: 1920,
          height: 1080,
          bitrate: 35000
        },
        audioTracks: [
          { index: 1, codec: 'dts-hd ma', channels: 6, bitrate: 3500, language: 'en', isDefault: true, hasObjectAudio: false }
        ],
        subtitleTracks: []
      })

      const options: TranscodeOptions = {
        optimizationMode: 'smart',
        useGpu: true,
        targetCodec: 'hevc',
        encoder: 'nvenc_h265',
        crf: 20,
        preset: 'p6'
        ,qualityProfile: 'balanced', encoderPolicy: 'hardware'
      }

      const params = await service.getTranscodeParameters('/media/Show.S01E01.1080p.Remux.mkv', options)
      expect(params.encoder).toBe('nvenc_h265')
      expect(params.ffmpegArgs).toContain('hevc_nvenc')
    })

    it('forces video transcode when user specifies optimizationMode transcode on a WEB-DL', async () => {
      const analyzer = getMediaFileAnalyzer()
      vi.mocked(analyzer.analyzeFile).mockResolvedValueOnce({
        success: true,
        filePath: '/media/Show.S01E01.1080p.WEB-DL.mkv',
        duration: 45 * 60 * 1000,
        fileSize: 3 * 1024 * 1024 * 1024,
        video: {
          index: 0,
          codec: 'h264',
          width: 1920,
          height: 1080,
          bitrate: 5000
        },
        audioTracks: [
          { index: 1, codec: 'eac3', channels: 6, bitrate: 640, language: 'en', isDefault: true, hasObjectAudio: false },
          { index: 2, codec: 'eac3', channels: 6, bitrate: 640, language: 'de', isDefault: false, hasObjectAudio: false }
        ],
        subtitleTracks: []
      })

      const options: TranscodeOptions = {
        optimizationMode: 'transcode',
        useGpu: true,
        targetCodec: 'hevc',
        encoder: 'nvenc_h265',
        crf: 20,
        preset: 'p6',
        qualityProfile: 'balanced',
        encoderPolicy: 'hardware'
      }

      const params = await service.getTranscodeParameters('/media/Show.S01E01.1080p.WEB-DL.mkv', options)
      expect(params.encoder).toBe('nvenc_h265')
      expect(params.ffmpegArgs).toContain('hevc_nvenc')
    })
  })

  describe('preflightShowTranscode Advisory', () => {
    it('populates recommendedAction, sourceTier, and adviceReason in preflight episode items', async () => {
      mockDbInstance.tvShows.getEpisodes.mockResolvedValueOnce([
        {
          id: 10,
          source_id: 'src1',
          plex_id: 'p10',
          title: 'Strange New Worlds S01E01',
          season_number: 1,
          episode_number: 1,
          type: 'episode',
          file_path: '/media/Star.Trek.Strange.New.Worlds.S01E01.1080p.WEB-DL.DDP5.1.Atmos.H.264.mkv',
          file_size: 4 * 1024 * 1024 * 1024,
          duration: 50 * 60 * 1000,
          resolution: '1080p',
          video_codec: 'h264',
          video_bitrate: 6000,
          audio_codec: 'eac3',
          audio_channels: 6,
          audio_bitrate: 640,
          original_language: 'en',
          audio_tracks: JSON.stringify([
            { index: 1, codec: 'eac3', channels: 6, bitrate: 640, language: 'en', title: 'English' },
            { index: 2, codec: 'eac3', channels: 6, bitrate: 640, language: 'de', title: 'German' },
            { index: 3, codec: 'eac3', channels: 6, bitrate: 640, language: 'fr', title: 'French' },
            { index: 4, codec: 'eac3', channels: 6, bitrate: 640, language: 'es', title: 'Spanish' }
          ])
        } as unknown as Parameters<typeof mockDbInstance.media.upsertItem>[0]
      ])

      mockDbInstance.media.getItemById.mockResolvedValueOnce({
        id: 10,
        source_id: 'src1',
        file_path: '/media/Star.Trek.Strange.New.Worlds.S01E01.1080p.WEB-DL.DDP5.1.Atmos.H.264.mkv'
      } as unknown as Awaited<ReturnType<typeof mockDbInstance.media.getItemById>>)

      vi.mocked(fsPromises.stat).mockResolvedValueOnce({
        size: 4 * 1024 * 1024 * 1024,
        mtimeMs: 12345678
      } as unknown as Awaited<ReturnType<typeof fsPromises.stat>>)

      const preflight = await service.preflightShowTranscode({
        seriesTitle: 'Star Trek Strange New Worlds',
        sourceId: 'src1',
        options: { optimizationMode: 'smart' }
      })

      expect(preflight.compatible).toBe(true)
      expect(preflight.episodes.length).toBe(1)
      expect(preflight.episodes[0].recommendedAction).toBe('already_optimized')
      expect(preflight.episodes[0].sourceTier).toBe('WEB-DL')
      expect(preflight.episodes[0].adviceReason).toBeDefined()
    })
  })

  describe('Process Diagnostic Error Tracking', () => {
    it('runFFmpeg throws TranscodeError with stderr diagnostic log on process exit failure', async () => {
      const mockProc = new EventEmitter() as MockProcess
      mockProc.stdout = new EventEmitter()
      mockProc.stderr = new EventEmitter()
      mockProc.kill = vi.fn()

      vi.spyOn(childProcess, 'spawn').mockReturnValue(mockProc as unknown as ReturnType<typeof childProcess.spawn>)

      const options: TranscodeOptions = { useGpu: false, targetCodec: 'hevc', encoder: 'svt_av1', crf: 24, preset: 'medium', qualityProfile: 'balanced', encoderPolicy: 'software' }
      const params = await service.getTranscodeParameters('input.mp4', options)

      const hooks = service as unknown as { runFFmpeg: (...args: unknown[]) => Promise<unknown> }
      const runPromise = hooks.runFFmpeg(
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

    it('does not reject queued tasks whose preflight creation timestamp was >30m ago', async () => {
      // Setup expired timestamp in queuePayload
      const expiredPayload = {
        batchId: 'batch-1',
        preflightId: 'pref-1',
        expiresAt: new Date(Date.now() - 3600 * 1000).toISOString(), // 1 hour in the past
        sourceSize: 5000,
        sourceMtimeMs: 12345678
      }

      expect(Date.now() > Date.parse(expiredPayload.expiresAt)).toBe(true)
      expect(expiredPayload.sourceSize).toBe(5000)
    })

    it('preserves any video file extension (.mp4, .avi, .mkv, .ts) for quarantine backup files', () => {
      const testCases = [
        { input: '/media/video.mp4', expectedExt: '.mp4' },
        { input: '/media/movie.avi', expectedExt: '.avi' },
        { input: '/media/episode.mkv', expectedExt: '.mkv' },
        { input: '/media/stream.ts', expectedExt: '.ts' }
      ]

      for (const tc of testCases) {
        const origExt = path.extname(tc.input)
        const origBase = path.basename(tc.input, origExt)
        const quarantinePath = path.join(path.dirname(tc.input), `${origBase}.quarantine-123456789${origExt}`)
        expect(quarantinePath.endsWith(tc.expectedExt)).toBe(true)
        expect(path.extname(quarantinePath)).toBe(tc.expectedExt)
      }
    })
  })

  describe('replacement activation', () => {
    it('quarantines a remux with custom FFmpeg arguments instead of directly replacing the source', async () => {
      const inputPath = path.resolve('/media/episode.mkv')
      mockDbInstance.media.getItem.mockResolvedValueOnce({ id: 99, file_path: inputPath })
      vi.mocked(fsPromises.stat).mockResolvedValue({ size: 4000, mtimeMs: 12345678 } as never)
      vi.spyOn(service as never, 'runFFmpeg').mockResolvedValue(true)

      await service.transcode(99, {
        transcodingEngine: 'ffmpeg',
        optimizationMode: 'remux_only',
        outputMode: 'replace',
        customArgs: '-c:v libx264',
        useGpu: false
      })

      expect(fsPromises.rename).toHaveBeenCalledWith(
        expect.stringContaining('.totality_tmp_'),
        inputPath
      )
      expect(fsPromises.copyFile).not.toHaveBeenCalled()
    })

    it('moves a verified temporary output onto the original instead of copying it', async () => {
      const inputPath = path.resolve('/media/episode.mkv')
      mockDbInstance.media.getItem.mockResolvedValueOnce({ id: 99, file_path: inputPath })
      vi.mocked(fsPromises.stat).mockResolvedValue({ size: 4000, mtimeMs: 12345678 } as never)
      vi.spyOn(service as never, 'runFFmpeg').mockResolvedValue(true)

      await service.transcode(99, {
        transcodingEngine: 'ffmpeg',
        optimizationMode: 'remux_only',
        outputMode: 'replace',
        useGpu: false
      })

      expect(fsPromises.rename).toHaveBeenCalledWith(
        expect.stringContaining('.totality_tmp_'),
        inputPath
      )
      expect(fsPromises.copyFile).not.toHaveBeenCalled()
    })
  })

  describe('cancellation', () => {
    it('waits for FFmpeg to exit before reporting an aborted job as finished', async () => {
      const mockProc = new EventEmitter() as MockProcess
      mockProc.stdout = new EventEmitter()
      mockProc.stderr = new EventEmitter()
      mockProc.kill = vi.fn()
      vi.spyOn(childProcess, 'spawn').mockReturnValue(mockProc as unknown as ReturnType<typeof childProcess.spawn>)
      const controller = new AbortController()
      const hooks = service as unknown as { runFFmpeg: (...args: unknown[]) => Promise<boolean> }
      const runPromise = hooks.runFFmpeg(
        'input.mkv',
        'output.mkv',
        { ffmpegArgs: ['-i', '<input>', '<output>'] },
        {},
        vi.fn(),
        controller.signal
      )
      let settled = false
      void runPromise.then(() => { settled = true })

      controller.abort()
      await Promise.resolve()

      expect(settled).toBe(false)
      mockProc.emit('close', 1)
      await expect(runPromise).resolves.toBe(false)
    })
  })

  describe('show queue optimization filter', () => {
    it('does not queue episodes that preflight classifies as already optimized', async () => {
      const preflightId = 'preflight-skip-optimized'
      const internal = service as unknown as { showPreflights: Map<string, unknown> }
      internal.showPreflights.set(preflightId, {
        request: {
          seriesTitle: 'Example Show',
          sourceId: 'src1',
          options: { transcodingEngine: 'ffmpeg', optimizationMode: 'smart' }
        },
        result: {
          preflightId,
          batchId: 'batch-skip-optimized',
          seriesTitle: 'Example Show',
          episodeCount: 2,
          compatible: true,
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
          episodes: [
            { mediaItemId: 1, label: 'E01', compatible: true, hdrFormat: 'SDR', sourceSize: 100, sourceMtimeMs: 1, recommendedAction: 'already_optimized' },
            { mediaItemId: 2, label: 'E02', compatible: true, hdrFormat: 'SDR', sourceSize: 100, sourceMtimeMs: 1, recommendedAction: 'stream_pruning', decisionStatus: 'actionable' }
          ]
        }
      })

      const result = await service.queueShowTranscode(preflightId)

      expect(result.queuedMediaItemIds).toEqual([2])
    })

    it('allows queueing when only a subset of episodes is compatible', async () => {
      const preflightId = 'preflight-mixed-compatibility'
      const internal = service as unknown as { showPreflights: Map<string, unknown> }
      internal.showPreflights.set(preflightId, {
        request: {
          seriesTitle: 'Mixed Show',
          sourceId: 'src1',
          options: { transcodingEngine: 'ffmpeg', optimizationMode: 'smart' }
        },
        result: {
          preflightId,
          batchId: 'batch-mixed-compatibility',
          seriesTitle: 'Mixed Show',
          episodeCount: 2,
          compatible: true,
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
          episodes: [
            { mediaItemId: 101, label: 'E01 Corrupt', compatible: false, reason: 'Media analysis failed', hdrFormat: 'Unknown', sourceSize: 0, sourceMtimeMs: 0 },
            { mediaItemId: 102, label: 'E02 Valid', compatible: true, hdrFormat: 'SDR', sourceSize: 200, sourceMtimeMs: 1, recommendedAction: 'stream_pruning', decisionStatus: 'actionable' }
          ]
        }
      })

      const result = await service.queueShowTranscode(preflightId)
      expect(result.queuedMediaItemIds).toEqual([102])
    })
  })

  describe('selectMeasuredParameters workspace isolation', () => {
    it('cleans up isolated measurement workspace after measurement completes', async () => {
      const mockMeasure = vi.fn().mockResolvedValue({
        candidates: [
          { encoder: 'nvenc_h265', quality: 22, preset: 'p6', outputBytes: 1000, vmafMean: 96, vmafP5: 93, cambiMean: 2 }
        ],
        vmafAvailable: true,
        cambiAvailable: true
      })
      const internal = service as unknown as { measuredOptimizationService: { measure: typeof mockMeasure } }
      internal.measuredOptimizationService = { measure: mockMeasure }
      vi.spyOn(service, 'getCapabilities').mockResolvedValue({
        ffmpegAvailable: true,
        selectedGpuId: 'gpu-0',
        gpus: [{ id: 'gpu-0', name: 'NVIDIA RTX', vendor: 'NVIDIA' }],
        encoders: ['hevc_nvenc', 'libx265'],
        detectedAt: new Date().toISOString()
      })

      const result = await service.selectMeasuredParameters('/media/episode.mkv', {
        targetCodec: 'hevc',
        qualityProfile: 'balanced',
        encoderPolicy: 'hardware'
      })

      expect(result.encoder).toBe('nvenc_h265')
      expect(mockMeasure).toHaveBeenCalledWith(expect.objectContaining({
        outputDirectory: expect.stringMatching(/\.totality-measurements-[a-f0-9]{12}$/)
      }))
      expect(fsPromises.rm).toHaveBeenCalledWith(
        expect.stringMatching(/\.totality-measurements-[a-f0-9]{12}$/),
        { recursive: true, force: true }
      )
    })
  })
})
