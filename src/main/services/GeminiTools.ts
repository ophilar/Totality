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
  if (collector.some((c: any) => c.tmdb_id === item.tmdb_id)) return
  collector.push(item)
}

/** Strip null/undefined/empty fields to reduce token usage */
function compact(obj: any): any {
  const result: any = {}
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
    description: 'Get music library statistics: total artists, albums, tracks.',
    parameters: {
      type: 'object',
      properties: {
        source_id: { type: 'string', description: 'Optional: limit stats to a specific source' },
      },
    },
  },
  {
    name: 'get_music_albums',
    description: 'Get music albums from the library with optional filters. Use to browse albums by artist, quality tier, or find albums needing upgrades.',
    parameters: {
      type: 'object',
      properties: {
        artist_name: { type: 'string', description: 'Filter albums by artist name' },
        quality_tier: { type: 'string', enum: ['LOSSY_LOW', 'LOSSY_MID', 'LOSSY_HIGH', 'LOSSLESS', 'HI_RES'], description: 'Filter by audio quality tier' },
        needs_upgrade: { type: 'boolean', description: 'Only return albums that need quality upgrades' },
        search_query: { type: 'string', description: 'Search by album title' },
        sort_by: { type: 'string', enum: ['title', 'artist', 'year', 'added_at'], description: 'Sort field' },
        sort_order: { type: 'string', enum: ['asc', 'desc'], description: 'Sort direction' },
        limit: { type: 'number', description: 'Max results to return (default 20, max 50)' },
      },
    },
  },
  {
    name: 'get_music_quality_distribution',
    description: 'Get music quality distribution across the library. Shows counts by audio quality tier (Hi-Res, Lossless, Lossy High/Mid/Low) and lists albums needing upgrades.',
    parameters: {
      type: 'object',
      properties: {
        include_upgrades: { type: 'boolean', description: 'Include list of albums needing upgrade (default false)' },
        upgrade_limit: { type: 'number', description: 'Max upgrade albums to return (default 10)' },
      },
    },
  },
  {
    name: 'get_artist_completeness',
    description: 'Get artist discography completeness from MusicBrainz. Shows which artists have incomplete discographies with missing album details. Use for "which artists am I missing albums from?" queries.',
    parameters: {
      type: 'object',
      properties: {
        artist_name: { type: 'string', description: 'Optional: check completeness for a specific artist' },
        incomplete_only: { type: 'boolean', description: 'Only return artists with missing albums (default false)' },
        limit: { type: 'number', description: 'Max results (default 20, max 50)' },
      },
    },
  },
  {
    name: 'get_album_details',
    description: 'Get detailed information about a specific album: tracks, audio quality (codec, bitrate, sample rate, bit depth), quality score, and completeness.',
    parameters: {
      type: 'object',
      properties: {
        album_id: { type: 'number', description: 'Album ID (from prior tool calls)' },
        album_title: { type: 'string', description: 'Album title to search for (used if album_id not provided)' },
        artist_name: { type: 'string', description: 'Artist name to help disambiguation when searching by title' },
      },
    },
  },
  {
    name: 'check_music_ownership',
    description: 'Check if the user owns music by specific artists. Use after recommending artists to verify which are already in the library.',
    parameters: {
      type: 'object',
      properties: {
        artists: {
          type: 'array',
          items: { type: 'string', description: 'Artist name' },
          description: 'List of artist names to check (max 20)',
        },
      },
      required: ['artists'],
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
    description: 'Find movies or TV shows similar to a given title. Combines TMDB "similar" and "recommendations" endpoints for best results. Use for "movies like X" or "shows similar to X" queries. Always provide year when known to ensure correct title match.',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Title to find similar content for' },
        year: { type: 'number', description: 'Release year (important for disambiguation, especially short titles)' },
        media_type: { type: 'string', enum: ['movie', 'tv'], description: 'Type of media' },
        limit: { type: 'number', description: 'Max results (default 20, max 30)' },
      },
      required: ['title', 'media_type'],
    },
  },
  {
    name: 'check_ownership',
    description: 'Check if the user owns specific movies or TV shows. Use after making recommendations to verify ownership status. For music artists, use check_music_ownership instead.',
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
    description: 'Add movies, TV shows, or music albums to the user\'s wishlist/shopping list. Use when the user asks to save titles for later acquisition. Always confirm what you\'re adding before calling this tool.',
    parameters: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              title: { type: 'string', description: 'Title of the movie, TV show, or album' },
              media_type: { type: 'string', enum: ['movie', 'tv', 'album', 'track'], description: 'Type of media' },
              year: { type: 'number', description: 'Release year (helps disambiguation)' },
              tmdb_id: { type: 'number', description: 'TMDB ID if known (movies/TV only)' },
              artist_name: { type: 'string', description: 'Artist name (music only)' },
              reason: { type: 'string', enum: ['missing', 'upgrade'], description: 'Why it\'s on the list (default: missing)' },
              priority: { type: 'number', description: 'Priority 1-5 (1=highest, 5=lowest, default: 3)' },
              notes: { type: 'string', description: 'Optional context (e.g., "Part of Marvel franchise", "Need lossless version")' },
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
    (g: any) => g.name.toLowerCase() === canonical.toLowerCase(),
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
  const count = db.media.getEpisodeCountBySeriesTmdbId(tmdbId)
  if (count > 0) return { owned: true, episode_count: count }

  // Fallback: title-based search
  const tvShows = db.tvShows.getSummaries({ searchQuery: title, limit: 1 })
  if (tvShows.length > 0) {
    const show = tvShows[0] as any
    return { owned: true, episode_count: (show.episode_count as number) || 0 }
  }

  return { owned: false, episode_count: 0 }
}

