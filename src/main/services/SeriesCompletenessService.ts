
import { getDatabase } from '../database/getDatabase'
import { getTMDBService } from './TMDBService'
import { getLoggingService } from './LoggingService'
import type { TMDBSeasonDetails } from '../types/tmdb'
import {
  CancellableOperation,
  wasRecentlyAnalyzed,
  type AnalysisProgress,
  type AnalysisOptions,
} from './utils/ProgressTracker'
import type { SeriesCompleteness, MissingEpisode, MediaItem } from '../types/database'

interface EpisodeInfo {
  seasonNumber: number
  episodeNumber: number
}

interface SeriesAnalysisResult {
  totalSeasons: number
  totalEpisodes: number
  ownedSeasons: number
  ownedEpisodes: number
  missingSeasons: number[]
  missingEpisodes: MissingEpisode[]
  completenessPercentage: number
  tmdbId: string
  posterUrl: string | undefined
  backdropUrl: string | undefined
  status: string
}

/** Progress phases for series completeness analysis */
export type SeriesAnalysisPhase = 'scanning' | 'analyzing' | 'complete'

/** Re-export for backward compatibility */
export type { AnalysisProgress }

export interface SeriesAnalysisOptions extends AnalysisOptions {
  /** Deduplicate series across providers using TMDB ID (default: true when no sourceId) */
  deduplicateByTmdbId?: boolean
}

