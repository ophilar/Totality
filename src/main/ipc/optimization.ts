import { z } from 'zod'
import { IPC_CHANNELS } from '@shared/ipcChannels'
import { createIpcHandler, createValidatedIpcHandler } from '@main/ipc/utils/createHandler'
import { getDatabase } from '@main/database/getDatabase'
import type { AnalyzedAudioStream } from '@main/services/MediaFileAnalyzer'
import { MediaPathAuthorization } from '@main/services/MediaPathAuthorization'
import {
  buildOptimizationDecision,
  buildUnavailableOptimizationDecision,
  type OptimizationDecisionAudioTrack,
} from '@main/services/OptimizationDecisionService'
import { getLoggingService } from '@main/services/LoggingService'
import { getQualityAnalyzer } from '@main/services/QualityAnalyzer'
import { normalizeAudioCodec } from '@main/services/MediaNormalizer'
import { PathUtils } from '@main/services/utils/PathUtils'
import type { FileAnalysisResult } from '@main/services/MediaFileAnalyzer'

const pendingRecord = z.object({
  requestedAt: z.string(),
  seriesId: z.number().int().positive(),
  commandId: z.number().int().nullable().optional(),
  state: z.string()
})

async function getMediaItemAndSource(db: ReturnType<typeof getDatabase>, mediaItemId: number) {
  const item = await db.media.getItemById(mediaItemId)
  if (!item || !item.file_path || !item.source_id) throw new Error('Media item has no local source path')
  const source = await db.sources.getSourceById(item.source_id)
  if (!source) throw new Error('Media source was not found')
  return { item: item as typeof item & { id: number; file_path: string }, source }
}

function mapAnalysisAudioTracksToDecisionTracks(audioTracks: AnalyzedAudioStream[]): OptimizationDecisionAudioTrack[] {
  return audioTracks.map(track => ({
    index: track.index,
    language: track.language,
    title: track.title,
    codec: normalizeAudioCodec(track.codec, track.profile),
    profile: track.profile,
    channels: track.channels,
    channelLayout: track.channelLayout,
    bitrateKbps: track.bitrateKbps,
    isDefault: track.isDefault,
    hasObjectAudio: track.hasObjectAudio,
    reliableTag: Boolean(track.language),
    isCommentary: track.isCommentary,
    isAudioDescription: track.isAudioDescription,
    isAccessibility: track.isAccessibility,
  }))
}

function readCurrentAnalysis(item: Awaited<ReturnType<ReturnType<typeof getDatabase>['media']['getItemById']>> & { file_path: string }): {
  analysis?: FileAnalysisResult
  rejectionReason: string
} {
  if (!item.deep_analysis) return { rejectionReason: 'no persisted analysis' }
  let storedAnalysis: FileAnalysisResult & { fileAnalysisFingerprint?: { size: number; mtimeMs: number } }
  try {
    storedAnalysis = JSON.parse(item.deep_analysis) as typeof storedAnalysis
  } catch (error) {
    getLoggingService().warn('[Optimization]', `Ignoring malformed persisted analysis for mediaItem=${item.id}: ${error instanceof Error ? error.message : String(error)}`)
    return { rejectionReason: 'malformed persisted analysis' }
  }
  if (!storedAnalysis.success) return { rejectionReason: 'persisted analysis was unsuccessful' }
  if (!storedAnalysis.fileAnalysisFingerprint) return { rejectionReason: 'persisted analysis has no source fingerprint' }
  if (storedAnalysis.fileAnalysisFingerprint.size !== item.file_size_bytes) return { rejectionReason: 'source size changed since analysis' }
  if (storedAnalysis.fileAnalysisFingerprint.mtimeMs !== item.file_mtime) return { rejectionReason: 'source modification time changed since analysis' }
  if (!PathUtils.arePathsEqual(storedAnalysis.filePath, item.file_path)) return { rejectionReason: 'source path changed since analysis' }
  return { analysis: storedAnalysis, rejectionReason: 'current persisted analysis' }
}

export function registerOptimizationHandlers() {
  const db = getDatabase()

  createIpcHandler(IPC_CHANNELS.optimizationGetPending, async () => {
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

  createValidatedIpcHandler(IPC_CHANNELS.optimizationGetRemuxJob, z.number().int().positive(), async mediaItemId => db.mediaRemuxJobs.getLatest(mediaItemId))

  createValidatedIpcHandler(IPC_CHANNELS.optimizationGetDecision, z.number().int().positive(), async mediaItemId => {
    const { item, source } = await getMediaItemAndSource(db, mediaItemId)

    try {
      MediaPathAuthorization.assertMediaAuthorized(item, source)
    } catch (e) {
      return buildUnavailableOptimizationDecision(e instanceof Error ? e.message : 'Not authorized', item.original_language)
    }

    const qualityAnalyzer = getQualityAnalyzer()
    const { analysis, rejectionReason } = readCurrentAnalysis(item)
    getLoggingService().debug('[Optimization]', `Recommendation evidence ${analysis ? 'reused' : 'metadata-only'}: mediaItem=${item.id}, analysisEvidence=${rejectionReason}`)
    const savings = qualityAnalyzer.getOptimizationSavingsBreakdown(item, analysis)
    const audioTracks = analysis?.audioTracks ?? (item.audio_tracks ? JSON.parse(item.audio_tracks) as AnalyzedAudioStream[] : [])
    return buildOptimizationDecision({
      originalLanguage: item.original_language,
      durationMs: analysis?.durationMs ?? item.duration_ms ?? undefined,
      videoSavingsBytes: savings.videoSavingsBytes,
      videoTargetCodec: savings.videoTargetCodec,
      videoAvailable: Boolean(analysis?.video ?? item.video_codec),
      audioTranscodeSavingsBytes: null,
      audioTracks: mapAnalysisAudioTracksToDecisionTracks(audioTracks),
    })
  })
}