/** Sanitize and validate a string tool input */
function toolString(input: any, key: string, maxLen = 500): string {
  const val = input[key]
  if (typeof val !== 'string') return ''
  return val.slice(0, maxLen).trim()
}

/** Sanitize and validate a numeric tool input */
function toolNumber(input: any, key: string, min = 0, max = 10000): number | undefined {
  const val = input[key]
  if (val === undefined || val === null) return undefined
  const num = typeof val === 'number' ? val : Number(val)
  if (isNaN(num)) return undefined
  return Math.max(min, Math.min(max, Math.floor(num)))
}

/** Sanitize and validate a boolean tool input */
function toolBoolean(input: any, key: string): boolean | undefined {
  const val = input[key]
  if (typeof val === 'boolean') return val
  return undefined
}

/**
 * Execute a tool by name with the given input.
 * Returns a JSON string result for Gemini to process.
 */
export async function executeTool(
  name: string,
  input: any,
  collector?: ActionableItem[],
): Promise<string> {
  const db = getDatabase()

  switch (name) {
    case 'search_library': {
      const query = toolString(input, 'query', 200)
      if (!query) return JSON.stringify({ error: 'query is required' })
      const results = db.media.globalSearch(query, 10)
      const hasResults = results.movies.length > 0 || results.tvShows.length > 0 ||
        results.artists.length > 0 || results.albums.length > 0

      // Fallback: if no local results, try TMDB lookup + ownership check
      if (!hasResults) {
        try {
          const tmdb = getTMDBService()
          const movieResults = await tmdb.searchMovie(query)
          if (movieResults.results.length > 0) {
            const tmdbIds = movieResults.results.slice(0, 5).map((m: { id: number }) => String(m.id))
            const ownedMap = db.media.getItemsByTmdbIds(tmdbIds)
            const found = movieResults.results.slice(0, 5).map((m: { id: number; title: string; release_date?: string }) => {
              const owned = ownedMap.get(String(m.id))
              return compact({
                title: m.title,
                year: m.release_date?.substring(0, 4),
                tmdb_id: m.id,
                owned: !!owned,
                quality: owned ? `${owned.quality_tier} ${owned.tier_quality}` : null,
                id: owned ? owned.id : null,
              })
            })
            return JSON.stringify({ tmdb_matches: found })
          }
        } catch (error) { throw error }
      }

      return JSON.stringify(results)
    }

    case 'get_media_items': {
      const limit = toolNumber(input, 'limit', 1, 50) || 20
      const items = db.media.getItems({
        type: toolString(input, 'type') as 'movie' | 'episode' | undefined || undefined,
        qualityTier: toolString(input, 'quality_tier') || undefined,
        tierQuality: toolString(input, 'tier_quality') || undefined,
        needsUpgrade: toolBoolean(input, 'needs_upgrade'),
        searchQuery: toolString(input, 'search_query', 200) || undefined,
        sortBy: toolString(input, 'sort_by') as any || 'title',
        sortOrder: (toolString(input, 'sort_order') as 'asc' | 'desc') || 'asc',
        limit,
      })
      const simplified = items.map((item) => compact({
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
      const limit = toolNumber(input, 'limit', 1, 50) || 20
      const shows = db.tvShows.getSummaries({
        searchQuery: toolString(input, 'search_query', 200) || undefined,
        sortBy: (toolString(input, 'sort_by') as any) || 'title',
        limit,
      })
      const simplified = shows.map((s) => compact({
        series_title: s.series_title,
        episode_count: s.episode_count,
        season_count: s.season_count,
      }))
      return JSON.stringify({ count: shows.length, shows: simplified })
    }

    case 'get_library_stats': {
      const stats = db.stats.getLibraryStats(toolString(input, 'source_id') || undefined)
      return JSON.stringify(stats)
    }

    case 'get_quality_distribution': {
      const distribution = getQualityAnalyzer().getQualityDistribution()
      return JSON.stringify(distribution)
    }

    case 'get_series_completeness': {
      let series
      const seriesTitle = toolString(input, 'series_title', 300)
      if (seriesTitle) {
        const single = db.tvShows.getCompletenessByTitle(seriesTitle)
        series = single ? [single] : []
      } else if (toolBoolean(input, 'incomplete_only')) {
        series = db.tvShows.getIncomplete()
      } else {
        series = db.tvShows.getAllCompleteness()
      }
      const seriesLimit = toolNumber(input, 'limit', 1, 50) || 20
      const limited = series.slice(0, seriesLimit)
      const simplified = limited.map((s) => {
        let missingCount = 0
        let missingSample: string[] = []
        try {
          const parsed = JSON.parse((s.missing_episodes as string) || '[]')
          missingCount = parsed.length
          missingSample = parsed.slice(0, 5).map((e: any) =>
            `S${e.season_number}E${e.episode_number}`,
          )
        } catch (e) { /* ignore */ }
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
      if (toolBoolean(input, 'incomplete_only')) {
        collections = db.movieCollections.getIncompleteCollections()
      } else {
        collections = db.movieCollections.getCollections()
      }
      const collLimit = toolNumber(input, 'limit', 1, 50) || 20
      const limited = collections.slice(0, collLimit)
      const simplified = limited.map((c) => {
        let missingCount = 0
        let missingSample: string[] = []
        try {
          const parsed = JSON.parse((c.missing_movies as string) || '[]')
          missingCount = parsed.length
          missingSample = parsed.slice(0, 5).map((m: any) =>
            m.year ? `${m.title} (${m.year})` : `${m.title}`,
          )
        } catch (e) { /* ignore */ }
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
      const stats = db.music.getStats(toolString(input, 'source_id') || undefined)
      return JSON.stringify(stats)
    }

    case 'get_source_list': {
      const stats = db.stats.getAggregatedSourceStats()
      return JSON.stringify(stats)
    }

    case 'get_wishlist': {
      const wlLimit = toolNumber(input, 'limit', 1, 50) || 20
      const items = db.wishlist.getItems({
        reason: (toolString(input, 'reason') as 'missing' | 'upgrade') || undefined,
        media_type: toolString(input, 'media_type') as any || undefined,
        limit: wlLimit,
        status: 'active',
      })
      const simplified = items.map((item) => compact({
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
      const query = toolString(input, 'query', 200)
      if (!query) return JSON.stringify({ error: 'query is required' })
      const searchType = toolString(input, 'search_type') || 'movie'
      const tmdb = getTMDBService()

      if (searchType === 'collection') {
        const [collectionResults, movieResults] = await Promise.all([
          tmdb.searchCollection(query),
          tmdb.searchMovie(query),
        ])
        const collections = collectionResults.results.slice(0, 3)
        const seenTmdbIds = new Set<string>()
        const collectionData = []

        for (const col of collections) {
          const details = await tmdb.getCollectionDetails(String(col.id))
          const tmdbIds = details.parts.map((p: any) => String(p.id))
          tmdbIds.forEach((id: any) => seenTmdbIds.add(id))
          const ownedByTmdbId = db.media.getItemsByTmdbIds(tmdbIds)

          const movies = details.parts
            .filter((p: any) => p.release_date && new Date(p.release_date) <= new Date())
            .map((p: any) => {
              const ownedItem = ownedByTmdbId.get(String(p.id))
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
            owned_count: movies.filter((m: any) => m.owned).length,
            missing_count: movies.filter((m: any) => !m.owned).length,
            movies,
          })
        }

        const standaloneMovies = movieResults.results
          .filter((m: any) => !seenTmdbIds.has(String(m.id)))
          .slice(0, 10)

        let standaloneData = null
        if (standaloneMovies.length > 0) {
          const tmdbIds = standaloneMovies.map((m: any) => String(m.id))
          const ownedByTmdbId = db.media.getItemsByTmdbIds(tmdbIds)

          const movies = standaloneMovies
            .filter((m: any) => m.release_date && new Date(m.release_date) <= new Date())
            .map((m: any) => {
              const ownedItem = ownedByTmdbId.get(String(m.id))
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
            owned_count: movies.filter((m: any) => m.owned).length,
            missing_count: movies.filter((m: any) => !m.owned).length,
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
        if (movies.length === 0) return JSON.stringify({ message: `No movies found matching "${query}"` })

        const tmdbIds = movies.map((m: any) => String(m.id))
        const ownedByTmdbId = db.media.getItemsByTmdbIds(tmdbIds)

        const results = movies.map((m: any) => {
          const ownedItem = ownedByTmdbId.get(String(m.id))
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
        if (shows.length === 0) return JSON.stringify({ message: `No TV shows found matching "${query}"` })

        const results = shows.map((s: any) => {
          const tvShows = db.tvShows.getSummaries({ searchQuery: s.name, limit: 1 })
          const match = tvShows.length > 0 ? tvShows[0] : null
          if (!match) {
            collectItem(collector, { title: s.name, year: parseInt(s.first_air_date?.substring(0, 4) || '0') || undefined, tmdb_id: String(s.id), media_type: 'tv' })
          }
          return {
            title: s.name,
            first_air_date: s.first_air_date,
            tmdb_id: s.id,
            overview: s.overview?.substring(0, 150) || null,
            owned_episodes: match ? match.total_episodes : 0,
            in_library: !!match,
          }
        })
        return JSON.stringify({ shows_found: results.length, results })
      }
      return JSON.stringify({ error: `Unknown search_type: ${searchType}` })
    }

    case 'discover_titles': {
      const mediaType = (toolString(input, 'media_type') || 'movie') as 'movie' | 'tv'
      const genre = toolString(input, 'genre', 100) || undefined
      const yearMin = toolNumber(input, 'year_min', 1900, 2100)
      const yearMax = toolNumber(input, 'year_max', 1900, 2100)
      const sortBy = toolString(input, 'sort_by') || undefined
      const minRating = toolNumber(input, 'min_rating', 0, 10)
      const limit = toolNumber(input, 'limit', 1, 30) || 20
      const tmdb = getTMDBService()

      let genreId: number | null = null
      if (genre) {
        genreId = await resolveGenreId(genre, mediaType)
        if (!genreId) return JSON.stringify({ error: `Unknown genre: "${genre}"` })
      }

      const tmdbSortBy = sortBy === 'rating' ? 'vote_average.desc' : 'popularity.desc'
      const minVoteCount = sortBy === 'rating' ? 200 : 50

      if (mediaType === 'movie') {
        const response = await tmdb.discoverMovies({ genreId: genreId || undefined, yearMin, yearMax, sortBy: tmdbSortBy, minRating, minVoteCount })
        const movies = response.results.slice(0, limit)
        const tmdbIds = movies.map((m: any) => String(m.id))
        const ownedByTmdbId = db.media.getItemsByTmdbIds(tmdbIds)

        const results = movies.map((m: any) => {
          const ownedItem = ownedByTmdbId.get(String(m.id))
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
        return JSON.stringify({ media_type: 'movie', total_found: response.total_results, results })
      } else {
        const response = await tmdb.discoverTV({ genreId: genreId || undefined, yearMin, yearMax, sortBy: tmdbSortBy, minRating, minVoteCount })
        const shows = response.results.slice(0, limit)
        const results = shows.map((s: any) => {
          const ownership = checkTVShowOwnership(db, String(s.id), s.name)
          if (!ownership.owned) {
            collectItem(collector, { title: s.name, year: parseInt(s.first_air_date?.substring(0, 4) || '0') || undefined, tmdb_id: String(s.id), media_type: 'tv' })
          }
          return compact({ title: s.name, tmdb_id: s.id, rating: s.vote_average, owned: ownership.owned, owned_episodes: ownership.owned ? ownership.episode_count : null })
        })
        return JSON.stringify({ media_type: 'tv', total_found: response.total_results, results })
      }
    }

    case 'get_similar_titles': {
      const title = toolString(input, 'title', 300)
      if (!title) return JSON.stringify({ error: 'title is required' })
      const year = toolNumber(input, 'year', 1900, 2100)
      const mediaType = (toolString(input, 'media_type') || 'movie') as 'movie' | 'tv'
      const limit = toolNumber(input, 'limit', 1, 30) || 20
      const tmdb = getTMDBService()

      if (mediaType === 'movie') {
        const searchResults = await tmdb.searchMovie(title, year)
        if (searchResults.results.length === 0) return JSON.stringify({ error: `Could not find movie "${title}"` })
        const sourceTmdbId = String(searchResults.results[0].id)
        const [similar, recommendations] = await Promise.all([tmdb.getSimilarMovies(sourceTmdbId), tmdb.getMovieRecommendations(sourceTmdbId)])
        const seen = new Set<number>()
        const combined = [...recommendations.results, ...similar.results].filter(m => {
          if (seen.has(m.id)) return false
          seen.add(m.id); return true
        }).slice(0, limit)

        const tmdbIds = combined.map((m: any) => String(m.id))
        const ownedByTmdbId = db.media.getItemsByTmdbIds(tmdbIds)
        const results = combined.map((m: any) => {
          const ownedItem = ownedByTmdbId.get(String(m.id))
          if (!ownedItem) {
            collectItem(collector, { title: m.title, year: parseInt(m.release_date?.substring(0, 4) || '0') || undefined, tmdb_id: String(m.id), media_type: 'movie' })
          }
          return compact({ title: m.title, year: m.release_date?.substring(0, 4) || null, tmdb_id: m.id, owned: !!ownedItem, quality: ownedItem ? `${ownedItem.quality_tier} ${ownedItem.tier_quality}` : null })
        })
        return JSON.stringify({ similar_to: searchResults.results[0].title, media_type: 'movie', results })
      } else {
        const searchResults = await tmdb.searchTVShow(title)
        if (searchResults.results.length === 0) return JSON.stringify({ error: `Could not find TV show "${title}"` })
        const sourceTmdbId = String(searchResults.results[0].id)
        const [similar, recommendations] = await Promise.all([tmdb.getSimilarTV(sourceTmdbId), tmdb.getTVRecommendations(sourceTmdbId)])
        const seen = new Set<number>()
        const combined = [...recommendations.results, ...similar.results].filter(s => {
          if (seen.has(s.id)) return false
          seen.add(s.id); return true
        }).slice(0, limit)

        const results = combined.map((s: any) => {
          const ownership = checkTVShowOwnership(db, String(s.id), s.name)
          if (!ownership.owned) {
            collectItem(collector, { title: s.name, year: parseInt(s.first_air_date?.substring(0, 4) || '0') || undefined, tmdb_id: String(s.id), media_type: 'tv' })
          }
          return compact({ title: s.name, tmdb_id: s.id, owned: ownership.owned, owned_episodes: ownership.owned ? ownership.episode_count : null })
        })
        return JSON.stringify({ similar_to: searchResults.results[0].name, media_type: 'tv', results })
      }
    }

    case 'check_ownership': {
      const titles = (Array.isArray(input.titles) ? input.titles : []).slice(0, 20).map((t: any) => ({
        title: String(t.title || '').slice(0, 300),
        year: typeof t.year === 'number' ? t.year : undefined,
        media_type: String(t.media_type || 'movie'),
      })).filter((t: any) => t.title)
      const tmdb = getTMDBService()
      const results = []

      for (const item of titles) {
        try {
          if (item.media_type === 'movie') {
            const searchResults = await tmdb.searchMovie(item.title, item.year)
            if (searchResults.results.length === 0) { results.push({ title: item.title, found: false }); continue }
            const movie = searchResults.results[0]
            const ownedItem = db.media.getItemsByTmdbIds([String(movie.id)]).get(String(movie.id))
            if (!ownedItem) { collectItem(collector, { title: movie.title, year: parseInt(movie.release_date?.substring(0, 4) || '0') || item.year, tmdb_id: String(movie.id), media_type: 'movie' }) }
            results.push(compact({ title: movie.title, tmdb_id: movie.id, found: true, owned: !!ownedItem, quality: ownedItem ? `${ownedItem.quality_tier} ${ownedItem.tier_quality}` : null }))
          } else {
            const searchResults = await tmdb.searchTVShow(item.title)
            if (searchResults.results.length === 0) { results.push({ title: item.title, found: false }); continue }
            const show = searchResults.results[0]
            const ownership = checkTVShowOwnership(db, String(show.id), show.name)
            if (!ownership.owned) { collectItem(collector, { title: show.name, year: parseInt(show.first_air_date?.substring(0, 4) || '0') || undefined, tmdb_id: String(show.id), media_type: 'tv' }) }
            results.push(compact({ title: show.name, tmdb_id: show.id, found: true, owned: ownership.owned, owned_episodes: ownership.owned ? ownership.episode_count : null }))
          }
        } catch { results.push({ title: item.title, error: 'lookup failed' }) }
      }
      return JSON.stringify({ checked: results.length, results })
    }

    case 'check_music_ownership': {
      const artists = (Array.isArray(input.artists) ? input.artists : []).slice(0, 20).map((a: any) => String(a.name || a || '').slice(0, 300)).filter(Boolean)
      const results = artists.map((name: string) => {
        const match = db.music.getMusicArtistByName(name, '') // Search all sources
        if (match) {
          const albums = db.music.getAlbumsByArtistName(match.name, 100)
          return compact({ artist: match.name, owned: true, album_count: albums.length, albums: albums.slice(0, 5).map(a => a.title) })
        }
        return { artist: name, owned: false }
      })
      return JSON.stringify({ checked: results.length, results })
    }

    case 'get_item_details': {
      const itemId = toolNumber(input, 'id', 1)
      const itemTitle = toolString(input, 'title', 300)
      let item = itemId ? db.media.getItem(itemId) : null
      if (!item && itemTitle) {
        const res = db.media.globalSearch(itemTitle, 1)
        item = res.movies.length > 0 ? db.media.getItem(res.movies[0].id!) : null
      }
      if (!item) return JSON.stringify({ error: 'Item not found' })

      const qualityScore = db.media.getQualityScoreByMediaId(item.id!)
      const versions = db.media.getItemVersions(item.id!)
      const fileSizeMB = item.file_size ? Math.round(item.file_size / 1024 / 1024) : null
      const durationMin = item.duration ? Math.round(item.duration / 60) : null

      return JSON.stringify(compact({
        title: item.title, year: item.year, type: item.type,
        resolution: item.resolution, video_codec: item.video_codec,
        audio_codec: item.audio_codec, file_size_mb: fileSizeMB, duration_min: durationMin,
        quality_tier: qualityScore?.quality_tier || item.quality_tier,
        tier_quality: qualityScore?.tier_quality || item.tier_quality,
        needs_upgrade: qualityScore?.needs_upgrade,
        version_count: versions.length
      }))
    }

    case 'add_to_wishlist': {
      const items = (Array.isArray(input.items) ? input.items : []).slice(0, 20).map((i: any) => ({
        title: String(i.title || '').slice(0, 300),
        media_type: String(i.media_type || 'movie'),
        year: typeof i.year === 'number' ? i.year : undefined,
        tmdb_id: typeof i.tmdb_id === 'number' ? String(i.tmdb_id) : undefined,
        artist_name: typeof i.artist_name === 'string' ? i.artist_name.slice(0, 300) : undefined,
        reason: i.reason || 'missing',
        priority: Math.max(1, Math.min(5, i.priority || 3)),
        notes: i.notes
      })).filter((i: any) => i.title)

      const wishlistItems = []
      for (const item of items) {
        const type = item.media_type === 'tv' ? 'season' : item.media_type === 'album' ? 'album' : item.media_type === 'track' ? 'track' : 'movie'
        wishlistItems.push({
          media_type: type, title: item.title, year: item.year, tmdb_id: item.tmdb_id,
          artist_name: item.artist_name, reason: item.reason, priority: item.priority,
          notes: item.notes, status: 'active'
        })
      }
      const added = db.wishlist.addMany(wishlistItems as any)
      return JSON.stringify({ added, total: wishlistItems.length })
    }

    case 'get_music_albums': {
      const limit = toolNumber(input, 'limit', 1, 50) || 20
      const artistName = toolString(input, 'artist_name')
      const albums = artistName ? db.music.getAlbumsByArtistName(artistName, limit) : db.music.getAlbums({ limit })
      const albumIds = albums.map(a => a.id!).filter(Boolean)
      const qualityMap = db.music.getQualityScoresByAlbumIds(albumIds)

      const simplified = albums.map(a => {
        const q = qualityMap.get(a.id!)
        return compact({ title: a.title, artist: a.artist_name, year: a.year, quality_tier: q?.quality_tier, needs_upgrade: q?.needs_upgrade })
      })
      return JSON.stringify({ count: simplified.length, albums: simplified })
    }

    case 'get_music_quality_distribution': {
      const stats = db.music.getStats()
      const distribution = db.stats.getMusicQualityDistribution()
      const scoredCount = Object.values(distribution).reduce((a, b) => a + b, 0)
      return JSON.stringify({ total_albums: stats.totalAlbums, distribution, unscored: Math.max(0, stats.totalAlbums - scoredCount) })
    }

    case 'get_artist_completeness': {
      const artistName = toolString(input, 'artist_name')
      const artists = artistName ? [db.music.getArtistCompleteness(artistName)].filter(Boolean) : db.music.getAllArtistCompleteness()
      const limited = (artists as any[]).slice(0, toolNumber(input, 'limit') || 20)
      const simplified = limited.map(a => compact({ artist: a.artist_name, completeness: a.completeness_percentage }))
      return JSON.stringify({ count: artists.length, artists: simplified })
    }

    case 'get_album_details': {
      const albumId = toolNumber(input, 'album_id')
      if (!albumId) return JSON.stringify({ error: 'album_id required' })
      const album = db.music.getAlbumById(albumId)
      if (!album) return JSON.stringify({ error: 'Album not found' })
      const tracks = db.music.getTracks({ albumId: album.id! })
      return JSON.stringify(compact({ title: album.title, artist: album.artist_name, year: album.year, track_count: tracks.length }))
    }

    default:
      return JSON.stringify({ error: `Unknown tool: ${name}` })
  }
}