export class SeriesCompletenessService extends CancellableOperation {
  /**
   * Analyze all series in the media library
   * @param onProgress Progress callback
   * @param sourceId Optional source ID to scope analysis
   * @param libraryId Optional library ID to scope analysis
   * @param options Analysis options for performance tuning
   */
  async analyzeAllSeries(
    onProgress?: (progress: AnalysisProgress) => void,
    sourceId?: string,
    libraryId?: string,
    options: SeriesAnalysisOptions = {}
  ): Promise<{ completed: boolean; analyzed: number; skipped: number }> {
    // Apply default options
    // Deduplication is enabled by default when analyzing all sources (no sourceId)
    const {
      skipRecentlyAnalyzed = true,
      reanalyzeAfterDays = 7,
      deduplicateByTmdbId = !sourceId, // Default to true when no source filter
    } = options

    // Reset cancellation flag at start
    this.resetCancellation()

    const db = getDatabase()
    const tmdb = getTMDBService()

    // Initialize TMDB service (loads API key from settings)
    await tmdb.initialize()
    if (!tmdb.isConfigured()) {
      throw new Error('TMDB API key not configured. Please add your API key in Settings.')
    }

    // Get all unique series from media_items (optionally filtered by source/library)
    // Use deduplication when analyzing all sources
    let seriesData: Map<string, { episodes: MediaItem[]; tmdbId?: string; sourceIds: Set<string> }>

    if (deduplicateByTmdbId && !sourceId) {
      console.log('[SeriesCompletenessService] Using cross-provider deduplication by TMDB ID')
      seriesData = await this.getSeriesDeduplicatedByTmdbId(sourceId, libraryId, onProgress)
    } else {
      const seriesMap = this.getSeriesFromMediaItems(sourceId, libraryId)
      seriesData = new Map()
      for (const [title, episodes] of seriesMap) {
        const sourceIds = new Set<string>()
        for (const ep of episodes) {
          if (ep.source_id) sourceIds.add(ep.source_id)
        }
        seriesData.set(title, { episodes, tmdbId: undefined, sourceIds })
      }
    }

    const seriesNames = Array.from(seriesData.keys())

    // Pre-fetch existing completeness data for skip check
    const existingCompleteness = new Map<string, string>() // key or series_title -> updated_at
    if (skipRecentlyAnalyzed) {
      const allCompleteness = db.getAllSeriesCompleteness(sourceId, libraryId)
      for (const sc of allCompleteness) {
        if (sc.updated_at && sc.tmdb_id) { // Only skip if we have TMDB data
          if (sc.series_identity_key) {
            existingCompleteness.set(sc.series_identity_key, sc.updated_at)
          }
          existingCompleteness.set(sc.series_title, sc.updated_at)
        }
      }
      console.log(`[SeriesCompletenessService] Found ${existingCompleteness.size} series with existing completeness data`)
    }

    console.log(`[SeriesCompletenessService] Found ${seriesNames.length} series to analyze (skipRecent=${skipRecentlyAnalyzed})`)

    let analyzed = 0
    let skipped = 0

    // Process series in parallel batches for better performance
    const CONCURRENCY = 5 // Process 5 series concurrently

    // Start batch mode for efficient writes with checkpoints
    db.startBatch()

    try {
    for (let i = 0; i < seriesNames.length; i += CONCURRENCY) {
      // Check for cancellation - break instead of return to allow finally block to save
      if (this.isCancelled()) {
        console.log(`[SeriesCompletenessService] Analysis cancelled at ${i}/${seriesNames.length}`)
        break
      }

      const batch = seriesNames.slice(i, i + CONCURRENCY)

      // Filter out recently analyzed series and collect their data
      const batchToAnalyze: Array<{ title: string; cachedTmdbId?: string }> = []
      for (const title of batch) {
        if (skipRecentlyAnalyzed) {
          const updatedAt = existingCompleteness.get(title)
          if (wasRecentlyAnalyzed(updatedAt, reanalyzeAfterDays)) {
            skipped++
            continue
          }
        }
        // Get cached TMDB ID from deduplication phase to avoid duplicate lookups
        const data = seriesData.get(title)
        batchToAnalyze.push({ title, cachedTmdbId: data?.tmdbId })
      }

      if (batchToAnalyze.length === 0) {
        continue
      }

      onProgress?.({
        current: i + 1,
        total: seriesNames.length,
        currentItem: batchToAnalyze[0].title,
        phase: 'analyzing',
        skipped,
      })

      // Process batch in parallel - pass cached TMDB IDs to avoid redundant lookups
      const results = await Promise.allSettled(
        batchToAnalyze.map(({ title, cachedTmdbId }) =>
          this.analyzeSeries(title, sourceId, libraryId, cachedTmdbId)
        )
      )

      // Count successful analyses
      for (const result of results) {
        if (result.status === 'fulfilled' && result.value !== null) {
          analyzed++
        } else if (result.status === 'rejected') {
          console.error('Failed to analyze series:', result.reason)
        }
      }

      // Checkpoint every 25 series to save progress
      if (analyzed % 25 === 0 && analyzed > 0) {
        await db.forceSave()
      }
    }
    } finally {
      // Always save on exit (normal completion or cancellation)
      await db.endBatch()
    }

    const wasCompleted = !this.isCancelled()

    onProgress?.({
      current: seriesNames.length,
      total: seriesNames.length,
      currentItem: '',
      phase: 'complete',
      skipped,
    })

    getLoggingService().verbose('[SeriesCompletenessService]',
      `Analysis ${wasCompleted ? 'complete' : 'cancelled'}: ${analyzed} analyzed, ${skipped} skipped out of ${seriesNames.length} series`)
    console.log(`[SeriesCompletenessService] Analysis ${wasCompleted ? 'complete' : 'cancelled'}: ${analyzed} analyzed, ${skipped} skipped`)
    return { completed: wasCompleted, analyzed, skipped }
  }

