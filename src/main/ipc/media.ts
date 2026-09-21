import { IPC_CHANNELS } from '@main/constants/ipcChannels'
/**
 * Media IPC Handlers
 * 
 * General media-related operations like searching across all libraries
 * and performing deep file analysis.
 */

import { getMediaFileAnalyzer } from '@main/services/MediaFileAnalyzer'
import { createValidatedIpcHandler } from '@main/ipc/utils/createHandler'
import { z } from 'zod'
import { getLoggingService } from '@main/services/LoggingService'
import { getDatabase } from '@main/database/BetterSQLiteService'
import { getSourceManager } from '@main/services/SourceManager'
import { getTaskQueueService } from '@main/services/TaskQueueService'
import { LibraryType } from '@main/types/database'
import { getMovieCollectionService } from '@main/services/MovieCollectionService'
import { getMusicBrainzService } from '@main/services/MusicBrainzService'
import { getSeriesCompletenessService } from '@main/services/SeriesCompletenessService'
import { getStatsCacheService } from '@main/services/StatsCacheService'
import { getQualityAnalyzer } from '@main/services/QualityAnalyzer'
import { planAnalysisTasks } from '@main/services/AnalysisTaskPlanner'
import type { FileAnalysisResult } from '@main/services/MediaFileAnalyzer'
import type { AnalysisScope } from '@shared/analysisScope'

