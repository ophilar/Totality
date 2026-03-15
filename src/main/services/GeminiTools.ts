import type { GeminiToolDefinition } from './GeminiService'
import { getDatabase } from '../database/getDatabase'
import { getQualityAnalyzer } from './QualityAnalyzer'
import { getTMDBService } from './TMDBService'

/** Actionable item from tool results — not-owned titles the user can add to wishlist */
export interface ActionableItem {
  title: string
  year?: number
  tmdb_id?: string
  media_type: 'movie' | 'tv'
}

/** Push a not-owned item to the collector, deduplicating by tmdb_id */
function collectItem(collector: ActionableItem[] | undefined, item: ActionableItem): void {
  if (!collector || !item.tmdb_id) return
  if (collector.some((c) => c.tmdb_id === item.tmdb_id)) return
  collector.push(item)
}

/** Strip null/undefined/empty fields to reduce token usage */
function compact(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(obj)) {
    if (v !== null && v !== undefined && v !== '') result[k] = v
  }
  return result
}

/**
 * Tool definitions for Gemini AI library chat assistant.
 * Each tool maps to existing DatabaseService / QualityAnalyzer methods.
 */

export const LIBRARY_TOOLS: GeminiToolDefinition[] = [
  {
    name: 'search_library',
    description: 'Search the media library by title. Returns movies, TV shows, episodes, artists, albums, and tracks matching the query.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query (title, artist name, etc.)' },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_media_items',
    description: 'Get movies or TV episodes from the library with optional filters. Use this to find items by quality tier, type, or to list upgrades needed.',
    parameters: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['movie', 'episode'], description: 'Filter by media type' },
        quality_tier: { type: 'string', enum: ['SD', '720p', '1080p', '4K'], description: 'Filter by resolution tier' },
        tier_quality: { type: 'string', enum: ['LOW', 'MEDIUM', 'HIGH'], description: 'Filter by quality level within tier' },
        needs_upgrade: { type: 'boolean', description: 'Only return items that need quality upgrades' },
        search_query: { type: 'string', description: 'Search by title' },
        sort_by: { type: 'string', enum: ['title', 'year', 'tier_score', 'overall_score', 'updated_at'], description: 'Sort field' },
        sort_order: { type: 'string', enum: ['asc', 'desc'], description: 'Sort direction' },
        limit: { type: 'number', description: 'Max results to return (default 20, max 50)' },
      },
    },
  },
  {
    name: 'get_tv_shows',
    description: 'Get a list of TV shows in the library. Returns series titles with episode/season counts.',
    parameters: {
      type: 'object',
      properties: {
        search_query: { type: 'string', description: 'Search by show title' },
        sort_by: { type: 'string', enum: ['title', 'episode_count', 'season_count'] },
        limit: { type: 'number', description: 'Max results (default 20, max 50)' },
      },
    },
  },
  {
    name: 'get_library_stats',
    description: 'Get overall library statistics: total items, quality breakdowns, upgrade counts, and average quality scores for movies and TV separately.',
    parameters: {
      type: 'object',
      properties: {
        source_id: { type: 'string', description: 'Optional: limit stats to a specific source' },
      },
    },
  },
  {
    name: 'get_quality_distribution',
    description: 'Get the quality distribution across the entire library. Shows counts by tier (SD/720p/1080p/4K) and quality level (LOW/MEDIUM/HIGH).',
    parameters: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'get_series_completeness',
    description: 'Get TV series completeness data. Shows which series are complete/incomplete with missing episode details.',
    parameters: {
      type: 'object',
      properties: {
        series_title: { type: 'string', description: 'Optional: filter to a specific series by title' },
        incomplete_only: { type: 'boolean', description: 'Only return incomplete series (default false)' },
        limit: { type: 'number', description: 'Max results (default 20, max 50)' },
      },
    },
  },
  {
    name: 'get_collection_completeness',
    description: 'Get movie collection (franchise) completeness. Shows which collections are complete/incomplete with missing movie details.',
    parameters: {
      type: 'object',
      properties: {
        incomplete_only: { type: 'boolean', description: 'Only return incomplete collections (default false)' },
        limit: { type: 'number', description: 'Max results (default 20, max 50)' },
      },
    },
  },
  {
    name: 'get_music_stats',
    description: 'Get music library statistics: total artists, albums, tracks, and quality breakdown.',
    parameters: {
      type: 'object',
      properties: {
        source_id: { type: 'string', description: 'Optional: limit stats to a specific source' },
      },
    },
  },
  {
    name: 'get_source_list',
    description: 'List all configured media sources (Plex, Jellyfin, Emby, Kodi, Local Folders) with their status.',
    parameters: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'get_wishlist',
    description: 'Get the user\'s wishlist/shopping list items. Shows items they want to acquire or upgrade.',
    parameters: {
      type: 'object',
      properties: {
        reason: { type: 'string', enum: ['missing', 'upgrade'], description: 'Filter by reason' },
        media_type: { type: 'string', enum: ['movie', 'episode', 'season', 'album', 'track'], description: 'Filter by media type' },
        limit: { type: 'number', description: 'Max results (default 20, max 50)' },
      },
    },
  },
  {
    name: 'search_tmdb',
    description: 'Search TMDB (The Movie Database) for movies, TV shows, or movie franchises and cross-reference with the user\'s library. Use this when users ask about specific franchises, or want to know if they own something or what they\'re missing.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query (franchise name, movie title, TV show name)' },
        search_type: { type: 'string', enum: ['movie', 'tv', 'collection'], description: 'Type of search. Use "collection" for franchises (e.g., Star Wars, Marvel, Harry Potter) — searches both official TMDB collections AND standalone movies matching the query. Use "movie" for specific movies. Use "tv" for TV shows.' },
      },
      required: ['query', 'search_type'],
    },
  },
  {
    name: 'discover_titles',
    description: 'Discover movies or TV shows by genre, year range, and rating. Great for "best sci-fi movies", "top rated horror from 2020-2024", "popular comedies" queries.',
    parameters: {
      type: 'object',
      properties: {
        media_type: { type: 'string', enum: ['movie', 'tv'], description: 'Type of media to discover' },
        genre: { type: 'string', description: 'Genre name (e.g., "sci-fi", "horror", "action", "comedy", "drama", "thriller", "animation", "documentary", "fantasy", "romance")' },
        year_min: { type: 'number', description: 'Minimum release year' },
        year_max: { type: 'number', description: 'Maximum release year' },
        sort_by: { type: 'string', enum: ['popularity', 'rating'], description: 'Sort by popularity (default) or rating' },
        min_rating: { type: 'number', description: 'Minimum TMDB rating (0-10)' },
        limit: { type: 'number', description: 'Max results (default 20, max 30)' },
      },
      required: ['media_type'],
    },
  },
  {
    name: 'get_similar_titles',
    description: 'Find movies or TV shows similar to a given title. Combines TMDB "similar" and "recommendations" endpoints for best results. Use for "movies like X" or "shows similar to X" queries.',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Title to find similar content for' },
        media_type: { type: 'string', enum: ['movie', 'tv'], description: 'Type of media' },
        limit: { type: 'number', description: 'Max results (default 20, max 30)' },
      },
      required: ['title', 'media_type'],
    },
  },
  {
    name: 'check_ownership',
    description: 'Check if the user owns specific titles. Use after making recommendations from general knowledge to verify ownership status.',
    parameters: {
      type: 'object',
      properties: {
        titles: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              title: { type: 'string', description: 'Title to check' },
              year: { type: 'number', description: 'Release year (helps disambiguation)' },
              media_type: { type: 'string', enum: ['movie', 'tv'], description: 'Type of media' },
            },
            required: ['title', 'media_type'],
          },
          description: 'List of titles to check (max 20)',
        },
      },
      required: ['titles'],
    },
  },
  {
    name: 'get_item_details',
    description: 'Get full technical details for a specific media item by title or ID. Returns video/audio specs, all audio tracks, subtitle tracks, file info, versions, and quality scores. Use for in-depth quality breakdowns.',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Title to search for (used if id not provided)' },
        id: { type: 'number', description: 'Media item ID (if known from prior tool calls)' },
        type: { type: 'string', enum: ['movie', 'episode'], description: 'Filter by type when searching by title' },
      },
    },
  },
  {
    name: 'add_to_wishlist',
    description: 'Add movies or TV shows to the user\'s wishlist/shopping list. Use when the user asks to save titles for later acquisition. Always confirm what you\'re adding before calling this tool.',
    parameters: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              title: { type: 'string', description: 'Title of the movie or TV show' },
              media_type: { type: 'string', enum: ['movie', 'tv'], description: 'Type of media' },
              year: { type: 'number', description: 'Release year (helps disambiguation)' },
              tmdb_id: { type: 'number', description: 'TMDB ID if known from prior tool calls' },
              reason: { type: 'string', enum: ['missing', 'upgrade'], description: 'Why it\'s on the list (default: missing)' },
              priority: { type: 'number', description: 'Priority 1-5 (1=highest, 5=lowest, default: 3)' },
              notes: { type: 'string', description: 'Optional context (e.g., "Part of Marvel franchise")' },
            },
            required: ['title', 'media_type'],
          },
          description: 'List of titles to add (max 20)',
        },
      },
      required: ['items'],
    },
  },
]