  /**
   * Analyze a single series by canonical identity key
   * @param seriesIdentityKey The canonical series identity key (tmdb:*, tvdb:*, or unresolved:*)
   * @param sourceId Optional source ID to scope analysis
   * @param libraryId Optional library ID to scope analysis
   * @param cachedTmdbId Optional pre-fetched TMDB ID from deduplication phase (avoids redundant API calls)
   */
  async analyzeSeries(
    seriesIdentityKey: string,
    sourceId?: string,
    libraryId?: string,
    cachedTmdbId?: string
  ): Promise<SeriesCompleteness | null> {
    if (
      !seriesIdentityKey ||
      (!seriesIdentityKey.startsWith('tmdb:') &&
        !seriesIdentityKey.startsWith('tvdb:') &&
        !seriesIdentityKey.startsWith('unresolved:'))
    ) {
      throw new Error(
        `analyzeSeries requires a canonical series identity key (received: "${seriesIdentityKey}"). Title-based lookups are not permitted.`
      )
    }

    const db = getDatabase()
    const episodes = db.getEpisodes('', sourceId || '', seriesIdentityKey, libraryId || '')

    if (episodes.length === 0) {
      console.log(`No episodes found for series identity: ${seriesIdentityKey}`)
      return null
    }

    const seriesTitle = episodes[0]?.series_title || seriesIdentityKey

    // Extract episode info
    const ownedEpisodes: EpisodeInfo[] = episodes.map((ep: { season_number?: number; episode_number?: number }) => ({
      seasonNumber: ep.season_number || 0,
      episodeNumber: ep.episode_number || 0,
    }))

    // Use cached TMDB ID if available, otherwise look it up
    const tmdbId =
      cachedTmdbId ||
      (seriesIdentityKey.startsWith('tmdb:')
        ? seriesIdentityKey.slice(5)
        : await this.findTMDBShowId(seriesTitle, episodes))

    if (!tmdbId) {
      console.log(`Could not find TMDB ID for series: ${seriesTitle} (${seriesIdentityKey})`)
      // Store with null data - user can manually match later
      const result = this.createUnmatchedResult(seriesTitle, ownedEpisodes, sourceId, libraryId)
      ;(result as any).series_identity_key = seriesIdentityKey
      await db.upsertSeriesCompleteness(result)
      return db.getSeriesCompletenessByIdentity(seriesIdentityKey, sourceId, libraryId)
    }

    // Check if source is a local drive (kodi-local or local) - these need artwork from TMDB
    let updateArtwork = false
    if (sourceId) {
      const source = db.getMediaSourceById(sourceId)
      if (source && (source.source_type === 'kodi-local' || source.source_type === 'local')) {
        updateArtwork = true
        console.log(`[SeriesCompletenessService] Will update artwork for local source: ${sourceId}`)
      }
    }

    // Analyze completeness against TMDB data
    const analysis = await this.calculateMissing(tmdbId, ownedEpisodes, updateArtwork ? episodes : undefined, updateArtwork ? sourceId : undefined)

    // Store result with source/library scope
    const data: Omit<SeriesCompleteness, 'id' | 'created_at' | 'updated_at'> = {
      series_title: seriesTitle,
      source_id: sourceId,
      library_id: libraryId,
      total_seasons: analysis.totalSeasons,
      total_episodes: analysis.totalEpisodes,
      owned_seasons: analysis.ownedSeasons,
      owned_episodes: analysis.ownedEpisodes,
      missing_seasons: analysis.missingSeasons,
      missing_episodes: analysis.missingEpisodes,
      completeness_percentage: analysis.completenessPercentage,
      tmdb_id: analysis.tmdbId,
      poster_url: analysis.posterUrl,
      backdrop_url: analysis.backdropUrl,
      status: analysis.status,
      series_identity_key: seriesIdentityKey,
    } as any

    getLoggingService().verbose('[SeriesCompletenessService]',
      `"${seriesTitle}" (${seriesIdentityKey}) — ${analysis.ownedEpisodes}/${analysis.totalEpisodes} episodes, ${analysis.missingEpisodes.length} missing, ${analysis.completenessPercentage}% complete`)

    await db.upsertSeriesCompleteness(data)
    return db.getSeriesCompletenessByIdentity(seriesIdentityKey, sourceId, libraryId)
  }

  /**
   * Get all series from media_items, grouped by series_identity_key
   * @param sourceId Optional source ID to filter by
   * @param libraryId Optional library ID to filter by
   */
  private getSeriesFromMediaItems(sourceId?: string, libraryId?: string): Map<string, MediaItem[]> {
    const db = getDatabase()
    const filters: { type: 'episode'; sourceId?: string; libraryId?: string } = { type: 'episode' }
    if (sourceId) filters.sourceId = sourceId
    if (libraryId) filters.libraryId = libraryId

    const allItems = db.getMediaItems(filters) as MediaItem[]

    const seriesMap = new Map<string, MediaItem[]>()

    for (const item of allItems) {
      const key = item.series_identity_key
      if (!key || key.trim() === '') {
        throw new Error(
          `[SeriesCompletenessService] Invariant violation: episode media_item ${item.id} ('${item.title || 'unknown'}') has no persisted series_identity_key`
        )
      }

      const episodes = seriesMap.get(key) || []
      episodes.push(item)
      seriesMap.set(key, episodes)
    }

    return seriesMap
  }