export function registerMediaHandlers(): void {
  const analyzer = getMediaFileAnalyzer()

  const analysisScopeSchema = z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('item'), mediaId: z.number().int().positive() }),
    z.object({ kind: z.literal('all-libraries') }),
    z.object({ kind: z.literal('library'), sourceId: z.string().min(1), libraryId: z.string().min(1) }),
    z.object({ kind: z.literal('collection'), collectionId: z.number().int().positive() }),
    z.object({ kind: z.literal('show'), sourceId: z.string().min(1), libraryId: z.string().min(1), seriesIdentityKey: z.string().min(1), title: z.string().min(1) }),
    z.object({ kind: z.literal('album'), albumId: z.number().int().positive() }),
  ])

  createValidatedIpcHandler(IPC_CHANNELS.MEDIA.ANALYZE, analysisScopeSchema, async (scope: AnalysisScope) => {
    if (scope.kind !== 'item') {
      if (scope.kind === 'collection') {
        const collection = (await getMovieCollectionService().getCollections()).find(item => item.id === scope.collectionId)
        if (!collection) throw new Error(`Collection ${scope.collectionId} was not found`)
        const result = await getMovieCollectionService().analyzeCollection(collection.collection_name, collection.source_id, collection.library_id, collection.tmdb_collection_id)
        getStatsCacheService().invalidate()
        return { scope, completedStages: ['collection-completeness'], findings: [], actions: [], errors: [], result }
      }
      if (scope.kind === 'album') {
        const album = await getDatabase().music.getAlbumById(scope.albumId)
        if (!album) throw new Error(`Album ${scope.albumId} was not found`)
        const tracks = await getDatabase().music.getTracks({ albumId: scope.albumId, limit: 1000 })
        const result = await getMusicBrainzService().analyzeAlbumTrackCompleteness(scope.albumId, album.artist_name, album.title, album.musicbrainz_release_group_id || album.musicbrainz_id || undefined, tracks.map(track => track.title))
        if (result) await getDatabase().music.upsertAlbumCompleteness(result)
        getStatsCacheService().invalidate()
        return { scope, completedStages: ['music-completeness'], findings: [], actions: [], errors: [], result }
      }
      if (scope.kind === 'show') {
        const episodes = await getDatabase().tvShows.getEpisodes(scope.title, scope.sourceId, scope.seriesIdentityKey, scope.libraryId)
        const result = await getSeriesCompletenessService().analyzeSeries(scope.title, scope.sourceId, scope.libraryId, undefined, episodes, { returnConstructed: true })
        getStatsCacheService().invalidate()
        return { scope, completedStages: ['tv-completeness'], findings: [], actions: [], errors: [], result }
      }
      const enabledSources = scope.kind === 'library'
        ? [await getDatabase().sources.getSourceById(scope.sourceId)].filter((source): source is NonNullable<typeof source> => source !== null)
        : await getDatabase().sources.getEnabledSources()
      const librariesBySource = await Promise.all(enabledSources.map(async source => ({
        sourceId: source.source_id,
        libraries: (await getDatabase().sources.getSourceLibraries(source.source_id))
          .filter(library => library.isEnabled === 1),
      })))
      const libraries = librariesBySource.flatMap(({ sourceId, libraries: sourceLibraries }) =>
        sourceLibraries.map(library => ({ sourceId, libraryId: library.libraryId, libraryType: library.libraryType as LibraryType }))
      )
      const scopedLibraries = scope.kind === 'library'
        ? libraries.filter(library => library.sourceId === scope.sourceId && library.libraryId === scope.libraryId)
        : libraries
      if (scopedLibraries.length === 0) throw new Error('No enabled library exists in the requested scope')

      const definitions = planAnalysisTasks(scopedLibraries)
      if (definitions.length === 0) throw new Error('No applicable analysis stages exist in the requested scope')
      const queuedTaskIds = await getTaskQueueService().addTasks(definitions)
      return { scope, completedStages: [], findings: [], actions: [], errors: [], queuedTaskIds }
    }
    const { mediaId } = scope
    const item = await getDatabase().media.getItemById(mediaId)
    if (!item) throw new Error(`Media item ${mediaId} was not found`)
    if (!item.file_path) throw new Error(`Media item ${mediaId} has no local file path`)
    const persistedAnalysis = await analyzer.analyzeCompleteFile(item.file_path)
    const fileAnalysis = persistedAnalysis
    await getDatabase().media.updateDeepAnalysisByPath(item.file_path, persistedAnalysis, new Date().toISOString())
    const quality = await getQualityAnalyzer().analyzeMediaItem({
      ...item,
      video_codec: fileAnalysis.video?.codec ?? item.video_codec,
      video_bitrate: fileAnalysis.video?.bitrate ?? item.video_bitrate,
      width: fileAnalysis.video?.width ?? item.width,
      height: fileAnalysis.video?.height ?? item.height,
      duration: fileAnalysis.duration ?? item.duration,
      audio_codec: fileAnalysis.audioTracks[0]?.codec ?? item.audio_codec,
      audio_channels: fileAnalysis.audioTracks[0]?.channels ?? item.audio_channels,
      audio_bitrate: fileAnalysis.audioTracks[0]?.bitrate ?? item.audio_bitrate,
      audio_tracks: JSON.stringify(persistedAnalysis.audioTracks),
      subtitle_tracks: JSON.stringify(persistedAnalysis.subtitleTracks),
    })
    await getDatabase().media.upsertQualityScore(quality)
    const optimizationAdvice = getQualityAnalyzer().getOptimizationAdvice({
      ...item,
      video_codec: fileAnalysis.video?.codec ?? item.video_codec,
      video_bitrate: fileAnalysis.video?.bitrate ?? item.video_bitrate,
      width: fileAnalysis.video?.width ?? item.width,
      height: fileAnalysis.video?.height ?? item.height,
      duration: fileAnalysis.duration ?? item.duration,
      audio_codec: fileAnalysis.audioTracks[0]?.codec ?? item.audio_codec,
      audio_channels: fileAnalysis.audioTracks[0]?.channels ?? item.audio_channels,
      audio_bitrate: fileAnalysis.audioTracks[0]?.bitrate ?? item.audio_bitrate,
      audio_tracks: JSON.stringify(persistedAnalysis.audioTracks),
      subtitle_tracks: JSON.stringify(persistedAnalysis.subtitleTracks),
    }, persistedAnalysis)
    return {
      scope: { kind: 'item', mediaId },
      completedStages: ['media', 'quality'],
      findings: [],
      actions: [
        ...(optimizationAdvice.decisionStatus === 'actionable' && optimizationAdvice.action !== 'already_optimized'
          ? [{ id: 'optimize', label: 'Optimize' }]
          : []),
        ...(item.match_status === 'unresolved' ? [{ id: 'fix-match', label: 'Fix match' }] : []),
      ],
      errors: [],
      analysis: persistedAnalysis,
    }
  })

  createValidatedIpcHandler(IPC_CHANNELS.MEDIA.GET_OPTIMIZATION_ADVICE, z.number().int().positive(), async (mediaId) => {
    const item = await getDatabase().media.getItemById(mediaId)
    if (!item) throw new Error(`Media item ${mediaId} was not found`)
    if (!item.deep_analysis) {
      return getQualityAnalyzer().getOptimizationAdvice(item)
    }
    const persisted = JSON.parse(item.deep_analysis) as FileAnalysisResult
    if (!persisted.success || persisted.filePath !== item.file_path) {
      throw new Error(`Persisted file analysis for media item ${mediaId} is invalid`)
    }
    return getQualityAnalyzer().getOptimizationAdvice(item, persisted)
  })

  /**
   * Deep Media Analysis
   * Performs frame-accurate bitrate and volume detection
   */
  createValidatedIpcHandler(IPC_CHANNELS.MEDIA.DEEP_ANALYZE, z.object({
    filePath: z.string(),
    requestId: z.string().min(1).optional(),
    scanBitrate: z.boolean().optional(),
    detectVolume: z.boolean().optional()
  }), async (options) => {
    getLoggingService().info('[media]', `Starting deep analysis for: ${options.filePath}`)
    const item = (await getDatabase().media.getItems()).find(candidate => candidate.file_path === options.filePath)
    if (!item) throw new Error(`No media item is associated with ${options.filePath}`)
    const persistedAnalysis = await analyzer.analyzeCompleteFile(options.filePath, options)
    const fileAnalysis = persistedAnalysis
    await getDatabase().media.updateDeepAnalysisByPath(options.filePath, persistedAnalysis, new Date().toISOString())
    const quality = await getQualityAnalyzer().analyzeMediaItem({ ...item, video_codec: fileAnalysis.video?.codec ?? item.video_codec, video_bitrate: fileAnalysis.video?.bitrate ?? item.video_bitrate, width: fileAnalysis.video?.width ?? item.width, height: fileAnalysis.video?.height ?? item.height, duration: fileAnalysis.duration ?? item.duration, audio_codec: fileAnalysis.audioTracks[0]?.codec ?? item.audio_codec, audio_channels: fileAnalysis.audioTracks[0]?.channels ?? item.audio_channels, audio_bitrate: fileAnalysis.audioTracks[0]?.bitrate ?? item.audio_bitrate, audio_tracks: JSON.stringify(persistedAnalysis.audioTracks), subtitle_tracks: JSON.stringify(persistedAnalysis.subtitleTracks) })
    await getDatabase().media.upsertQualityScore(quality)
    return persistedAnalysis
  })

  createValidatedIpcHandler('media:cancelDeepAnalyze', z.string().min(1), async (requestId) => {
    analyzer.cancelDeepAnalysis(requestId)
    return { success: true }
  })

  createValidatedIpcHandler('media:compareProvider', z.number().int().positive(), async (mediaItemId) => {
    const item = await getDatabase().media.getItemById(mediaItemId)
    if (!item) throw new Error('Media item not found')
    if (!item.source_id) throw new Error('Media item has no source')
    const provider = getSourceManager().getProvider(item.source_id)
    if (!provider) throw new Error(`Provider unavailable for source ${item.source_id}`)
    const providerItem = await provider.getItemMetadata(item.plex_id)
    const fields = ['title', 'year', 'duration', 'resolution', 'width', 'height', 'videoCodec', 'videoBitrate', 'audioCodec', 'audioChannels', 'audioBitrate'] as const
    const localValues: Record<string, unknown> = {
      title: item.title, year: item.year, duration: item.duration, resolution: item.resolution,
      width: item.width, height: item.height, videoCodec: item.video_codec, videoBitrate: item.video_bitrate,
      audioCodec: item.audio_codec, audioChannels: item.audio_channels, audioBitrate: item.audio_bitrate,
    }
    const differences = fields.filter(field => providerItem[field] !== undefined && providerItem[field] !== localValues[field])
      .map(field => ({ field, local: localValues[field], provider: providerItem[field] }))
    return { providerType: provider.providerType, differences }
  })

  createValidatedIpcHandler('media:getFileAudioLanguages', z.number().int().positive(), async (mediaItemId) => {
    const { getDatabase } = await import('@main/database/BetterSQLiteService')
    const db = getDatabase()
    const item = await db.media.getItemById(mediaItemId)
    if (!item) return []
    const languages = new Set<string>()
    if (item.audio_tracks) {
      try {
        const tracks = JSON.parse(item.audio_tracks) as Array<{ language?: string; lang?: string }>
        if (Array.isArray(tracks)) {
          for (const track of tracks) {
            const lang = (track.language || track.lang || '').trim().toLowerCase()
            if (lang) languages.add(lang)
          }
        }
      } catch { /* ignore parse error */ }
    }
    if (item.audio_language) {
      const lang = item.audio_language.trim().toLowerCase()
      if (lang) languages.add(lang)
    }
    return Array.from(languages)
  })

  getLoggingService().info('[media]', 'Media IPC handlers registered')
}
