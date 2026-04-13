// @ts-nocheck
import { BaseMediaProvider, MediaMetadata, ScanResult, ScanOptions, ProviderType, AudioStreamInfo } from '../base/MediaProvider'
import { getDatabase } from '../../database/getDatabase'
import { getQualityAnalyzer } from '../../services/QualityAnalyzer'
import { getMediaFileAnalyzer } from '../../services/MediaFileAnalyzer'
import { getLoggingService } from '../../services/LoggingService'
import { getErrorMessage } from '../../services/utils/errorUtils'
import { extractVersionNames } from '../utils/VersionNaming'
import { KodiMappingUtils } from './KodiMappingUtils'
import { 
  QUERY_MOVIES_WITH_DETAILS, 
  QUERY_EPISODES_WITH_DETAILS,
  QUERY_MOVIE_COUNT,
  QUERY_EPISODE_COUNT
} from './KodiDatabaseSchema'
import { hasObjectAudio } from '../../services/MediaNormalizer'
import { estimateAudioBitrate } from '../utils/ProviderUtils'

/**
 * Base class for Kodi SQL-based providers (Local SQLite and Remote MySQL).
 */
export abstract class KodiSqlBaseProvider extends BaseMediaProvider {
  protected scanCancelled = false
  protected ffprobeAvailable: boolean | null = null
  protected useFFprobeAnalysis = true

  /**
   * Execute a SQL query and return all rows.
   */
  protected abstract queryAll<T>(sql: string, params?: any[]): Promise<T[]>

  /**
   * Execute a SQL query and return a single row.
   */
  protected abstract queryOne<T>(sql: string, params?: any[]): Promise<T | null>

  /**
   * Get audio streams from streamdetails table.
   */
  protected async getAudioStreamsMap(): Promise<Map<number, any[]>> {
    const query = `
      SELECT idFile, strAudioCodec as codec, iAudioChannels as channels, strAudioLanguage as language
      FROM streamdetails WHERE iStreamType = 1
    `
    const streams = await this.queryAll<any>(query)
    const map = new Map<number, any[]>()
    for (const s of streams) {
      if (!map.has(s.idFile)) map.set(s.idFile, [])
      map.get(s.idFile)!.push(s)
    }
    return map
  }

  protected async fetchItems(libraryId: string): Promise<MediaMetadata[]> {
    const audioMap = await this.getAudioStreamsMap()
    
    if (libraryId === 'movies') {
      const rows = await this.queryAll<any>(QUERY_MOVIES_WITH_DETAILS)
      return rows.map(r => {
        const meta = KodiMappingUtils.mapMovieToMetadata(r, this.sourceId)
        this.enrichAudio(meta, audioMap.get(r.idFile))
        return meta
      })
    } else if (libraryId === 'tvshows') {
      const rows = await this.queryAll<any>(QUERY_EPISODES_WITH_DETAILS)
      return rows.map(r => {
        const meta = KodiMappingUtils.mapEpisodeToMetadata(r, this.sourceId)
        this.enrichAudio(meta, audioMap.get(r.idFile))
        return meta
      })
    }
    return []
  }

  private enrichAudio(meta: MediaMetadata, streams?: any[]): void {
    if (!streams || streams.length === 0) return
    
    const audioTracks: AudioStreamInfo[] = streams.map((s, i) => ({
      codec: s.codec || 'Unknown',
      channels: s.channels || 2,
      language: s.language || undefined,
      isDefault: i === 0,
      bitrate: estimateAudioBitrate(s.codec, s.channels),
      hasObjectAudio: hasObjectAudio(s.codec, null, meta.title, null)
    }))

    meta.audioTracks = audioTracks
    const best = audioTracks.find(t => t.hasObjectAudio) || audioTracks[0]
    meta.audioCodec = best.codec
    meta.audioChannels = best.channels
    meta.audioBitrate = best.bitrate
    meta.hasObjectAudio = audioTracks.some(t => t.hasObjectAudio)
  }