  /**
   * Get all series from media_items, deduplicated by TMDB ID across providers
   * This merges episodes from different providers that belong to the same series
   * @param sourceId Optional source ID to filter by (deduplication disabled if set)
   * @param libraryId Optional library ID to filter by
   */
  private async getSeriesDeduplicatedByTmdbId(
    sourceId?: string,
    libraryId?: string,
    onProgress?: (progress: AnalysisProgress) => void
  ): Promise<Map<string, { episodes: MediaItem[]; tmdbId?: string; sourceIds: Set<string> }>> {
    // If sourceId is provided, deduplication doesn't make sense - just return regular grouping
    if (sourceId) {
      const regularMap = this.getSeriesFromMediaItems(sourceId, libraryId)
      const result = new Map<string, { episodes: MediaItem[]; tmdbId?: string; sourceIds: Set<string> }>()
      for (const [title, episodes] of regularMap) {
        result.set(title, {
          episodes,
          tmdbId: undefined, // Will be looked up later
          sourceIds: new Set([sourceId]),
        })
      }
      return result
    }

    // Get all episodes grouped by series_identity_key
    const seriesByIdentity = this.getSeriesFromMediaItems(undefined, libraryId)
    const identityKeys = Array.from(seriesByIdentity.keys())

    console.log(`[SeriesCompletenessService] Deduplicating ${identityKeys.length} series by TMDB ID...`)

    // First pass: Find TMDB IDs for all series
    const tmdbIdMap = new Map<string, string>() // identity_key -> tmdb_id
    const keysByTmdbId = new Map<string, string[]>() // tmdb_id -> identity_keys

    for (let i = 0; i < identityKeys.length; i++) {
      const identityKey = identityKeys[i]
      const episodes = seriesByIdentity.get(identityKey) || []
      const displayTitle = episodes[0]?.series_title || identityKey

      onProgress?.({
        current: i + 1,
        total: identityKeys.length,
        currentItem: `Finding TMDB ID for: ${displayTitle}`,
        phase: 'scanning',
      })

      // Check if cancellation requested
      if (this.isCancelled()) {
        break
      }

      // If already a tmdb: key, use that directly
      const tmdbId = identityKey.startsWith('tmdb:')
        ? identityKey.slice(5)
        : await this.findTMDBShowId(displayTitle, episodes)

      if (tmdbId) {
        tmdbIdMap.set(identityKey, tmdbId)

        // Group identity keys by TMDB ID
        const keys = keysByTmdbId.get(tmdbId) || []
        keys.push(identityKey)
        keysByTmdbId.set(tmdbId, keys)
      }
    }

    console.log(`[SeriesCompletenessService] Found ${tmdbIdMap.size} series with TMDB IDs, ${keysByTmdbId.size} unique TMDB IDs`)

    // Second pass: Merge episodes by TMDB ID
    const result = new Map<string, { episodes: MediaItem[]; tmdbId?: string; sourceIds: Set<string> }>()

    // Process series with TMDB IDs - merge duplicates under canonical tmdb: key
    for (const [tmdbId, keys] of keysByTmdbId) {
      const canonicalKey = `tmdb:${tmdbId}`
      const allEpisodes: MediaItem[] = []
      const sourceIds = new Set<string>()

      for (const key of keys) {
        const episodes = seriesByIdentity.get(key) || []
        allEpisodes.push(...episodes)

        // Track source IDs
        for (const ep of episodes) {
          if (ep.source_id) {
            sourceIds.add(ep.source_id)
          }
        }
      }

      // Deduplicate episodes by season/episode number (keep highest quality version)
      const deduplicatedEpisodes = this.deduplicateEpisodes(allEpisodes)

      if (keys.length > 1) {
        console.log(`[SeriesCompletenessService] Merged ${keys.length} series keys into "${canonicalKey}": ${allEpisodes.length} -> ${deduplicatedEpisodes.length} episodes`)
      }

      result.set(canonicalKey, {
        episodes: deduplicatedEpisodes,
        tmdbId,
        sourceIds,
      })
    }

    // Add series without TMDB IDs using their canonical identity keys
    for (const [identityKey, episodes] of seriesByIdentity) {
      if (!tmdbIdMap.has(identityKey)) {
        const sourceIds = new Set<string>()
        for (const ep of episodes) {
          if (ep.source_id) {
            sourceIds.add(ep.source_id)
          }
        }
        result.set(identityKey, {
          episodes,
          tmdbId: undefined,
          sourceIds,
        })
      }
    }

    return result
  }

