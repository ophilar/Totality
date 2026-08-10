import { z } from 'zod'
import { IPC_CHANNELS } from '@main/constants/ipcChannels'
import { createIpcHandler, createValidatedIpcHandler } from '@main/ipc/utils/createHandler'
import { getDatabase } from '@main/database/BetterSQLiteService'
import { ArrIntegrationService } from '@main/services/ArrIntegrationService'
import { LanguageDecisionService } from '@main/services/LanguageDecisionService'
import { aggregateShowOptimizationMetrics } from '@main/services/ShowOptimizationMetricsService'
import { LanguageRemuxService } from '@main/services/LanguageRemuxService'
import { getMediaFileAnalyzer } from '@main/services/MediaFileAnalyzer'
import { spawn } from 'node:child_process'

const config = z.object({ baseUrl: z.string().url(), apiKey: z.string().min(1), timeoutMs: z.number().int().positive().optional() })
const tracks = z.array(z.object({ index: z.number().int().nonnegative(), language: z.string().nullable().optional(), title: z.string().nullable().optional(), isCommentary: z.boolean().optional(), isAudioDescription: z.boolean().optional(), isAccessibility: z.boolean().optional(), reliableTag: z.boolean().optional() }))

export function registerOptimizationHandlers() {
  const db = getDatabase()
  createValidatedIpcHandler(IPC_CHANNELS.OPTIMIZATION.DECIDE_LANGUAGE, z.tuple([z.string().nullable(), tracks, z.boolean().optional()]), async (language, audioTracks, agrees) => new LanguageDecisionService().decide(language, audioTracks, agrees ?? true))
  createValidatedIpcHandler(IPC_CHANNELS.OPTIMIZATION.LOCAL_REMUX, z.tuple([z.string().min(1), z.string().min(1), z.array(z.number().int().nonnegative()), z.number().int().positive().optional()]), async (filePath, quarantineDirectory, retainedAudioIndexes, mediaItemId) => {
    const analyzer = getMediaFileAnalyzer()
    if (!(await analyzer.isAvailable()) || !analyzer.getFFmpegPath() || !analyzer.getFFprobePath()) throw new Error('Verified FFmpeg and FFprobe are required for local remux')
    const run = (binary: string, args: string[], output = false) => new Promise<any>((resolve, reject) => { const child = spawn(binary, args, { stdio: output ? ['ignore', 'pipe', 'pipe'] : 'ignore' }); let stdout = ''; let stderr = ''; child.stdout?.on('data', d => { stdout += d }); child.stderr?.on('data', d => { stderr += d }); child.on('error', reject); child.on('close', code => code === 0 ? resolve(output ? JSON.parse(stdout) : undefined) : reject(new Error(stderr || `${binary} exited with ${code}`))) })
    const remux = new LanguageRemuxService({ run: args => run(analyzer.getFFmpegPath()!, args), probe: path => run(analyzer.getFFprobePath()!, ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', path], true).then((p: any) => ({ streams: p.streams || [], duration: Number(p.format?.duration), size: Number(p.format?.size) })) })
    const result = await remux.remux(filePath, { quarantineDirectory, retainedAudioIndexes })
    if (mediaItemId) await db.media.updateActivatedPathAndStats(mediaItemId, result.activePath, result.verifiedProbe.size || 0, result.verifiedProbe.duration || 0)
    return result
  })
  createValidatedIpcHandler(IPC_CHANNELS.OPTIMIZATION.DRY_RUN, z.tuple([z.string(), z.string().optional()]), async (title, sourceId) => {
    const episodes = await db.tvShows.getEpisodes(title, sourceId)
    const metrics = aggregateShowOptimizationMetrics(episodes.map((episode: any) => ({ sizeBytes: episode.file_size, recoverableBytes: episode.storage_debt_bytes, efficiency: episode.efficiency_score })))
    return { title, metrics, action: metrics.totalRecoverableBytes > 0 ? 'review-required' : 'no-optimization', optInRequired: true }
  })
  createValidatedIpcHandler(IPC_CHANNELS.OPTIMIZATION.REQUEST_ARR_SEARCH, z.tuple([config, z.number().int().positive(), z.string().min(1)]), async (arrConfig, seriesId, key) => {
    const pending = await db.config.getSetting(key)
    if (pending) return { state: 'awaiting-rescan', pending: JSON.parse(pending) }
    const command = await new ArrIntegrationService(arrConfig).searchSeries(seriesId)
    const record = { requestedAt: new Date().toISOString(), seriesId, commandId: command.id ?? null, state: 'awaiting-rescan' }
    await db.config.setSetting(key, JSON.stringify(record))
    return record
  })
  createIpcHandler(IPC_CHANNELS.OPTIMIZATION.GET_PENDING, async () => {
    const settings = await db.config.getAllSettings()
    return Object.entries(settings).filter(([key]) => key.startsWith('optimization.pending.')).map(([key, value]) => ({ key, value: JSON.parse(String(value)) }))
  })
}