  async scanLibrary(libraryId: string, options?: ScanOptions): Promise<ScanResult> {
    const { onProgress } = options || {}
    this.scanCancelled = false

    const startTime = Date.now()
    const result: ScanResult = {
      success: false,
      itemsScanned: 0,
      itemsAdded: 0,
      itemsUpdated: 0,
      itemsRemoved: 0,
      errors: [],
      durationMs: 0,
    }

    try {
      const db = getDatabase()
      const analyzer = getQualityAnalyzer()
      await analyzer.loadThresholdsFromDatabase()

      const scannedProviderIds = new Set<string>()
      const items = await this.fetchItems(libraryId)
      const totalItems = items.length

      getLoggingService().info(`[${this.constructor.name}]`, `Scanning ${totalItems} items...`)

      const fileAnalyzer = getMediaFileAnalyzer()
      if (this.ffprobeAvailable === null) this.ffprobeAvailable = await fileAnalyzer.isAvailable()

      db.startBatch()

      try {
        const groups: MediaMetadata[][] = []
        if (libraryId === 'movies') {
          const groupMap = new Map<string, MediaMetadata[]>()
          for (const item of items) {
            const groupKey = item.tmdbId ? `tmdb:${item.tmdbId}`
              : item.imdbId ? `imdb:${item.imdbId}`
              : `title:${this.normalizeGroupTitle(item.title || '')}|${item.year || ''}`
            if (!groupMap.has(groupKey)) groupMap.set(groupKey, [])
            groupMap.get(groupKey)!.push(item)
          }
          groups.push(...groupMap.values())
        } else {
          for (const item of items) groups.push([item])
        }

        let itemIndex = 0
        for (const group of groups) {
          if (this.scanCancelled) break

          try {
            for (let i = 0; i < group.length; i++) {
              if (this.useFFprobeAnalysis && this.ffprobeAvailable && this.needsFFprobeEnhancement(group[i])) {
                group[i] = await this.enhanceWithFFprobe(group[i])
              }
            }

            const versions = group.map(m => this.convertMetadataToVersion(m))
            if (versions.length > 1) extractVersionNames(versions)

            const bestIdx = versions.reduce((bi, v, i) => 
              this.calculateVersionScore(v) > this.calculateVersionScore(versions[bi]) ? i : bi, 0)
            
            const bestMetadata = group[bestIdx]
            const mediaItem = this.convertMetadataToMediaItem(bestMetadata)
            
            if (mediaItem) {
              mediaItem.source_id = this.sourceId
              mediaItem.source_type = this.providerType
              mediaItem.library_id = libraryId
              mediaItem.version_count = versions.length
              mediaItem.plex_id = group[0].itemId

              const id = await db.media.upsertItem(mediaItem)
              scannedProviderIds.add(mediaItem.plex_id)

              const scoredVersions = versions.map(v => {
                const vScore = analyzer.analyzeVersion(v as any)
                return { ...v, media_item_id: id, ...vScore }
              })
              db.media.syncItemVersions(id, scoredVersions)

              mediaItem.id = id
              const qualityScore = await analyzer.analyzeMediaItem(mediaItem)
              await db.media.upsertQualityScore(qualityScore)

              result.itemsScanned++
            }
          } catch (error: unknown) {
            result.errors.push(`Failed to process ${group[0]?.title}: ${getErrorMessage(error)}`)
          }

          itemIndex += group.length
          if (onProgress) {
            onProgress({ current: itemIndex, total: totalItems, phase: 'processing', currentItem: group[0]?.title, percentage: (itemIndex / totalItems) * 100 })
          }
        }
      } finally {
        await db.endBatch()
      }

      if (scannedProviderIds.size > 0) {
        const itemType = libraryId === 'movies' ? 'movie' : 'episode'
        const existingItems = db.media.getItems({ type: itemType, sourceId: this.sourceId, libraryId })
        for (const item of existingItems) {
          if (!scannedProviderIds.has(item.plex_id)) {
            if (item.id) {
              db.media.deleteItem(item.id)
              result.itemsRemoved++
            }
          }
        }
      }

      await db.sources.updateSourceScanTime(this.sourceId)
      result.success = true
      result.durationMs = Date.now() - startTime
      return result
    } catch (error: unknown) {
      result.errors.push(getErrorMessage(error))
      result.durationMs = Date.now() - startTime
      return result
    }
  }

  protected normalizeGroupTitle(title: string): string {
    return title.toLowerCase().replace(/[^a-z0-9]/g, '')
  }

  protected calculateVersionScore(v: any): number {
    const resMap: any = { '4K': 4000, '1080p': 1080, '720p': 720, 'SD': 480 }
    return (resMap[v.resolution] || 0) + (v.video_bitrate / 1000)
  }

  protected convertMetadataToMediaItem(metadata: MediaMetadata): any {
    return {
      plex_id: metadata.itemId,
      title: metadata.title,
      year: metadata.year,
      type: metadata.type,
      series_title: metadata.seriesTitle,
      season_number: metadata.seasonNumber,
      episode_number: metadata.episodeNumber,
      file_path: metadata.filePath || '',
      file_size: metadata.fileSize || 0,
      duration: metadata.duration || 0,
      resolution: metadata.resolution || 'SD',
      width: metadata.width || 0,
      height: metadata.height || 0,
      video_codec: metadata.videoCodec || '',
      video_bitrate: metadata.videoBitrate || 0,
      audio_codec: metadata.audioCodec || '',
      audio_channels: metadata.audioChannels || 2,
      audio_bitrate: metadata.audioBitrate || 0,
      has_object_audio: metadata.hasObjectAudio,
      hdr_format: metadata.hdrFormat || 'None',
      imdb_id: metadata.imdbId,
      tmdb_id: metadata.tmdbId?.toString(),
      poster_url: metadata.posterUrl,
      episode_thumb_url: metadata.episodeThumbUrl,
      season_poster_url: metadata.seasonPosterUrl,
      summary: (metadata.rawData as any)?.plot || undefined,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }
  }

  protected convertMetadataToVersion(m: MediaMetadata): any {
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

  protected needsFFprobeEnhancement(m: MediaMetadata): boolean {
    return !m.videoFrameRate || !m.colorBitDepth
  }

  protected async enhanceWithFFprobe(m: MediaMetadata): Promise<MediaMetadata> {
    return m
  }
}