/** Genre name aliases → TMDB canonical names */
const GENRE_ALIASES: Record<string, string> = {
  'sci-fi': 'Science Fiction',
  'scifi': 'Science Fiction',
  'science fiction': 'Science Fiction',
  'animated': 'Animation',
  'cartoons': 'Animation',
  'scary': 'Horror',
  'suspense': 'Thriller',
  'romantic': 'Romance',
  'romcom': 'Comedy',
  'war': 'War',
  'docs': 'Documentary',
  'adventure': 'Adventure',
  'action': 'Action',
  'comedy': 'Comedy',
  'drama': 'Drama',
  'horror': 'Horror',
  'thriller': 'Thriller',
  'animation': 'Animation',
  'documentary': 'Documentary',
  'fantasy': 'Fantasy',
  'romance': 'Romance',
  'mystery': 'Mystery',
  'crime': 'Crime',
  'family': 'Family',
  'western': 'Western',
  'music': 'Music',
  'history': 'History',
}

/** Resolve a user-friendly genre name to a TMDB genre ID */
async function resolveGenreId(
  genreName: string,
  mediaType: 'movie' | 'tv',
): Promise<number | null> {
  const tmdb = getTMDBService()
  const genres = mediaType === 'movie'
    ? await tmdb.getMovieGenres()
    : await tmdb.getTVGenres()

  // Try alias mapping first
  const canonical = GENRE_ALIASES[genreName.toLowerCase()] || genreName
  const match = genres.find(
    (g) => g.name.toLowerCase() === canonical.toLowerCase(),
  )
  return match?.id || null
}

