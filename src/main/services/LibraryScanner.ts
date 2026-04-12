
import { getDatabase } from '../database/getDatabase'
import { getQualityAnalyzer } from './QualityAnalyzer'
import { getLoggingService } from './LoggingService'
import { getErrorMessage } from './utils/errorUtils'
import { extractVersionNames } from '../providers/utils/VersionNaming'
import { MediaMetadata, ScanResult, ProgressCallback } from '../providers/base/MediaProvider'
import type { MediaItem } from '../types/database'

/**
 * LibraryScanner - Generic utility for syncing provider metadata to the local database.
 * 
 * Centralizes logic for:
 * - Version deduplication (grouping files by TMDB/IMDB ID)
 * - Version synchronization
 * - Quality scoring
 * - Orphan cleanup (removing items no longer in the source)
 */
export class LibraryScanner {
  /**
   * Sync a list of metadata items to the local database.
   */
  static async sync(
    sourceId: string,
    sourceType: string,
    libraryId: string,
    items: MediaMetadata[],
    onProgress?: ProgressCallback
  ): Promise<ScanResult> {
    const startTime = Date.now()
    const db = getDatabase()
    const analyzer = getQualityAnalyzer()
    await analyzer.loadThresholdsFromDatabase()

    const result: ScanResult = {
      success: false,
      itemsScanned: 0,
      itemsAdded: 0,
      itemsUpdated: 0,
      itemsRemoved: 0,
      errors: [],
      durationMs: 0,
    }

    const scannedProviderIds = new Set<string>()
    const totalItems = items.length

    // Group items by TMDB/IMDB ID to handle multi-version files
    const groups = this.groupItems(items, libraryId)

    db.startBatch()
    try {
      let processed = 0
      for (const group of groups) {
        try {
          const versions = group.map(m => this.metadataToVersion(m))
          if (versions.length > 1) extractVersionNames(versions)

          // Select best version for the main record
          const bestIdx = this.selectBestVersionIndex(group)
          const bestMeta = group[bestIdx]
          
          const mediaItem = this.metadataToMediaItem(bestMeta, sourceId, sourceType, libraryId)
          mediaItem.version_count = versions.length

          const id = await db.mediaRepo.upsertMediaItem(mediaItem)
          scannedProviderIds.add(mediaItem.plex_id)

          // Sync versions
          const scoredVersions = versions.map(v => {
            const vScore = analyzer.analyzeVersion(v as any)
            return { ...v, media_item_id: id, ...vScore }
          })
          db.mediaRepo.syncMediaItemVersions(id, scoredVersions)

          // Final quality score
          mediaItem.id = id
          const qualityScore = await analyzer.analyzeMediaItem(mediaItem)
          db.mediaRepo.upsertQualityScore(qualityScore)

          result.itemsScanned++
        } catch (err) {
          result.errors.push(`Failed to process ${group[0]?.title}: ${getErrorMessage(err)}`)
        }

        processed += group.length
        onProgress?.({
          current: processed,
          total: totalItems,
          phase: 'processing',
          currentItem: group[0]?.title,
          percentage: (processed / totalItems) * 100
        })
      }
    } finally {
      await db.endBatch()
    }

    // Cleanup removed items
    if (scannedProviderIds.size > 0) {
      const itemType = libraryId === 'movies' ? 'movie' : 'episode'
      const existingItems = db.mediaRepo.getMediaItems({ type: itemType, sourceId, libraryId })
      for (const item of existingItems) {
        if (!scannedProviderIds.has(item.plex_id)) {
          db.mediaRepo.deleteMediaItem(item.id)
          result.itemsRemoved++
        }
      }
    }

    result.success = true
    result.durationMs = Date.now() - startTime
    return result
  }

  private static groupItems(items: MediaMetadata[], libraryId: string): MediaMetadata[][] {
    if (libraryId !== 'movies') return items.map(i => [i])

    const groupMap = new Map<string, MediaMetadata[]>()
    for (const item of items) {
      const key = item.tmdbId ? `tmdb:${item.tmdbId}`
        : item.imdbId ? `imdb:${item.imdbId}`
        : `title:${item.title?.toLowerCase().replace(/[^a-z0-9]/g, '')}|${item.year}`
      
      if (!groupMap.has(key)) groupMap.set(key, [])
      groupMap.get(key)!.push(item)
    }
    return Array.from(groupMap.values())
  }

  private static selectBestVersionIndex(group: MediaMetadata[]): number {
    const resWeight: any = { '4K': 4000, '1080p': 1080, '720p': 720, 'SD': 480 }
    return group.reduce((best, cur, idx) => {
      const curScore = (resWeight[cur.resolution || 'SD'] || 0) + (cur.videoBitrate || 0) / 1000
      const bestScore = (resWeight[group[best].resolution || 'SD'] || 0) + (group[best].videoBitrate || 0) / 1000
      return curScore > bestScore ? idx : best
    }, 0)
  }

  private static metadataToMediaItem(m: MediaMetadata, sId: string, sType: string, lId: string): any {
    return {
      plex_id: m.itemId,
      source_id: sId,
      source_type: sType,
      library_id: lId,
      title: m.title,
      year: m.year,
      type: m.type,
      series_title: m.seriesTitle,
      season_number: m.seasonNumber,
      episode_number: m.episodeNumber,
      file_path: m.filePath || '',
      file_size: m.fileSize || 0,
      duration: m.duration || 0,
      resolution: m.resolution || 'SD',
      width: m.width || 0,
      height: m.height || 0,
      video_codec: m.videoCodec || '',
      video_bitrate: m.videoBitrate || 0,
      audio_codec: m.audioCodec || '',
      audio_channels: m.audioChannels || 2,
      audio_bitrate: m.audioBitrate || 0,
      has_object_audio: m.hasObjectAudio,
      hdr_format: m.hdrFormat || 'None',
      imdb_id: m.imdbId,
      tmdb_id: m.tmdbId?.toString(),
      poster_url: m.posterUrl,
      episode_thumb_url: m.episodeThumbUrl,
      season_poster_url: m.seasonPosterUrl,
      summary: (m.rawData as any)?.summary || (m.rawData as any)?.plot || undefined,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }
  }

  private static metadataToVersion(m: MediaMetadata): any {
    return {
      version_source: m.itemId,
      file_path: m.filePath || '',
      file_size: m.fileSize || 0,
      duration: m.duration || 0,
      resolution: m.resolution || 'SD',
      width: m.width || 0,
      height: m.height || 0,
      video_codec: m.videoCodec || '',
      video_bitrate: m.videoBitrate || 0,
      audio_codec: m.audioCodec || '',
      audio_channels: m.audioChannels || 2,
      audio_bitrate: m.audioBitrate || 0,
      has_object_audio: m.hasObjectAudio,
      hdr_format: m.hdrFormat === 'None' ? undefined : m.hdrFormat,
    }
  }
}