  /**
   * Deduplicate episodes by season/episode number
   * When duplicates exist, keep the episode with the highest quality score
   */
  private deduplicateEpisodes(episodes: MediaItem[]): MediaItem[] {
    const episodeMap = new Map<string, MediaItem>() // "S01E01" -> best episode

    for (const ep of episodes) {
      const key = `S${String(ep.season_number || 0).padStart(2, '0')}E${String(ep.episode_number || 0).padStart(2, '0')}`
      const existing = episodeMap.get(key)

      if (!existing) {
        episodeMap.set(key, ep)
      } else {
        // Keep the one with higher video bitrate (proxy for quality)
        if ((ep.video_bitrate_kbps || 0) > (existing.video_bitrate_kbps || 0)) {
          episodeMap.set(key, ep)
        }
      }
    }

    return Array.from(episodeMap.values())
  }

  /**
   * Find TMDB show ID using various methods:
   * 1. Use series_tmdb_id from Plex metadata (direct from show-level GUID)
   * 2. Try IMDB ID via /find endpoint
   * 3. Fall back to title search
   */
  private async findTMDBShowId(seriesTitle: string, episodes: MediaItem[]): Promise<string | null> {
    const tmdb = getTMDBService()

    // Method 1: Check for series_tmdb_id (show-level TMDB ID from Plex metadata)
    // This is the most reliable as it comes directly from Plex's metadata agents
    for (const episode of episodes) {
      if (episode.series_tmdb_id) {
        console.log(`Found show TMDB ID from Plex metadata: "${seriesTitle}" -> TMDB ID ${episode.series_tmdb_id}`)
        return episode.series_tmdb_id
      }
    }

    // Extract IMDB ID from episodes for fallback method
    let imdbId: string | undefined

    for (const episode of episodes) {
      if (episode.imdb_id && episode.imdb_id.startsWith('tt')) {
        imdbId = episode.imdb_id
        break
      }
    }

    // Method 2: Try IMDB ID via /find endpoint
    if (imdbId) {
      try {
        console.log(`Trying IMDB ID ${imdbId} for "${seriesTitle}"`)
        const findResult = await tmdb.findByExternalId(imdbId, 'imdb_id')
        if (findResult.tv_results && findResult.tv_results.length > 0) {
          const show = findResult.tv_results[0]
          console.log(`Found via IMDB: "${seriesTitle}" -> TMDB ID ${show.id}`)
          return String(show.id)
        }
      } catch (error) {
        console.error(`IMDB lookup failed for "${seriesTitle}":`, error)
      }
    }

    // Method 4: Fall back to title search
    try {
      console.log(`Searching TMDB by title for "${seriesTitle}"`)
      const searchResults = await tmdb.searchTVShow(seriesTitle)

      if (searchResults.results.length > 0) {
        const result = searchResults.results[0]
        console.log(`Found via search: "${seriesTitle}" -> ${result.name} (TMDB ID ${result.id})`)
        return String(result.id)
      }
    } catch (error) {
      console.error(`TMDB search failed for "${seriesTitle}":`, error)
    }

    return null
  }

