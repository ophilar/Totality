import axios from 'axios'
import type { 
  MediaProvider, 
  LibraryScanOptions, 
  LibraryScanResult, 
  MediaSourceResponse,
  MediaLibraryResponse,
  PlexServer,
  PlexLibrary,
  PlexMetadata,
  PlexMedia,
  PlexPart,
  PlexCollection
} from '../../types/providers'
import type { MediaItem, MediaItemVersion, QualityScore } from '../../types/database'
import { getDatabase } from '../../database/getDatabase'
import { getLoggingService } from '../../services/LoggingService'
import { getErrorMessage } from '../../services/utils/errorUtils'

/**
 * PlexProvider
 *
 * Implements the MediaProvider interface for Plex Media Server.
 * Handles authentication, discovery, and library scanning.
 */
export class PlexProvider implements MediaProvider {
  private authToken: string | null = null
  private selectedServer: PlexServer | null = null
  private sourceId: string | null = null
  private scanCancelled = false

  constructor(authToken?: string, server?: PlexServer, sourceId?: string) {
    this.authToken = authToken || null
    this.selectedServer = server || null
    this.sourceId = sourceId || null
  }

  async testConnection(): Promise<boolean> {
    if (!this.authToken || !this.selectedServer) return false
    try {
      const url = `${this.selectedServer.address}/library/sections?X-Plex-Token=${this.authToken}`
      await axios.get(url, { timeout: 5000 })
      return true
    } catch (error) {
      getLoggingService().error('[PlexProvider]', 'Connection test failed:', error)
      return false
    }
  }

  async getLibraries(): Promise<MediaLibraryResponse[]> {
    if (!this.authToken || !this.selectedServer) return []
    try {
      const url = `${this.selectedServer.address}/library/sections?X-Plex-Token=${this.authToken}`
      const response = await axios.get(url, { headers: { 'Accept': 'application/json' } })
      
      const sections = response.data.MediaContainer?.Directory || []
      return sections
        .filter((s: any) => s.type === 'movie' || s.type === 'show' || s.type === 'artist')
        .map((s: any) => ({
          id: s.key,
          name: s.title,
          type: s.type === 'show' ? 'show' : (s.type === 'artist' ? 'music' : 'movie')
        }))
    } catch (error) {
      getLoggingService().error('[PlexProvider]', 'Failed to get libraries:', error)
      return []
    }
  }

