import { z } from 'zod'
import { IPC_CHANNELS } from '@main/constants/ipcChannels'
import { createIpcHandler, createValidatedIpcHandler } from '@main/ipc/utils/createHandler'
import { getDatabase } from '@main/database/BetterSQLiteService'
import { ArrIntegrationService } from '@main/services/ArrIntegrationService'
import { LanguageDecisionService } from '@main/services/LanguageDecisionService'
import { calculateDryRunMetrics } from '@main/services/ShowOptimizationMetricsService'
import { LanguageRemuxService } from '@main/services/LanguageRemuxService'
import { getMediaFileAnalyzer } from '@main/services/MediaFileAnalyzer'
import { spawn } from 'node:child_process'
import { app } from 'electron'
import { promises as fs, createReadStream } from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { MediaPathAuthorization } from '@main/services/MediaPathAuthorization'
import { buildOptimizationDecision } from '@main/services/OptimizationDecisionService'
import { getLoggingService } from '@main/services/LoggingService'
import { getTMDBService } from '@main/services/TMDBService'

const config = z.object({ baseUrl: z.string().url(), apiKey: z.string().min(1), timeoutMs: z.number().int().positive().optional() })
const pendingRecord = z.object({ requestedAt: z.string(), seriesId: z.number().int().positive(), commandId: z.number().int().nullable(), state: z.literal('awaiting-rescan') })