  /**
   * Calculate missing episodes by comparing owned vs TMDB data
   * OPTIMIZED: Uses append_to_response to fetch all season data in ONE API call
   * instead of N+1 calls (1 show + N seasons)
   *
   * @param tmdbId TMDB show ID
   * @param ownedEpisodes List of owned episode info (season/episode numbers)
   * @param mediaItems Optional: Full media items for artwork updates (for local sources)
   * @param sourceId Optional: Source ID for artwork updates
   */
  private async calculateMissing(
    tmdbId: string,
    ownedEpisodes: EpisodeInfo[],
    mediaItems?: MediaItem[],
    sourceId?: string
  ): Promise<SeriesAnalysisResult> {
    const tmdb = getTMDBService()
    const db = getDatabase()

    // Get today's date for filtering unaired episodes
    const today = new Date().toISOString().split('T')[0]

    // First, get basic show details to know which seasons exist
    const showDetails = await tmdb.getTVShowDetails(tmdbId)
    const showPosterUrl = tmdb.buildImageUrl(showDetails.poster_path) || undefined
    if (showDetails.original_language) {
      db.media.setSeriesOriginalLanguage(tmdbId, showDetails.original_language)
    }

    // Build set of owned episodes for fast lookup
    const ownedSet = new Set<string>()
    const ownedSeasonSet = new Set<number>()

    for (const ep of ownedEpisodes) {
      // Skip season 0 (specials)
      if (ep.seasonNumber === 0) continue

      ownedSet.add(`${ep.seasonNumber}-${ep.episodeNumber}`)
      ownedSeasonSet.add(ep.seasonNumber)
    }

    // Build a map of media items by S##E## key for artwork updates
    const mediaItemMap = new Map<string, MediaItem>()
    if (mediaItems && sourceId) {
      for (const item of mediaItems) {
        if (item.season_number !== undefined && item.episode_number !== undefined) {
          const key = `${item.season_number}-${item.episode_number}`
          mediaItemMap.set(key, item)
        }
      }
      console.log(`[SeriesCompletenessService] Built mediaItemMap with ${mediaItemMap.size} episodes for artwork updates`)
    }

    const missingSeasons: number[] = []
    const missingEpisodes: MissingEpisode[] = []
    let totalEpisodes = 0

    // Get season numbers to fetch (skip season 0 - specials, skip unaired seasons)
    const regularSeasons = showDetails.seasons.filter((s) =>
      s.season_number > 0 && (!s.air_date || s.air_date <= today)
    )
    const seasonNumbers = regularSeasons.map(s => s.season_number)

    if (seasonNumbers.length === 0) {
      return {
        totalSeasons: 0,
        totalEpisodes: 0,
        ownedSeasons: ownedSeasonSet.size,
        ownedEpisodes: ownedEpisodes.filter((ep) => ep.seasonNumber !== 0).length,
        missingSeasons: [],
        missingEpisodes: [],
        completenessPercentage: 100,
        tmdbId,
        posterUrl: showPosterUrl,
        backdropUrl: tmdb.buildImageUrl(showDetails.backdrop_path) || undefined,
        status: showDetails.status || 'Unknown',
      }
    }

    // OPTIMIZATION: Fetch all season data in ONE API call using append_to_response
    // Instead of N+1 calls (1 show + N seasons), we now make just 1-2 calls
    // (TMDB limits append_to_response to 20 items, so >20 seasons need multiple calls)
    const MAX_SEASONS_PER_CALL = 20
    const seasonDataMap = new Map<number, TMDBSeasonDetails>()

    for (let i = 0; i < seasonNumbers.length; i += MAX_SEASONS_PER_CALL) {
      const batchSeasons = seasonNumbers.slice(i, i + MAX_SEASONS_PER_CALL)

      try {
        const showWithSeasons = await tmdb.getTVShowWithSeasons(tmdbId, batchSeasons)

        // Extract season data from response
        for (const seasonNum of batchSeasons) {
          const seasonKey = `season/${seasonNum}`
          if (showWithSeasons[seasonKey]) {
            seasonDataMap.set(seasonNum, showWithSeasons[seasonKey])
          }
        }
      } catch (error) {
        console.error(`[SeriesCompletenessService] Failed to fetch seasons batch:`, error)
        // Fall back to individual calls for this batch
        for (const seasonNum of batchSeasons) {
          try {
            const seasonDetails = await tmdb.getSeasonDetails(tmdbId, seasonNum)
            seasonDataMap.set(seasonNum, seasonDetails)
          } catch (err) {
            console.error(`Error fetching season ${seasonNum}:`, err)
          }
        }
      }
    }

    // Process each season's data
    for (const season of regularSeasons) {
      const seasonDetails = seasonDataMap.get(season.season_number)
      if (!seasonDetails || !seasonDetails.episodes) {
        continue
      }

      const seasonPosterUrl = tmdb.buildImageUrl(seasonDetails.poster_path) || undefined

      let seasonAiredEpisodes = 0
      let seasonOwnedEpisodes = 0

      for (const episode of seasonDetails.episodes) {
        // Only count aired episodes
        if (!episode.air_date || episode.air_date > today) {
          continue
        }

        seasonAiredEpisodes++
        totalEpisodes++

        const key = `${episode.season_number}-${episode.episode_number}`

        if (ownedSet.has(key)) {
          seasonOwnedEpisodes++

          // Update artwork for local sources
          if (sourceId && mediaItemMap.has(key)) {
            const mediaItem = mediaItemMap.get(key)!
            const episodeThumbUrl = tmdb.buildImageUrl(episode.still_path) || undefined

            console.log(`[SeriesCompletenessService] Updating artwork for S${episode.season_number}E${episode.episode_number}: poster=${!!showPosterUrl}, thumb=${!!episodeThumbUrl}, seasonPoster=${!!seasonPosterUrl}`)

            await db.updateMediaItemArtwork(sourceId, mediaItem.plex_id, {
              posterUrl: showPosterUrl,
              episodeThumbUrl: episodeThumbUrl,
              seasonPosterUrl: seasonPosterUrl,
            })
          }
        } else {
          missingEpisodes.push({
            season_number: episode.season_number,
            episode_number: episode.episode_number,
            title: episode.name,
            air_date: episode.air_date,
          })
        }
      }

      // If no episodes owned in this season, mark it as missing
      if (seasonAiredEpisodes > 0 && seasonOwnedEpisodes === 0) {
        missingSeasons.push(season.season_number)
      }
    }

    const ownedEpisodeCount = ownedEpisodes.filter((ep) => ep.seasonNumber !== 0).length
    const completenessPercentage =
      totalEpisodes > 0 ? Math.round((ownedEpisodeCount / totalEpisodes) * 100) : 0

    // Clamp to 100% max (in case user has more episodes than TMDB knows about)
    const clampedPercentage = Math.min(completenessPercentage, 100)

    return {
      totalSeasons: regularSeasons.length,
      totalEpisodes,
      ownedSeasons: ownedSeasonSet.size,
      ownedEpisodes: ownedEpisodeCount,
      missingSeasons,
      missingEpisodes,
      completenessPercentage: clampedPercentage,
      tmdbId,
      posterUrl: showPosterUrl,
      backdropUrl: tmdb.buildImageUrl(showDetails.backdrop_path) || undefined,
      status: showDetails.status || 'Unknown',
    }
  }