  async scanLibrary(libraryId: string, options?: LibraryScanOptions): Promise<LibraryScanResult> {
    if (!this.authToken || !this.selectedServer) {
      throw new Error('Plex provider not authenticated or server not selected')
    }

    this.scanCancelled = false
    const result: LibraryScanResult = {
      itemsScanned: 0,
      itemsAdded: 0,
      itemsUpdated: 0,
      itemsRemoved: 0,
      errors: []
    }

    try {
      const db = getDatabase()
      const url = `${this.selectedServer.address}/library/sections/${libraryId}/all?X-Plex-Token=${this.authToken}`
      const response = await axios.get(url, { headers: { 'Accept': 'application/json' } })
      
      const itemsToProcess = response.data.MediaContainer?.Metadata || []
      const totalItems = itemsToProcess.length
      let scanned = 0
      
      getLoggingService().info('[PlexProvider]', `Processing ${totalItems} items for source ${this.sourceId}...`)

      // --- Reconciliation Phase ---
      if (options?.fullScan) {
        getLoggingService().info(`[PlexProvider ${this.sourceId}] Got ${totalItems} item IDs for reconciliation`)
        const existingPlexIds = itemsToProcess.map((item: any) => item.ratingKey)
        const type = itemsToProcess[0]?.type === 'show' ? 'episode' : 'movie'
        
        // Use repository-safe method for removal
        const removed = db.media.removeStaleMediaItems(new Set(existingPlexIds), type as 'movie' | 'episode')
        result.itemsRemoved = removed
        getLoggingService().info(`[PlexProvider ${this.sourceId}] Reconciling ${type}s: ${totalItems} in Plex, removed ${removed} stale items from DB`)
      }

      // --- Processing Phase ---
      const BATCH_SIZE = 10
      const COMMIT_INTERVAL = 25 // Commit every 25 items to prevent long-held locks

      try {
        for (let i = 0; i < totalItems; i += BATCH_SIZE) {
          // Check for cancellation
          if (this.scanCancelled) {
            getLoggingService().info('[PlexProvider]', `Scan cancelled at ${scanned}/${totalItems} for source ${this.sourceId}`)
            result.cancelled = true
            break
          }

          // Start a new transaction for this commit interval
          if (scanned % COMMIT_INTERVAL === 0) {
            db.startBatch()
          }

          const batch = itemsToProcess.slice(i, i + BATCH_SIZE)
          const metadataResults = await Promise.all(
            batch.map(item => this.fetchMetadata(item.ratingKey))
          )

          for (let j = 0; j < batch.length; j++) {
            const item = batch[j]
            const metaResult = metadataResults[j]
            
            scanned++

            try {
              const mediaItem = this.mapToMediaItem(item, metaResult)
              const id = await db.media.upsertItem(mediaItem)
              
              if (metaResult && metaResult.Media) {
                const scoredVersions = this.mapAndScoreVersions(metaResult.Media, id)
                db.media.syncItemVersions(id, scoredVersions)
                
                const qualityScore = this.calculateQualityScore(scoredVersions, id)
                await db.media.upsertQualityScore(qualityScore)
                
                if (mediaItem.type === 'movie' && metaResult.Collection) {
                  for (const coll of metaResult.Collection) {
                    if (coll.tag) db.movieCollections.addMediaToCollection(id, coll.tag)
                  }
                }
              }
              result.itemsScanned++

              // Progress reporting
              if (options?.onProgress && scanned % 5 === 0) {
                options.onProgress({ 
                  current: scanned, 
                  total: totalItems, 
                  phase: 'processing',
                  percentage: Math.round((scanned / totalItems) * 100)
                })
              }
            } catch (error: unknown) {
              result.errors.push(`Failed to process ${item.title}: ${getErrorMessage(error)}`)
            }
          }

          // Commit if we've reached the interval or the end of the list
          if (scanned % COMMIT_INTERVAL === 0 || scanned === totalItems || this.scanCancelled) {
            db.endBatch()
            // Yield for a tiny bit to allow other DB operations (like UI updates) to sneak in
            await new Promise(resolve => setTimeout(resolve, 10))
          }
        }
      } finally {
        // Ensure any open transaction is closed on error/exit
        if (db.isInTransaction()) {
          try { db.endBatch() } catch { /* ignore */ }
        }
      }

      getLoggingService().info('[PlexProvider]', `Scan complete for source ${this.sourceId}: ${result.itemsScanned} scanned, ${result.errors.length} errors`)
      return result
    } catch (error) {
      getLoggingService().error('[PlexProvider]', 'Library scan failed:', error)
      throw error
    }
  }

  cancelScan(): void {
    this.scanCancelled = true
  }

  private async fetchMetadata(ratingKey: string): Promise<PlexMetadata | null> {
    if (!this.authToken || !this.selectedServer) return null
    try {
      const url = `${this.selectedServer.address}/library/metadata/${ratingKey}?X-Plex-Token=${this.authToken}`
      const response = await axios.get(url, { headers: { 'Accept': 'application/json' } })
      return response.data.MediaContainer?.Metadata?.[0] || null
    } catch (error) {
      getLoggingService().error('[PlexProvider]', 'Failed to get item metadata:', error)
      return null
    }
  }

  /**
   * Get all collections from a library
   */
  async getLibraryCollections(libraryKey: string): Promise<PlexCollection[]> {
    if (!this.authToken || !this.selectedServer) return []
    try {
      const url = `${this.selectedServer.address}/library/sections/${libraryKey}/collections?X-Plex-Token=${this.authToken}`
      const response = await axios.get(url, { headers: { 'Accept': 'application/json' } })
      return response.data.MediaContainer?.Metadata || []
    } catch (error) {
      getLoggingService().error('[PlexProvider]', 'Failed to get library collections:', error)
      return []
    }
  }