export function registerOptimizationHandlers() {
  const db = getDatabase()
  createValidatedIpcHandler(IPC_CHANNELS.OPTIMIZATION.LOCAL_REMUX, z.tuple([z.number().int().positive(), z.boolean()]), async (mediaItemId, optIn) => {
    if (!optIn) throw new Error('Opt-in is required before local remux')
    const item = await db.media.getItemById(mediaItemId)
    if (!item?.file_path || !item.source_id) throw new Error('Media item has no local source path')
    const filePath = item.file_path
    const source = await db.sources.getSourceById(item.source_id)
    if (!source) throw new Error('Media source was not found')
    MediaPathAuthorization.assertMediaAuthorized(item, source)
    const stat = await fs.stat(item.file_path)
    const sourceSha256 = await new Promise<string>((resolve, reject) => {
      const hash = crypto.createHash('sha256')
      const stream = createReadStream(filePath)
      stream.on('data', chunk => hash.update(chunk)); stream.on('error', reject); stream.on('end', () => resolve(hash.digest('hex')))
    })
    const analyzer = getMediaFileAnalyzer()
    if (!(await analyzer.isAvailable()) || !analyzer.getFFmpegPath() || !analyzer.getFFprobePath()) throw new Error('Verified FFmpeg and FFprobe are required for local remux')
    const analysis = await analyzer.analyzeFile(item.file_path)
    if (!analysis.success || !analysis.audioTracks.length) throw new Error('Fresh media analysis is required before local remux')
    const decision = new LanguageDecisionService().decide(item.original_language, analysis.audioTracks.map(track => ({ index: track.index, language: track.language, title: track.title, reliableTag: !!track.language, isCommentary: track.isCommentary, isAudioDescription: track.isAudioDescription, isAccessibility: track.isAccessibility })))
    if (decision.status !== 'approved') throw new Error(decision.reason)
    if (decision.removableTrackIndexes.length === 0) throw new Error('No removable audio tracks were identified')
    const quarantineDirectory = path.join(app.getPath('userData'), 'quarantine', String(mediaItemId))
    const run = (binary: string, args: string[], output = false) => new Promise<unknown>((resolve, reject) => { const child = spawn(binary, args, { stdio: output ? ['ignore', 'pipe', 'pipe'] : 'ignore' }); let stdout = ''; let stderr = ''; child.stdout?.on('data', d => { stdout += d }); child.stderr?.on('data', d => { stderr += d }); child.on('error', reject); child.on('close', code => code === 0 ? resolve(output ? JSON.parse(stdout) : undefined) : reject(new Error(stderr || `${binary} exited with ${code}`))) })
    const remux = new LanguageRemuxService({ run: args => run(analyzer.getFFmpegPath()!, args).then(() => undefined), probe: filePath => run(analyzer.getFFprobePath()!, ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', filePath], true).then(value => { const p = value as { streams?: unknown[]; format?: { duration?: string; size?: string } }; return { streams: (p.streams || []) as never[], duration: Number(p.format?.duration), size: Number(p.format?.size) } }) })
    const jobId = await db.mediaRemuxJobs.create({ mediaItemId, status: 'planned', sourcePath: item.file_path, sourceSize: stat.size, sourceMtimeMs: Math.trunc(stat.mtimeMs), sourceSha256, decisionSnapshot: JSON.stringify(decision), streamSignatures: JSON.stringify(analysis.audioTracks), quarantinePath: path.join(quarantineDirectory, path.basename(item.file_path)), error: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() })
    await db.mediaRemuxJobs.update(jobId, { status: 'running' })
    try {
      const result = await remux.remux(item.file_path, { quarantineDirectory, retainedAudioIndexes: decision.retainedTrackIndexes, sourceAudioStreams: analysis.audioTracks.map(track => ({ index: track.index, codec_type: 'audio', codec_name: track.codec, profile: track.profile, channel_layout: track.channelLayout, hasObjectAudio: track.hasObjectAudio, tags: { language: track.language, title: track.title }, disposition: { default: track.isDefault ? 1 : 0 } })), sourceFingerprint: { size: stat.size, mtimeMs: Math.trunc(stat.mtimeMs), sha256: sourceSha256 }, fingerprint: async filePath => { const current = await fs.stat(filePath); const hash = crypto.createHash('sha256'); const stream = createReadStream(filePath); await new Promise<void>((resolve, reject) => { stream.on('data', chunk => hash.update(chunk)); stream.on('error', reject); stream.on('end', resolve) }); return { size: current.size, mtimeMs: Math.trunc(current.mtimeMs), sha256: hash.digest('hex') } } })
      await db.media.updateActivatedPathAndStats(mediaItemId, result.activePath, result.verifiedProbe.size || 0, result.verifiedProbe.duration || 0)
      await db.mediaRemuxJobs.update(jobId, { status: 'promoted' })
      return { jobId, result, decision }
    } catch (error) {
      await db.mediaRemuxJobs.update(jobId, { status: 'failed', error: error instanceof Error ? error.message : String(error) })
      throw error
    }
  })
  createValidatedIpcHandler(IPC_CHANNELS.OPTIMIZATION.DRY_RUN, z.tuple([z.string(), z.string().optional()]), async (title, sourceId) => {
    const episodes = await db.tvShows.getEpisodes(title, sourceId)
    const analyzer = getMediaFileAnalyzer()
    const analyzerAvailable = await analyzer.isAvailable()

    const episodeMetrics = await Promise.all(
      episodes.map(async (episode) => {
        let audioStreams: import('@main/services/ShowOptimizationMetricsService').TrackStreamInfo[] | undefined = undefined
        let durationSeconds = episode.duration ? (episode.duration > 10000 ? episode.duration / 1000 : episode.duration) : undefined

        if (episode.audio_tracks) {
          try {
            const parsedTracks = JSON.parse(episode.audio_tracks)
            if (Array.isArray(parsedTracks) && parsedTracks.length > 0) {
              audioStreams = parsedTracks.map((value: unknown, idx: number) => {
                const track = typeof value === 'object' && value !== null ? value as Record<string, unknown> : {}
                const codec = typeof track.codec === 'string' ? track.codec : typeof track.codec_name === 'string' ? track.codec_name : 'unknown'
                const bitrate = typeof track.bitrate === 'number' ? track.bitrate * 1000 : undefined
                const channelLayout = typeof track.channelLayout === 'string' ? track.channelLayout : undefined
                return {
                  index: typeof track.index === 'number' ? track.index : idx,
                  codec,
                  codec_name: codec,
                  language: typeof track.language === 'string' ? track.language : typeof track.lang === 'string' ? track.lang : null,
                  title: typeof track.title === 'string' ? track.title : null,
                  channels: typeof track.channels === 'number' ? track.channels : (channelLayout ? parseInt(channelLayout, 10) || 2 : 2),
                  bit_rate: bitrate,
                  bitrate,
                  isCommentary: Boolean(track.isCommentary),
                  isAudioDescription: Boolean(track.isAudioDescription),
                  isAccessibility: Boolean(track.isAccessibility),
                  reliableTag: typeof track.language === 'string' || typeof track.lang === 'string',
                }
              })
            }
          } catch {
            // fallback to probe
          }
        }

        if (!audioStreams && episode.file_path && analyzerAvailable) {
          try {
            const analysis = await analyzer.analyzeFile(episode.file_path)
            if (analysis.success && analysis.audioTracks.length > 0) {
              audioStreams = analysis.audioTracks.map((t) => ({
                index: t.index,
                codec: t.codec,
                codec_name: t.codec,
                language: t.language,
                title: t.title,
                channels: t.channels,
                bit_rate: t.bitrate ? t.bitrate * 1000 : undefined,
                bitrate: t.bitrate ? t.bitrate * 1000 : undefined,
                isCommentary: t.isCommentary,
                isAudioDescription: t.isAudioDescription,
                isAccessibility: t.isAccessibility,
                reliableTag: Boolean(t.language),
              }))
              if (analysis.duration) {
                durationSeconds = analysis.duration > 10000 ? analysis.duration / 1000 : analysis.duration
              }
            }
          } catch {
            // Keep fallback database values
          }
        }

        return {
          sizeBytes: episode.file_size ?? undefined,
          recoverableBytes: episode.storage_debt_bytes ?? undefined,
          efficiency: episode.efficiency_score ?? undefined,
          audioStreams,
          durationSeconds,
        }
      })
    )

    let originalLanguage = episodes.find(e => e.original_language)?.original_language ?? undefined
    if (!originalLanguage && title) {
      try {
        const comp = await db.tvShows.getCompletenessByTitle(title, episodes[0]?.source_id || '', episodes[0]?.library_id || '')
        if (comp?.tmdb_id) {
          const tmdbService = getTMDBService()
          const showDetails = await tmdbService.getTVShowDetails(comp.tmdb_id)
          if (showDetails?.original_language) {
            originalLanguage = showDetails.original_language
          }
        }
      } catch {
        // Fallback gracefully
      }
    }
    const dryRunResult = calculateDryRunMetrics(episodeMetrics, originalLanguage)
    const audioAction = dryRunResult.trackDecisions.some(track => track.decision === 'review-required')
      ? 'review-required'
      : dryRunResult.recoverableBytes > 0 ? 'stream-pruning' : 'no-action'
    const videoAction = dryRunResult.videoDebtBytes && dryRunResult.videoDebtBytes > 0
      ? 'transcode-video'
      : 'no-action'

    return {
      title,
      totalBytes: dryRunResult.totalBytes,
      recoverableBytes: dryRunResult.recoverableBytes,
      videoDebtBytes: dryRunResult.videoDebtBytes,
      totalCombinedSavingsBytes: dryRunResult.totalCombinedSavingsBytes,
      audioAction,
      videoAction,
      percentageSavings: dryRunResult.percentageSavings,
      totalEpisodes: dryRunResult.totalEpisodes,
      scoredEpisodes: dryRunResult.scoredEpisodes,
      unscoredEpisodes: dryRunResult.unscoredEpisodes,
      weightedEfficiency: dryRunResult.weightedEfficiency,
      trackDecisions: dryRunResult.trackDecisions,
      metrics: {
        totalSize: dryRunResult.totalBytes,
        totalRecoverableBytes: dryRunResult.recoverableBytes,
        videoDebtBytes: dryRunResult.videoDebtBytes,
        totalCombinedSavingsBytes: dryRunResult.totalCombinedSavingsBytes,
        audioAction,
        videoAction,
        weightedEfficiency: dryRunResult.weightedEfficiency,
        scoredEpisodeCount: dryRunResult.scoredEpisodes,
        unscoredEpisodeCount: dryRunResult.unscoredEpisodes,
      },
      action: dryRunResult.recoverableBytes > 0
        ? 'review-required'
        : (dryRunResult.videoDebtBytes && dryRunResult.videoDebtBytes > 0 ? 'transcode-video' : 'no-optimization'),
      optInRequired: true,
    }
  })
  createValidatedIpcHandler(IPC_CHANNELS.OPTIMIZATION.REQUEST_ARR_SEARCH, z.tuple([z.number().int().positive(), z.boolean()]), async (seriesId, optIn) => {
    if (!optIn) throw new Error('Opt-in is required before requesting an Arr search')
    const baseUrl = await db.config.getSetting('arr_base_url'), apiKey = await db.config.getSetting('arr_api_key')
    if (!baseUrl || !apiKey) throw new Error('Arr integration is not configured in main-process settings')
    const arrConfig = config.parse({ baseUrl, apiKey })
    const key = `optimization.pending.arr.series.${seriesId}`
    const pending = await db.config.getSetting(key)
    if (pending) return { state: 'awaiting-rescan', pending: pendingRecord.parse(JSON.parse(pending)) }
    const command = await new ArrIntegrationService(arrConfig).searchSeries(seriesId)
    const record = { requestedAt: new Date().toISOString(), seriesId, commandId: command.id ?? null, state: 'awaiting-rescan' }
    await db.config.setSetting(key, JSON.stringify(record))
    return record
  })
  createIpcHandler(IPC_CHANNELS.OPTIMIZATION.GET_PENDING, async () => {
    const settings = await db.config.getAllSettings()
    return Object.entries(settings)
      .filter(([key]) => key.startsWith('optimization.pending.'))
      .flatMap(([key, value]) => {
        try {
          return [{ key, value: pendingRecord.parse(JSON.parse(String(value))) }]
        } catch (error) {
          getLoggingService().warn('[optimization]', `Failed to parse pending optimization record for key ${key}:`, error)
          return []
        }
      })
  })
  createValidatedIpcHandler(IPC_CHANNELS.OPTIMIZATION.GET_REMUX_JOB, z.number().int().positive(), async mediaItemId => db.mediaRemuxJobs.getLatest(mediaItemId))
  createValidatedIpcHandler(IPC_CHANNELS.OPTIMIZATION.GET_DECISION, z.number().int().positive(), async mediaItemId => {
    const item = await db.media.getItemById(mediaItemId)
    if (!item?.file_path || !item.source_id) throw new Error('Media item has no local source path')
    const source = await db.sources.getSourceById(item.source_id)
    if (!source) throw new Error('Media source was not found')
    MediaPathAuthorization.assertMediaAuthorized(item, source)
    const analysis = await getMediaFileAnalyzer().analyzeFile(item.file_path)
    if (!analysis.success) throw new Error(analysis.error || 'Fresh media analysis failed')
    return buildOptimizationDecision({
      originalLanguage: item.original_language,
      durationSeconds: analysis.duration == null ? undefined : (analysis.duration > 10000 ? analysis.duration / 1000 : analysis.duration),
      fileSize: analysis.fileSize || 0,
      videoStorageDebtBytes: item.storage_debt_bytes,
      audioTranscodeSavingsBytes: null,
      audioTracks: analysis.audioTracks.map(track => ({ index: track.index, language: track.language, title: track.title, codec: track.codec, channels: track.channels, channelLayout: track.channelLayout, bitrate: track.bitrate, isDefault: track.isDefault, hasObjectAudio: track.hasObjectAudio, reliableTag: !!track.language, isCommentary: track.isCommentary, isAudioDescription: track.isAudioDescription, isAccessibility: track.isAccessibility })),
    })
  })
}
