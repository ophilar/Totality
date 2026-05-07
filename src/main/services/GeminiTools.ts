import type { GeminiToolDefinition } from '@main/services/GeminiService'
import { getDatabase } from '@main/database/BetterSQLiteService'
import { getQualityAnalyzer } from '@main/services/QualityAnalyzer'
import { MediaItemType, WishlistStatus } from '@main/types/database'

/** Actionable item from tool results — not-owned titles the user can add to wishlist */
export interface ActionableItem {
  title: string
  year?: number
  tmdb_id?: string
  media_type: 'movie' | 'tv'
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
    description: 'Get movies or TV episodes from the library with optional filters.',
    parameters: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['movie', 'episode'] },
        quality_tier: { type: 'string', enum: ['SD', '720p', '1080p', '4K'] },
        tier_quality: { type: 'string', enum: ['LOW', 'MEDIUM', 'HIGH'] },
        needs_upgrade: { type: 'boolean' },
        search_query: { type: 'string' },
        limit: { type: 'number' },
      },
    },
  },
]

/** Sanitize and validate a string tool input */
function toolString(input: any, key: string, maxLen = 500): string {
  const val = input[key]
  return (typeof val === 'string') ? val.slice(0, maxLen).trim() : ''
}

/** Sanitize and validate a numeric tool input */
function toolNumber(input: any, key: string, min = 0, max = 10000): number | undefined {
  const val = input[key]
  if (val === undefined || val === null) return undefined
  const num = typeof val === 'number' ? val : Number(val)
  return isNaN(num) ? undefined : Math.max(min, Math.min(max, Math.floor(num)))
}

/** Sanitize and validate a boolean tool input */
function toolBoolean(input: any, key: string): boolean | undefined {
  const val = input[key]
  return (typeof val === 'boolean') ? val : undefined
}

/**
 * Execute a tool by name with the given input.
 */
export async function executeTool(name: string, input: any): Promise<string> {
  const db = getDatabase()

  switch (name) {
    case 'search_library': {
      const query = toolString(input, 'query', 200)
      if (!query) return JSON.stringify({ error: 'query is required' })
      return JSON.stringify(await db.media.globalSearch(query, 10))
    }

    case 'get_media_items': {
      const limit = toolNumber(input, 'limit', 1, 50) || 20
      const items = await db.media.getItems({
        type: toolString(input, 'type') as MediaItemType || undefined,
        qualityTier: toolString(input, 'quality_tier') || undefined,
        tierQuality: toolString(input, 'tier_quality') || undefined,
        needsUpgrade: toolBoolean(input, 'needs_upgrade'),
        searchQuery: toolString(input, 'search_query', 200) || undefined,
        limit,
      })
      return JSON.stringify(items.map((i: any) => compact({ id: i.id, title: i.title, year: i.year, resolution: i.resolution })))
    }

    case 'get_tv_shows': {
      const shows = await db.tvShows.getTVShowSummaries(toolString(input, 'search_query'))
      return JSON.stringify(shows.map((s: any) => compact({ title: s.series_title, episodes: s.total_episodes, owned: s.owned_episodes })))
    }

    case 'get_library_stats': {
      return JSON.stringify(await db.stats.getLibraryStats(toolString(input, 'source_id') || undefined))
    }

    case 'get_quality_distribution': {
      return JSON.stringify(await getQualityAnalyzer().getQualityDistribution())
    }

    case 'get_music_stats': {
      return JSON.stringify(await db.music.getStats())
    }

    case 'get_source_list': {
      return JSON.stringify(await db.stats.getAggregatedSourceStats())
    }

    case 'add_to_wishlist': {
      const items = (Array.isArray(input.items) ? input.items : []).map((i: any) => ({
        title: String(i.title || ''),
        media_type: String(i.media_type || 'movie'),
        status: WishlistStatus.Active
      }))
      return JSON.stringify({ added: await db.wishlist.addMany(items as any) })
    }

    default:
      return JSON.stringify({ error: `Unknown tool: ${name}` })
  }
}
