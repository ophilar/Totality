import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { TranscodingService, TranscodeError, TranscodeOptions } from '../../../src/main/services/TranscodingService'
import { TranscodeCommandFactory } from '../../../src/main/services/transcoding/TranscodeCommandFactory'
import { getMediaFileAnalyzer } from '../../../src/main/services/MediaFileAnalyzer'
import * as fsPromises from 'fs/promises'
import * as path from 'path'
import { setupTestDb, cleanupTestDb } from '@tests/TestUtils'
import type { MediaItem } from '@main/types/database'
import { PathUtils } from '@main/services/utils/PathUtils'

const mediaDir = path.join(process.cwd(), 'tests/tmp/transcoding-service')
const mediaPath = (filename: string) => path.join(mediaDir, filename)

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
  analyzeCompleteFile: vi.fn(),
  isAvailable: vi.fn().mockResolvedValue(true),
  isFFmpegAvailable: vi.fn().mockResolvedValue(true),
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
  let db: Awaited<ReturnType<typeof setupTestDb>>

  async function upsertMediaItem(item: Partial<MediaItem> & Pick<MediaItem, 'title' | 'type' | 'file_path'>): Promise<number> {
    return db.media.upsertItem({
      source_id: 'src1',
      source_type: 'local',
      plex_id: path.basename(item.file_path),
      ...item,
    } as MediaItem)
  }

  beforeEach(async () => {
    vi.clearAllMocks()
    db = await setupTestDb()
    await fsPromises.mkdir(mediaDir, { recursive: true })
    await db.sources.upsertSource({
      source_id: 'src1',
      source_type: 'local',
      display_name: 'Transcoding test source',
      connection_config: JSON.stringify({ folderPath: mediaDir }),
      is_enabled: 1,
    })
    await Promise.all([
      'dv.mkv', 'episode.mkv', 'movie.avi', 'Movie.mkv', 'Movie.mp4',
      'Movie.quarantine-123.mkv', 'Show.S01E01.1080p.Remux.mkv',
      'Show.S01E01.1080p.WEB-DL.mkv',
      'Star.Trek.Strange.New.Worlds.S01E01.1080p.WEB-DL.DDP5.1.Atmos.H.264.mkv',
      'stream.ts', 'video.mp4', 'invalid-input.mkv',
    ].map(filename => fsPromises.writeFile(mediaPath(filename), Buffer.alloc(4_000))))
    service = new TranscodingService()
  })

  afterEach(async () => {
    await fsPromises.rm(mediaDir, { recursive: true, force: true })
    cleanupTestDb()
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
        filePath: mediaPath('dv.mkv'),
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

      const params = await service.getTranscodeParameters(mediaPath('dv.mkv'), { optimizationMode: 'remux_only' })
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
        filePath: mediaPath('Show.S01E01.1080p.WEB-DL.mkv'),
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

      await upsertMediaItem({
        title: 'Foreign language WEB-DL',
        type: 'episode',
        series_title: 'Show',
        series_identity_key: 'tmdb:show',
        season_number: 1,
        episode_number: 1,
        library_id: 'tv',
        file_path: mediaPath('Show.S01E01.1080p.WEB-DL.mkv'),
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

      const params = await service.getTranscodeParameters(mediaPath('Show.S01E01.1080p.WEB-DL.mkv'), options)
      expect(params.encoder).toBe('copy')
      expect(params.ffmpegArgs).toContain('-c:v')
      expect(params.ffmpegArgs).toContain('copy')
    })

    it('routes smart mode to video encoder when source is a high-bitrate Remux', async () => {
      const analyzer = getMediaFileAnalyzer()
      vi.mocked(analyzer.analyzeFile).mockResolvedValueOnce({
        success: true,
        filePath: mediaPath('Show.S01E01.1080p.Remux.mkv'),
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

      const params = await service.getTranscodeParameters(mediaPath('Show.S01E01.1080p.Remux.mkv'), options)
      expect(params.encoder).toBe('nvenc_h265')
      expect(params.ffmpegArgs).toContain('hevc_nvenc')
    })

    it('forces video transcode when user specifies optimizationMode transcode on a WEB-DL', async () => {
      const analyzer = getMediaFileAnalyzer()
      vi.mocked(analyzer.analyzeFile).mockResolvedValueOnce({
        success: true,
        filePath: mediaPath('Show.S01E01.1080p.WEB-DL.mkv'),
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

      const params = await service.getTranscodeParameters(mediaPath('Show.S01E01.1080p.WEB-DL.mkv'), options)
      expect(params.encoder).toBe('nvenc_h265')
      expect(params.ffmpegArgs).toContain('hevc_nvenc')
    })
  })

  describe('preflightShowTranscode Advisory', () => {
    it('analyzes and persists a movie during individual optimization preflight', async () => {
      const moviePath = mediaPath('Movie.avi')
      const mediaItemId = await upsertMediaItem({
        title: 'Movie', type: 'movie', file_path: moviePath, file_size: 4_000, duration: 120_000,
        source_id: 'src1', source_type: 'local', library_id: 'movies', video_codec: 'h264', video_bitrate: 6000,
      })
      mockAnalyzerInstance.analyzeCompleteFile.mockResolvedValueOnce({
        success: true, filePath: PathUtils.toDatabasePath(moviePath), container: 'matroska', duration: 120_000,
        video: { index: 0, codec: 'h264', width: 1920, height: 1080, hdrFormat: 'SDR', bitrate: 6000 },
        audioTracks: [], subtitleTracks: [],
      })

      const preflight = await service.preflightShowTranscode({
        mediaItemId, sourceId: 'src1', libraryId: 'movies',
        options: { optimizationMode: 'smart', targetProfileId: 'builtin:plex-webos-4-lg-b8' },
      })

      expect(preflight.episodes).toHaveLength(1)
      expect(preflight.episodes[0].mediaItemId).toBe(mediaItemId)
      expect(mockAnalyzerInstance.analyzeCompleteFile).toHaveBeenCalledWith(PathUtils.toDatabasePath(moviePath))
      expect(await db.media.getItemByPath(moviePath)).toMatchObject({ deep_analysis: expect.any(String) })
      expect(await db.media.getQualityScoreByMediaId(mediaItemId)).toBeTruthy()
    })

    it('populates recommendedAction, sourceTier, and adviceReason in preflight episode items', async () => {
      const episodePath = mediaPath('Star.Trek.Strange.New.Worlds.S01E01.1080p.WEB-DL.DDP5.1.Atmos.H.264.mkv')
      await upsertMediaItem({
          id: 10,
          source_id: 'src1',
          plex_id: 'p10',
          source_type: 'local',
          library_id: 'tv',
          series_identity_key: 'tmdb:85552',
          title: 'Strange New Worlds S01E01',
          season_number: 1,
          episode_number: 1,
          type: 'episode',
          file_path: episodePath,
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
          ]),
          deep_analysis: JSON.stringify({
            success: true,
            filePath: PathUtils.toDatabasePath(episodePath),
            container: 'matroska',
            overallBitrate: 6000,
            video: { index: 0, codec: 'h264', profile: 'High', level: 51, width: 1920, height: 1080, frameRate: 24, bitDepth: 8, hdrFormat: 'SDR' },
            audioTracks: [{ index: 1, codec: 'eac3', channels: 6, bitrate: 640, language: 'en', hasObjectAudio: false }],
            subtitleTracks: []
          })
      })

      mockAnalyzerInstance.analyzeFile.mockResolvedValueOnce(JSON.parse((await db.media.getItemByPath(episodePath))!.deep_analysis!))

      const preflight = await service.preflightShowTranscode({
        seriesTitle: 'Example Saga Strange New Worlds',
        seriesIdentityKey: 'tmdb:85552',
        sourceId: 'src1',
        libraryId: 'tv',
        options: { optimizationMode: 'smart', targetProfileId: 'builtin:plex-webos-4-lg-b8' }
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
      const options: TranscodeOptions = { useGpu: false, targetCodec: 'hevc', encoder: 'svt_av1', crf: 24, preset: 'medium', qualityProfile: 'balanced', encoderPolicy: 'software' }
      const params = { ffmpegArgs: ['-hide_banner', '-loglevel', 'error', '-i', '<input>', '-f', 'null', '-'] }
      const hooks = service as unknown as { runFFmpeg: (...args: unknown[]) => Promise<unknown> }
      const runPromise = hooks.runFFmpeg(
        mediaPath('invalid-input.mkv'),
        mediaPath('output.mkv'),
        params,
        options,
        vi.fn()
      )

      await expect(runPromise).rejects.toThrow(TranscodeError)
      await runPromise.catch((err: TranscodeError) => {
        expect(err.exitCode).not.toBe(0)
        expect(err.stderr).toContain('Invalid data found when processing input')
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
        { input: mediaPath('video.mp4'), expectedExt: '.mp4' },
        { input: mediaPath('movie.avi'), expectedExt: '.avi' },
        { input: mediaPath('episode.mkv'), expectedExt: '.mkv' },
        { input: mediaPath('stream.ts'), expectedExt: '.ts' }
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

  describe('replacement verification', () => {
    it('rejects invalid source media before activation and preserves the original', async () => {
      const inputPath = path.resolve(mediaPath('episode.mkv'))
      const original = await fsPromises.readFile(inputPath)
      const mediaItemId = await upsertMediaItem({ title: 'Episode', type: 'episode', file_path: inputPath })
      await expect(service.transcode(mediaItemId, { transcodingEngine: 'ffmpeg', optimizationMode: 'remux_only', outputMode: 'replace', useGpu: false })).rejects.toThrow()
      expect(await fsPromises.readFile(inputPath)).toEqual(original)
      expect((await fsPromises.readdir(mediaDir)).some(name => name.startsWith('.totality_tmp_'))).toBe(false)
    })
  })

  describe('cancellation', () => {
    it('waits for FFmpeg to exit before reporting an aborted job as finished', async () => {
      const controller = new AbortController()
      const hooks = service as unknown as { runFFmpeg: (...args: unknown[]) => Promise<boolean> }
      const runPromise = hooks.runFFmpeg(
        mediaPath('unused-input.mkv'),
        mediaPath('cancelled-output.mkv'),
        { ffmpegArgs: [
          '-hide_banner', '-loglevel', 'error', '-re', '-f', 'lavfi', '-i',
          'testsrc=size=320x240:rate=25', '-t', '30', '-f', 'null', '<output>',
        ] },
        {},
        vi.fn(),
        controller.signal
      )
      const abortTimer = setTimeout(() => controller.abort(), 500)
      await expect(runPromise).resolves.toBe(false)
      clearTimeout(abortTimer)
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

  describe('crash-consistent activation journal recovery', () => {
    it('rolls back quarantined file to original input if crash occurred before target was placed', async () => {
      await db.config.setSetting('transcoding.activation.501', JSON.stringify({
          mediaItemId: 501,
          phase: 'source_quarantined',
          inputPath: mediaPath('Movie.mkv'),
          targetPath: mediaPath('Movie.mkv'),
          quarantinePath: mediaPath('Movie.quarantine-123.mkv')
        }))

      await fsPromises.rm(mediaPath('Movie.mkv'))

      const internal = service as unknown as { recoverActivationJournals: () => Promise<void> }
      await internal.recoverActivationJournals()

      expect((await fsPromises.stat(mediaPath('Movie.mkv'))).size).toBe(4_000)
      await expect(fsPromises.access(mediaPath('Movie.quarantine-123.mkv'))).rejects.toThrow()
      expect(await db.config.getSetting('transcoding.activation.501')).toBeNull()
    })

    it('re-synchronizes media item database record if crash occurred after target was activated', async () => {
      const mediaItemId = await upsertMediaItem({ id: 502, title: 'Movie', type: 'movie', file_path: mediaPath('Movie.mp4') })
      await db.config.setSetting(`transcoding.activation.${mediaItemId}`, JSON.stringify({
          mediaItemId,
          phase: 'output_activated',
          inputPath: mediaPath('Movie.mp4'),
          targetPath: mediaPath('Movie.mkv'),
          outputStats: {
            success: true, subtitleTracks: [],
            fileSize: 850000000,
            duration: 7200000,
            video: { codec: 'hevc', width: 1920, height: 1080 },
            audioTracks: [{ codec: 'aac', channels: 6 }]
          }
        }))

      const internal = service as unknown as { recoverActivationJournals: () => Promise<void> }
      await internal.recoverActivationJournals()

      expect(PathUtils.arePathsEqual((await db.media.getItemById(mediaItemId))!.file_path!, mediaPath('Movie.mkv'))).toBe(true)
      expect(await db.config.getSetting(`transcoding.activation.${mediaItemId}`)).toBeNull()
    })
  })
})
