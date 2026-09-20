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
import { TaskType } from '@main/types/database'
import { getMovieCollectionService } from '@main/services/MovieCollectionService'
import { getMusicBrainzService } from '@main/services/MusicBrainzService'
import { getSeriesCompletenessService } from '@main/services/SeriesCompletenessService'
import { getStatsCacheService } from '@main/services/StatsCacheService'
import { getQualityAnalyzer } from '@main/services/QualityAnalyzer'

export function registerMediaHandlers(): void {
  const analyzer = getMediaFileAnalyzer()

  createValidatedIpcHandler(IPC_CHANNELS.MEDIA.ANALYZE, z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('item'), mediaId: z.number().int().positive() }),
    z.object({ kind: z.literal('all-libraries') }),
    z.object({ kind: z.literal('library'), libraryId: z.string().min(1) }),
    z.object({ kind: z.literal('collection'), collectionId: z.string().min(1) }),
    z.object({ kind: z.literal('show'), showId: z.string().min(1) }),
    z.object({ kind: z.literal('album'), albumId: z.string().min(1) }),
  ]), async (scope) => {
    if (scope.kind !== 'item') {
      if (scope.kind === 'collection') {
        const collection = (await getMovieCollectionService().getCollections()).find(item => String(item.id) === scope.collectionId || item.tmdb_collection_id === scope.collectionId)
        if (!collection) throw new Error(`Collection ${scope.collectionId} was not found`)
        const result = await getMovieCollectionService().analyzeCollection(collection.collection_name, collection.source_id, collection.library_id, collection.tmdb_collection_id)
        getStatsCacheService().invalidate()
        return { scope, completedStages: ['collection-completeness'], findings: [], actions: [], errors: [], result }
      }
      if (scope.kind === 'album') {
        const albumId = Number(scope.albumId)
        if (!Number.isInteger(albumId) || albumId <= 0) throw new Error(`Album scope must use a numeric album id: ${scope.albumId}`)
        const album = await getDatabase().music.getAlbumById(albumId)
        if (!album) throw new Error(`Album ${scope.albumId} was not found`)
        const tracks = await getDatabase().music.getTracks({ albumId, limit: 1000 })
        const result = await getMusicBrainzService().analyzeAlbumTrackCompleteness(albumId, album.artist_name, album.title, album.musicbrainz_release_group_id || album.musicbrainz_id || undefined, tracks.map(track => track.title))
        if (result) await getDatabase().music.upsertAlbumCompleteness(result)
        getStatsCacheService().invalidate()
        return { scope, completedStages: ['music-completeness'], findings: [], actions: [], errors: [], result }
      }
      if (scope.kind === 'show') {
        const showId = Number(scope.showId)
        if (!Number.isInteger(showId) || showId <= 0) throw new Error(`Show scope must use a numeric show id: ${scope.showId}`)
        const show = (await getDatabase().tvShows.getSummaries()).find(item => item.id === showId)
        if (!show || !show.source_id || !show.library_id || !show.series_identity_key) throw new Error(`Show ${scope.showId} has no complete persisted identity`)
        const episodes = await getDatabase().tvShows.getEpisodes(show.series_title, show.source_id, show.series_identity_key, show.library_id)
        const result = await getSeriesCompletenessService().analyzeSeries(show.series_title, show.source_id, show.library_id, undefined, episodes, { returnConstructed: true })
        getStatsCacheService().invalidate()
        return { scope, completedStages: ['tv-completeness'], findings: [], actions: [], errors: [], result }
      }
      const rows = await getDatabase().media.getItems(scope.kind === 'library' ? { libraryId: scope.libraryId } : undefined)
      const pairs = Array.from(new Map(rows
        .filter(row => row.source_id)
        .map(row => [`${row.source_id}:${row.library_id ?? ''}`, { sourceId: row.source_id!, libraryId: row.library_id ?? undefined }])
      ).values())
      if (pairs.length === 0) throw new Error('No analyzable media exists in the requested scope')
      const definitions = pairs.flatMap(({ sourceId, libraryId }) => [
        { type: TaskType.QualityAnalysis, label: `Analyze quality (${sourceId})`, sourceId, libraryId },
        { type: TaskType.SeriesCompleteness, label: `Analyze TV completeness (${sourceId})`, sourceId, libraryId },
        { type: TaskType.CollectionCompleteness, label: `Analyze collections (${sourceId})`, sourceId, libraryId },
        { type: TaskType.MusicCompleteness, label: `Analyze music (${sourceId})`, sourceId, libraryId },
      ])
      const queuedTaskIds = await getTaskQueueService().addTasks(definitions)
      return { scope, completedStages: [], findings: [], actions: [], errors: [], queuedTaskIds }
    }
    const { mediaId } = scope
    const item = await getDatabase().media.getItemById(mediaId)
    if (!item) throw new Error(`Media item ${mediaId} was not found`)
    if (!item.file_path) throw new Error(`Media item ${mediaId} has no local file path`)
    const analysis = await analyzer.deepAnalyzeFile(item.file_path, { scanBitrate: true, detectVolume: true })
    if (!analysis.success) throw new Error(analysis.error || `Analysis failed for media item ${mediaId}`)
    await getDatabase().media.updateDeepAnalysisByPath(item.file_path, {
      deepAnalysis: analysis.deepAnalysis,
      audioTracks: analysis.audioTracks,
    }, new Date().toISOString())
    const quality = await getQualityAnalyzer().analyzeMediaItem(item)
    await getDatabase().media.upsertQualityScore(quality)
    return {
      scope: { kind: 'item', mediaId },
      completedStages: ['media', 'quality'],
      findings: [],
      actions: [
        { id: 'optimize', label: 'Optimize' },
        ...(item.match_status === 'unresolved' ? [{ id: 'fix-match', label: 'Fix match' }] : []),
      ],
      errors: [],
      analysis,
    }
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
    const result = await analyzer.deepAnalyzeFile(options.filePath, {
      scanBitrate: options.scanBitrate ?? true,
      detectVolume: options.detectVolume ?? true,
      requestId: options.requestId
    })
    await getDatabase().media.updateDeepAnalysisByPath(options.filePath, {
      deepAnalysis: result.deepAnalysis,
      audioTracks: result.audioTracks,
    }, new Date().toISOString())
    return result
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