/** Check TV show ownership by series TMDB ID, with title fallback */
function checkTVShowOwnership(
  db: ReturnType<typeof getDatabase>,
  tmdbId: string,
  title: string,
): { owned: boolean; episode_count: number } {
  // Primary: check by series_tmdb_id (accurate)
  const count = db.getEpisodeCountBySeriesTmdbId(tmdbId)
  if (count > 0) return { owned: true, episode_count: count }

  // Fallback: title-based search
  const tvShows = db.getTVShows({ searchQuery: title, limit: 1 })
  if (tvShows.length > 0) {
    const show = tvShows[0] as Record<string, unknown>
    return { owned: true, episode_count: (show.episode_count as number) || 0 }
  }

  return { owned: false, episode_count: 0 }
}

/**
 * Execute a tool by name with the given input.
 * Returns a JSON string result for Gemini to process.
 */
export async function executeTool(
  name: string,
  input: Record<string, unknown>,
  collector?: ActionableItem[],
): Promise<string> {
  const db = getDatabase()

  switch (name) {
    case 'search_library': {
      const query = input.query as string
      const results = db.globalSearch(query, 10)
      return JSON.stringify(results)
    }

    case 'get_media_items': {
      const limit = Math.min((input.limit as number) || 20, 50)
      const items = db.getMediaItems({
        type: input.type as 'movie' | 'episode' | undefined,
        qualityTier: input.quality_tier as string | undefined,
        tierQuality: input.tier_quality as string | undefined,
        needsUpgrade: input.needs_upgrade as boolean | undefined,
        searchQuery: input.search_query as string | undefined,
        sortBy: (input.sort_by as string | undefined) || 'title',
        sortOrder: (input.sort_order as 'asc' | 'desc' | undefined) || 'asc',
        limit,
      })
      const simplified = items.map((item: Record<string, unknown>) => compact({
        title: item.title,
        year: item.year,
        type: item.type,
        series_title: item.series_title,
        season_number: item.season_number,
        episode_number: item.episode_number,
        resolution: item.resolution,
        video_codec: item.video_codec,
        video_bitrate: item.video_bitrate,
        audio_codec: item.audio_codec,
        quality_tier: item.quality_tier,
        tier_quality: item.tier_quality,
        tier_score: item.tier_score,
        needs_upgrade: item.needs_upgrade,
      }))
      return JSON.stringify({ count: items.length, items: simplified })
    }

    case 'get_tv_shows': {
      const limit = Math.min((input.limit as number) || 20, 50)
      const shows = db.getTVShows({
        searchQuery: input.search_query as string | undefined,
        sortBy: (input.sort_by as 'title' | 'episode_count' | 'season_count' | undefined) || 'title',
        limit,
      })
      const simplified = shows.map((s: Record<string, unknown>) => compact({
        series_title: s.series_title,
        episode_count: s.episode_count,
        season_count: s.season_count,
      }))
      return JSON.stringify({ count: shows.length, shows: simplified })
    }

    case 'get_library_stats': {
      const stats = db.getLibraryStats(input.source_id as string | undefined)
      return JSON.stringify(stats)
    }

    case 'get_quality_distribution': {
      const distribution = getQualityAnalyzer().getQualityDistribution()
      return JSON.stringify(distribution)
    }

    case 'get_series_completeness': {
      let series
      if (input.series_title) {
        const single = db.getSeriesCompletenessByTitle(
          input.series_title as string,
        )
        series = single ? [single] : []
      } else if (input.incomplete_only) {
        series = db.getIncompleteSeries()
      } else {
        series = db.getAllSeriesCompleteness()
      }
      const limit = Math.min((input.limit as number) || 20, 50)
      const limited = series.slice(0, limit)
      const simplified = limited.map((s: Record<string, unknown>) => {
        let missingCount = 0
        let missingSample: string[] = []
        try {
          const parsed = JSON.parse((s.missing_episodes as string) || '[]')
          missingCount = parsed.length
          missingSample = parsed.slice(0, 5).map((e: Record<string, unknown>) =>
            `S${e.season_number}E${e.episode_number}`,
          )
        } catch { /* empty */ }
        return compact({
          series_title: s.series_title,
          total_seasons: s.total_seasons,
          total_episodes: s.total_episodes,
          owned_episodes: s.owned_episodes,
          completeness_percentage: s.completeness_percentage,
          status: s.status,
          missing_count: missingCount,
          missing_sample: missingSample.length > 0 ? missingSample : undefined,
        })
      })
      return JSON.stringify({ count: series.length, shown: limited.length, series: simplified })
    }

    case 'get_collection_completeness': {
      let collections
      if (input.incomplete_only) {
        collections = db.getIncompleteMovieCollections()
      } else {
        collections = db.getMovieCollections()
      }
      const limit = Math.min((input.limit as number) || 20, 50)
      const limited = collections.slice(0, limit)
      const simplified = limited.map((c: Record<string, unknown>) => {
        let missingCount = 0
        let missingSample: string[] = []
        try {
          const parsed = JSON.parse((c.missing_movies as string) || '[]')
          missingCount = parsed.length
          missingSample = parsed.slice(0, 5).map((m: Record<string, unknown>) =>
            m.year ? `${m.title} (${m.year})` : `${m.title}`,
          )
        } catch { /* empty */ }
        return compact({
          collection_name: c.collection_name,
          total_movies: c.total_movies,
          owned_movies: c.owned_movies,
          completeness_percentage: c.completeness_percentage,
          missing_count: missingCount,
          missing_sample: missingSample.length > 0 ? missingSample : undefined,
        })
      })
      return JSON.stringify({ count: collections.length, shown: limited.length, collections: simplified })
    }

    case 'get_music_stats': {
      const stats = db.getMusicStats(input.source_id as string | undefined)
      return JSON.stringify(stats)
    }

    case 'get_source_list': {
      const stats = db.getAggregatedSourceStats()
      return JSON.stringify(stats)
    }

    case 'get_wishlist': {
      const limit = Math.min((input.limit as number) || 20, 50)
      const items = db.getWishlistItems({
        reason: input.reason as 'missing' | 'upgrade' | undefined,
        media_type: input.media_type as string | undefined,
        limit,
        status: 'active',
      })
      const simplified = items.map((item: Record<string, unknown>) => compact({
        media_type: item.media_type,
        title: item.title,
        year: item.year,
        reason: item.reason,
        priority: item.priority,
        series_title: item.series_title,
        collection_name: item.collection_name,
        artist_name: item.artist_name,
        current_quality_tier: item.current_quality_tier,
        current_quality_level: item.current_quality_level,
      }))
      return JSON.stringify({ count: items.length, items: simplified })
    }

    case 'search_tmdb': {
      const query = input.query as string
      const searchType = input.search_type as string
      const tmdb = getTMDBService()

      if (searchType === 'collection') {
        // Search both collections AND general movies to catch standalone franchise films
        const [collectionResults, movieResults] = await Promise.all([
          tmdb.searchCollection(query),
          tmdb.searchMovie(query),
        ])
        const collections = collectionResults.results.slice(0, 3)

        // Track all TMDB IDs we've already included from collections to avoid duplicates
        const seenTmdbIds = new Set<string>()
        const collectionData = []

        for (const col of collections) {
          const details = await tmdb.getCollectionDetails(String(col.id))
          const tmdbIds = details.parts.map((p) => String(p.id))
          tmdbIds.forEach((id) => seenTmdbIds.add(id))

          // Cross-reference with owned media
          const ownedByTmdbId = db.getMediaItemsByTmdbIds(tmdbIds)

          const movies = details.parts
            .filter((p) => p.release_date && new Date(p.release_date) <= new Date())
            .map((p) => {
              const ownedItem = ownedByTmdbId.get(String(p.id)) as Record<string, unknown> | undefined
              if (!ownedItem) {
                collectItem(collector, { title: p.title, year: parseInt(p.release_date?.substring(0, 4) || '0') || undefined, tmdb_id: String(p.id), media_type: 'movie' })
              }
              return {
                title: p.title,
                year: p.release_date?.substring(0, 4) || null,
                tmdb_id: p.id,
                owned: !!ownedItem,
                quality: ownedItem ? `${ownedItem.quality_tier} ${ownedItem.tier_quality}` : null,
              }
            })

          collectionData.push({
            collection_name: details.name,
            total_movies: movies.length,
            owned_count: movies.filter((m) => m.owned).length,
            missing_count: movies.filter((m) => !m.owned).length,
            movies,
          })
        }

        // Find standalone movies matching the query that aren't in any collection
        const standaloneMovies = movieResults.results
          .filter((m) => !seenTmdbIds.has(String(m.id)))
          .slice(0, 10)

        let standaloneData = null
        if (standaloneMovies.length > 0) {
          const tmdbIds = standaloneMovies.map((m) => String(m.id))
          const ownedByTmdbId = db.getMediaItemsByTmdbIds(tmdbIds)

          const movies = standaloneMovies
            .filter((m) => m.release_date && new Date(m.release_date) <= new Date())
            .map((m) => {
              const ownedItem = ownedByTmdbId.get(String(m.id)) as Record<string, unknown> | undefined
              if (!ownedItem) {
                collectItem(collector, { title: m.title, year: parseInt(m.release_date?.substring(0, 4) || '0') || undefined, tmdb_id: String(m.id), media_type: 'movie' })
              }
              return {
                title: m.title,
                year: m.release_date?.substring(0, 4) || null,
                tmdb_id: m.id,
                owned: !!ownedItem,
                quality: ownedItem ? `${ownedItem.quality_tier} ${ownedItem.tier_quality}` : null,
              }
            })

          standaloneData = {
            label: `Other "${query}" movies (not in a collection)`,
            total_movies: movies.length,
            owned_count: movies.filter((m) => m.owned).length,
            missing_count: movies.filter((m) => !m.owned).length,
            movies,
          }
        }

        if (collectionData.length === 0 && !standaloneData) {
          return JSON.stringify({ message: `No movies or collections found matching "${query}"` })
        }

        return JSON.stringify({
          collections_found: collectionData.length,
          collections: collectionData,
          standalone_movies: standaloneData,
        })
      }

      if (searchType === 'movie') {
        const searchResults = await tmdb.searchMovie(query)
        const movies = searchResults.results.slice(0, 10)

        if (movies.length === 0) {
          return JSON.stringify({ message: `No movies found matching "${query}"` })
        }

        const tmdbIds = movies.map((m) => String(m.id))
        const ownedByTmdbId = db.getMediaItemsByTmdbIds(tmdbIds)

        const results = movies.map((m) => {
          const ownedItem = ownedByTmdbId.get(String(m.id)) as Record<string, unknown> | undefined
          if (!ownedItem) {
            collectItem(collector, { title: m.title, year: parseInt(m.release_date?.substring(0, 4) || '0') || undefined, tmdb_id: String(m.id), media_type: 'movie' })
          }
          return {
            title: m.title,
            year: m.release_date?.substring(0, 4) || null,
            tmdb_id: m.id,
            owned: !!ownedItem,
            quality: ownedItem ? {
              resolution: ownedItem.resolution,
              video_codec: ownedItem.video_codec,
              video_bitrate: ownedItem.video_bitrate,
              audio_codec: ownedItem.audio_codec,
              quality_tier: ownedItem.quality_tier,
              tier_quality: ownedItem.tier_quality,
            } : null,
          }
        })

        return JSON.stringify({ movies_found: results.length, results })
      }

      if (searchType === 'tv') {
        const searchResults = await tmdb.searchTVShow(query)
        const shows = searchResults.results.slice(0, 10)

        if (shows.length === 0) {
          return JSON.stringify({ message: `No TV shows found matching "${query}"` })
        }

        // Cross-reference with owned TV shows by title
        const results = shows.map((s) => {
          const tvShows = db.getTVShows({ searchQuery: s.name, limit: 1 })
          const match = tvShows.length > 0 ? tvShows[0] : null

          if (!match) {
            collectItem(collector, { title: s.name, year: parseInt(s.first_air_date?.substring(0, 4) || '0') || undefined, tmdb_id: String(s.id), media_type: 'tv' })
          }

          return {
            title: s.name,
            first_air_date: s.first_air_date,
            tmdb_id: s.id,
            overview: s.overview?.substring(0, 150) || null,
            owned_episodes: match ? (match as Record<string, unknown>).episode_count : 0,
            in_library: !!match,
          }
        })

        return JSON.stringify({ shows_found: results.length, results })
      }

      return JSON.stringify({ error: `Unknown search_type: ${searchType}` })
    }

    case 'discover_titles': {
      const mediaType = input.media_type as 'movie' | 'tv'
      const genre = input.genre as string | undefined
      const yearMin = input.year_min as number | undefined
      const yearMax = input.year_max as number | undefined
      const sortBy = input.sort_by as string | undefined
      const minRating = input.min_rating as number | undefined
      const limit = Math.min((input.limit as number) || 20, 30)

      const tmdb = getTMDBService()

      // Resolve genre name to ID
      let genreId: number | null = null
      if (genre) {
        genreId = await resolveGenreId(genre, mediaType)
        if (!genreId) {
          return JSON.stringify({ error: `Unknown genre: "${genre}". Try: action, comedy, drama, horror, sci-fi, thriller, animation, documentary, fantasy, romance, mystery, crime, family, western.` })
        }
      }

      // Map sort_by to TMDB sort parameter
      const tmdbSortBy = sortBy === 'rating' ? 'vote_average.desc' : 'popularity.desc'
      const minVoteCount = sortBy === 'rating' ? 200 : 50

      if (mediaType === 'movie') {
        const response = await tmdb.discoverMovies({
          genreId: genreId || undefined,
          yearMin,
          yearMax,
          sortBy: tmdbSortBy,
          minRating,
          minVoteCount,
        })

        const movies = response.results.slice(0, limit)
        const tmdbIds = movies.map((m) => String(m.id))
        const ownedByTmdbId = db.getMediaItemsByTmdbIds(tmdbIds)

        const results = movies.map((m) => {
          const ownedItem = ownedByTmdbId.get(String(m.id)) as Record<string, unknown> | undefined
          if (!ownedItem) {
            collectItem(collector, { title: m.title, year: parseInt(m.release_date?.substring(0, 4) || '0') || undefined, tmdb_id: String(m.id), media_type: 'movie' })
          }
          return compact({
            title: m.title,
            year: m.release_date?.substring(0, 4) || null,
            tmdb_id: m.id,
            rating: m.vote_average,
            owned: !!ownedItem,
            quality: ownedItem ? `${ownedItem.quality_tier} ${ownedItem.tier_quality}` : null,
          })
        })

        return JSON.stringify({
          media_type: 'movie',
          genre: genre || 'all',
          total_found: response.total_results,
          shown: results.length,
          owned_count: results.filter((r) => r.owned).length,
          results,
        })
      } else {
        const response = await tmdb.discoverTV({
          genreId: genreId || undefined,
          yearMin,
          yearMax,
          sortBy: tmdbSortBy,
          minRating,
          minVoteCount,
        })

        const shows = response.results.slice(0, limit)
        const results = shows.map((s) => {
          const ownership = checkTVShowOwnership(db, String(s.id), s.name)
          if (!ownership.owned) {
            collectItem(collector, { title: s.name, year: parseInt(s.first_air_date?.substring(0, 4) || '0') || undefined, tmdb_id: String(s.id), media_type: 'tv' })
          }
          return compact({
            title: s.name,
            first_air_date: s.first_air_date,
            tmdb_id: s.id,
            rating: s.vote_average,
            owned: ownership.owned,
            owned_episodes: ownership.owned ? ownership.episode_count : null,
          })
        })

        return JSON.stringify({
          media_type: 'tv',
          genre: genre || 'all',
          total_found: response.total_results,
          shown: results.length,
          owned_count: results.filter((r) => r.owned).length,
          results,
        })
      }
    }

    case 'get_similar_titles': {
      const title = input.title as string
      const mediaType = input.media_type as 'movie' | 'tv'
      const limit = Math.min((input.limit as number) || 20, 30)
      const tmdb = getTMDBService()

      if (mediaType === 'movie') {
        // Search for the movie first
        const searchResults = await tmdb.searchMovie(title)
        if (searchResults.results.length === 0) {
          return JSON.stringify({ error: `Could not find movie "${title}" on TMDB` })
        }
        const sourceTmdbId = String(searchResults.results[0].id)
        const sourceTitle = searchResults.results[0].title

        // Fetch both similar and recommendations, deduplicate
        const [similar, recommendations] = await Promise.all([
          tmdb.getSimilarMovies(sourceTmdbId),
          tmdb.getMovieRecommendations(sourceTmdbId),
        ])

        const seen = new Set<number>()
        const combined: typeof similar.results = []
        // Recommendations first (higher quality suggestions)
        for (const m of recommendations.results) {
          if (!seen.has(m.id)) { seen.add(m.id); combined.push(m) }
        }
        for (const m of similar.results) {
          if (!seen.has(m.id)) { seen.add(m.id); combined.push(m) }
        }

        const limited = combined.slice(0, limit)
        const tmdbIds = limited.map((m) => String(m.id))
        const ownedByTmdbId = db.getMediaItemsByTmdbIds(tmdbIds)

        const results = limited.map((m) => {
          const ownedItem = ownedByTmdbId.get(String(m.id)) as Record<string, unknown> | undefined
          if (!ownedItem) {
            collectItem(collector, { title: m.title, year: parseInt(m.release_date?.substring(0, 4) || '0') || undefined, tmdb_id: String(m.id), media_type: 'movie' })
          }
          return compact({
            title: m.title,
            year: m.release_date?.substring(0, 4) || null,
            tmdb_id: m.id,
            rating: m.vote_average,
            owned: !!ownedItem,
            quality: ownedItem ? `${ownedItem.quality_tier} ${ownedItem.tier_quality}` : null,
          })
        })

        return JSON.stringify({
          similar_to: sourceTitle,
          media_type: 'movie',
          shown: results.length,
          owned_count: results.filter((r) => r.owned).length,
          results,
        })
      } else {
        // TV show
        const searchResults = await tmdb.searchTVShow(title)
        if (searchResults.results.length === 0) {
          return JSON.stringify({ error: `Could not find TV show "${title}" on TMDB` })
        }
        const sourceTmdbId = String(searchResults.results[0].id)
        const sourceTitle = searchResults.results[0].name

        const [similar, recommendations] = await Promise.all([
          tmdb.getSimilarTV(sourceTmdbId),
          tmdb.getTVRecommendations(sourceTmdbId),
        ])

        const seen = new Set<number>()
        const combined: typeof similar.results = []
        for (const s of recommendations.results) {
          if (!seen.has(s.id)) { seen.add(s.id); combined.push(s) }
        }
        for (const s of similar.results) {
          if (!seen.has(s.id)) { seen.add(s.id); combined.push(s) }
        }

        const limited = combined.slice(0, limit)
        const results = limited.map((s) => {
          const ownership = checkTVShowOwnership(db, String(s.id), s.name)
          if (!ownership.owned) {
            collectItem(collector, { title: s.name, year: parseInt(s.first_air_date?.substring(0, 4) || '0') || undefined, tmdb_id: String(s.id), media_type: 'tv' })
          }
          return compact({
            title: s.name,
            first_air_date: s.first_air_date,
            tmdb_id: s.id,
            rating: s.vote_average,
            owned: ownership.owned,
            owned_episodes: ownership.owned ? ownership.episode_count : null,
          })
        })

        return JSON.stringify({
          similar_to: sourceTitle,
          media_type: 'tv',
          shown: results.length,
          owned_count: results.filter((r) => r.owned).length,
          results,
        })
      }
    }

    case 'check_ownership': {
      const titles = (input.titles as Array<{ title: string; year?: number; media_type: string }>)
        .slice(0, 20)
      const tmdb = getTMDBService()

      const results = []
      for (const item of titles) {
        try {
          if (item.media_type === 'movie') {
            const searchResults = await tmdb.searchMovie(item.title, item.year)
            if (searchResults.results.length === 0) {
              results.push({ title: item.title, year: item.year, media_type: 'movie', found: false })
              continue
            }
            const movie = searchResults.results[0]
            const ownedMap = db.getMediaItemsByTmdbIds([String(movie.id)])
            const ownedItem = ownedMap.get(String(movie.id)) as Record<string, unknown> | undefined

            if (!ownedItem) {
              collectItem(collector, { title: movie.title, year: parseInt(movie.release_date?.substring(0, 4) || '0') || item.year, tmdb_id: String(movie.id), media_type: 'movie' })
            }
            results.push(compact({
              title: movie.title,
              year: movie.release_date?.substring(0, 4) || item.year,
              media_type: 'movie',
              found: true,
              owned: !!ownedItem,
              quality: ownedItem ? `${ownedItem.quality_tier} ${ownedItem.tier_quality}` : null,
            }))
          } else {
            const searchResults = await tmdb.searchTVShow(item.title)
            if (searchResults.results.length === 0) {
              results.push({ title: item.title, media_type: 'tv', found: false })
              continue
            }
            const show = searchResults.results[0]
            const ownership = checkTVShowOwnership(db, String(show.id), show.name)

            if (!ownership.owned) {
              collectItem(collector, { title: show.name, year: parseInt(show.first_air_date?.substring(0, 4) || '0') || undefined, tmdb_id: String(show.id), media_type: 'tv' })
            }
            results.push(compact({
              title: show.name,
              first_air_date: show.first_air_date,
              media_type: 'tv',
              found: true,
              owned: ownership.owned,
              owned_episodes: ownership.owned ? ownership.episode_count : null,
            }))
          }
        } catch {
          results.push({ title: item.title, media_type: item.media_type, error: 'lookup failed' })
        }
      }

      return JSON.stringify({
        checked: results.length,
        owned_count: results.filter((r) => (r as Record<string, unknown>).owned).length,
        results,
      })
    }

    case 'get_item_details': {
      let item: Record<string, unknown> | null = null

      if (input.id) {
        item = db.getMediaItemById(input.id as number) as Record<string, unknown> | null
      } else if (input.title) {
        const results = db.globalSearch(input.title as string, 5)
        const mediaResults = (results as Record<string, unknown>).media_items as Array<Record<string, unknown>> | undefined
        if (mediaResults && mediaResults.length > 0) {
          const typeFilter = input.type as string | undefined
          const match = typeFilter
            ? mediaResults.find((r) => r.type === typeFilter) || mediaResults[0]
            : mediaResults[0]
          item = db.getMediaItemById(match.id as number) as Record<string, unknown> | null
        }
      }

      if (!item) {
        return JSON.stringify({ error: 'Item not found' })
      }

      // Parse audio tracks
      let audioTracks: Array<Record<string, unknown>> = []
      try {
        if (item.audio_tracks) {
          audioTracks = JSON.parse(item.audio_tracks as string).map((t: Record<string, unknown>) => compact({
            codec: t.codec,
            channels: t.channels,
            language: t.language,
            bitrate: t.bitrate,
            sample_rate: t.sample_rate,
            profile: t.profile,
            object_audio: t.has_object_audio || undefined,
          }))
        }
      } catch { /* empty */ }

      // Parse subtitle tracks
      let subtitleTracks: string[] = []
      try {
        if (item.subtitle_tracks) {
          subtitleTracks = JSON.parse(item.subtitle_tracks as string).map(
            (t: Record<string, unknown>) => t.language || t.title || 'Unknown',
          )
        }
      } catch { /* empty */ }

      // Get quality score
      const qualityScore = db.getQualityScoreByMediaId(item.id as number) as Record<string, unknown> | null

      // Get versions
      const versions = db.getMediaItemVersions(item.id as number) as Array<Record<string, unknown>>
      const versionData = versions.length > 1 ? versions.map((v) => compact({
        edition: v.edition,
        label: v.label,
        resolution: v.resolution,
        video_codec: v.video_codec,
        video_bitrate: v.video_bitrate,
        audio_codec: v.audio_codec,
        audio_channels: v.audio_channels,
        hdr_format: v.hdr_format,
        file_size: v.file_size,
        quality_tier: v.quality_tier,
        tier_quality: v.tier_quality,
        is_best: v.is_best,
      })) : undefined

      const fileSizeMB = item.file_size ? Math.round((item.file_size as number) / 1024 / 1024) : null
      const durationMin = item.duration ? Math.round((item.duration as number) / 60) : null

      const details = compact({
        title: item.title,
        year: item.year,
        type: item.type,
        series_title: item.series_title,
        season_number: item.season_number,
        episode_number: item.episode_number,
        // Video
        resolution: item.resolution,
        video_codec: item.video_codec,
        video_bitrate: item.video_bitrate,
        video_frame_rate: item.video_frame_rate,
        hdr_format: item.hdr_format,
        color_bit_depth: item.color_bit_depth,
        color_space: item.color_space,
        // Audio (primary)
        audio_codec: item.audio_codec,
        audio_channels: item.audio_channels,
        audio_bitrate: item.audio_bitrate,
        has_object_audio: item.has_object_audio,
        // All tracks
        audio_tracks: audioTracks.length > 0 ? audioTracks : undefined,
        subtitle_languages: subtitleTracks.length > 0 ? subtitleTracks : undefined,
        // File
        container: item.container,
        file_size_mb: fileSizeMB,
        duration_min: durationMin,
        // Quality
        quality_tier: qualityScore?.quality_tier || item.quality_tier,
        tier_quality: qualityScore?.tier_quality || item.tier_quality,
        tier_score: qualityScore?.tier_score || item.tier_score,
        bitrate_score: qualityScore?.bitrate_tier_score,
        audio_score: qualityScore?.audio_tier_score,
        needs_upgrade: qualityScore?.needs_upgrade,
        // Versions
        version_count: (item.version_count as number) || 1,
        versions: versionData,
      })

      return JSON.stringify(details)
    }

    case 'add_to_wishlist': {
      const items = (input.items as Array<{
        title: string
        media_type: string
        year?: number
        tmdb_id?: number
        reason?: string
        priority?: number
        notes?: string
      }>).slice(0, 20)
      const tmdb = getTMDBService()

      const wishlistItems: Array<Record<string, unknown>> = []
      for (const item of items) {
        let tmdbId = item.tmdb_id ? String(item.tmdb_id) : undefined
        let resolvedTitle = item.title
        let posterUrl: string | null = null

        // Resolve TMDB ID if not provided
        if (!tmdbId) {
          try {
            if (item.media_type === 'movie') {
              const results = await tmdb.searchMovie(item.title, item.year)
              if (results.results.length > 0) {
                const match = results.results[0]
                tmdbId = String(match.id)
                resolvedTitle = match.title
                posterUrl = tmdb.buildImageUrl(match.poster_path, 'w300')
              }
            } else {
              const results = await tmdb.searchTVShow(item.title)
              if (results.results.length > 0) {
                const match = results.results[0]
                tmdbId = String(match.id)
                resolvedTitle = match.name
                posterUrl = tmdb.buildImageUrl(match.poster_path, 'w300')
              }
            }
          } catch { /* continue without TMDB data */ }
        }

        wishlistItems.push({
          media_type: item.media_type === 'tv' ? 'season' : 'movie',
          title: resolvedTitle,
          year: item.year,
          tmdb_id: tmdbId,
          poster_url: posterUrl,
          reason: item.reason || 'missing',
          priority: Math.max(1, Math.min(5, item.priority || 3)),
          notes: item.notes,
          status: 'active',
        })
      }

      const added = db.addWishlistItemsBulk(wishlistItems as never[])
      const skipped = wishlistItems.length - added

      return JSON.stringify({
        added,
        skipped_duplicates: skipped,
        items: wishlistItems.map((w) => compact({
          title: w.title,
          media_type: w.media_type,
          year: w.year,
          reason: w.reason,
          priority: w.priority,
        })),
      })
    }

    default:
      return JSON.stringify({ error: `Unknown tool: ${name}` })
  }
}