  private mapToMediaItem(plexItem: any, metaResult: PlexMetadata | null): MediaItem {
    const item = metaResult || plexItem
    const media = item.Media?.[0] || {}
    const part = media.Part?.[0] || {}

    return {
      source_id: this.sourceId || 'legacy',
      source_type: 'plex',
      plex_id: item.ratingKey,
      title: item.title,
      sort_title: item.titleSort || item.title,
      year: item.year,
      type: item.type === 'show' ? 'episode' : (item.type === 'episode' ? 'episode' : 'movie'),
      series_title: item.grandparentTitle,
      season_number: item.parentIndex,
      episode_number: item.index,
      file_path: part.file,
      file_size: part.size || 0,
      duration: item.duration || 0,
      resolution: media.videoResolution || 'unknown',
      width: media.width || 0,
      height: media.height || 0,
      video_codec: media.videoCodec || 'unknown',
      video_bitrate: media.bitrate || 0,
      audio_codec: media.audioCodec || 'unknown',
      audio_channels: media.audioChannels || 0,
      audio_bitrate: 0, // Plex doesn't directly expose audio bitrate in summary
      video_frame_rate: media.videoFrameRate,
      container: media.container,
      version_count: item.Media?.length || 1,
      file_mtime: part.updatedAt,
      imdb_id: this.extractGuid(item.Guid, 'imdb'),
      tmdb_id: this.extractGuid(item.Guid, 'tmdb'),
      poster_url: item.thumb ? `${this.selectedServer?.address}${item.thumb}?X-Plex-Token=${this.authToken}` : undefined,
      summary: item.summary,
      user_fixed_match: false
    }
  }

  private extractGuid(guids: any[], type: string): string | undefined {
    if (!guids || !Array.isArray(guids)) return undefined
    const guid = guids.find((g: any) => g.id?.startsWith(type))
    return guid ? guid.id.split('://')[1] : undefined
  }

  private mapAndScoreVersions(mediaItems: PlexMedia[], mediaItemId: number): MediaItemVersion[] {
    return mediaItems.map((m, idx) => {
      const part = m.Part?.[0] || {}
      return {
        media_item_id: mediaItemId,
        version_source: 'plex',
        file_path: part.file || '',
        file_size: part.size || 0,
        duration: m.duration || 0,
        resolution: m.videoResolution || 'unknown',
        width: m.width || 0,
        height: m.height || 0,
        video_codec: m.videoCodec || 'unknown',
        video_bitrate: m.bitrate || 0,
        audio_codec: m.audioCodec || 'unknown',
        audio_channels: m.audioChannels || 0,
        audio_bitrate: 0,
        is_best: idx === 0, // Default to first being best, will be updated by ranker
        hdr_format: m.videoProfile?.includes('HDR') ? 'HDR' : undefined,
        color_bit_depth: m.bitDepth,
        original_language: undefined,
        audio_language: undefined
      }
    })
  }

  private calculateQualityScore(versions: MediaItemVersion[], mediaItemId: number): Partial<QualityScore> {
    const best = versions.find(v => v.is_best) || versions[0]
    
    // Simple heuristic for now, QualityAnalyzer will do deeper dive
    let score = 50
    if (best.resolution === '4k') score = 90
    else if (best.resolution === '1080') score = 75
    else if (best.resolution === '720') score = 60

    return {
      media_item_id: mediaItemId,
      quality_tier: (best.resolution === '4k' ? 'UHD' : (best.resolution === '1080' ? 'FHD' : (best.resolution === '720' ? 'HD' : 'SD'))) as any,
      tier_quality: 'MEDIUM',
      overall_score: score,
      resolution_score: score,
      bitrate_score: 50,
      audio_score: 50,
      efficiency_score: 70,
      storage_debt_bytes: 0,
      needs_upgrade: score < 70,
      issues: '[]'
    }
  }

  // --- Identity ---
  getProviderId(): string { return 'plex' }
  
  setSourceId(id: string): void { this.sourceId = id }

  hasSelectedServer(): boolean {
    return this.selectedServer !== null
  }

  setAuthToken(token: string): void {
    this.authToken = token
  }

  setSelectedServer(server: PlexServer): void {
    this.selectedServer = server
  }
}