  /**
   * Create result for series that couldn't be matched to TMDB
   */
  private createUnmatchedResult(
    seriesTitle: string,
    ownedEpisodes: EpisodeInfo[],
    sourceId?: string,
    libraryId?: string
  ): Omit<SeriesCompleteness, 'id' | 'created_at' | 'updated_at'> {
    const nonSpecialEpisodes = ownedEpisodes.filter((ep) => ep.seasonNumber !== 0)
    const uniqueSeasons = new Set(nonSpecialEpisodes.map((ep) => ep.seasonNumber))

    return {
      series_title: seriesTitle,
      source_id: sourceId,
      library_id: libraryId,
      total_seasons: 0, // Unknown
      total_episodes: 0, // Unknown
      owned_seasons: uniqueSeasons.size,
      owned_episodes: nonSpecialEpisodes.length,
      missing_seasons: [],
      missing_episodes: [],
      completeness_percentage: 0, // Can't calculate without TMDB data
      tmdb_id: undefined,
      poster_url: undefined,
      backdrop_url: undefined,
      status: 'Unknown',
    }
  }
}

// Singleton instance
let serviceInstance: SeriesCompletenessService | null = null

export function getSeriesCompletenessService(): SeriesCompletenessService {
  if (!serviceInstance) {
    serviceInstance = new SeriesCompletenessService()
  }
  return serviceInstance
}
