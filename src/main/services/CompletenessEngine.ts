
/**
 * CompletenessEngine - Generic logic for set completeness analysis.
 * Shared by TV series and Movie collections.
 */

import { MissingMovie, MissingEpisode } from '../types/database'

export interface SetItem {
  key: string // e.g. "S1E1" or TMDB ID
  title: string
  year?: number
  poster_path?: string
  air_date?: string
}

export interface CompletenessResult<TMissing> {
  total: number
  owned: number
  missing: TMissing[]
  percentage: number
}

/**
 * Core engine for calculating completeness between a target set and an owned set.
 */
export class CompletenessEngine {
  /**
   * Calculate completeness for a simple set of items (e.g. Movies in a Collection).
   */
  static calculateSimple<T extends { tmdb_id: string; title: string; year?: number; poster_path?: string }>(
    targetSet: T[],
    ownedIds: Set<string>
  ): CompletenessResult<MissingMovie> {
    const missing: MissingMovie[] = targetSet
      .filter(item => !ownedIds.has(item.tmdb_id))
      .map(item => ({
        tmdb_id: item.tmdb_id,
        title: item.title,
        year: item.year,
        poster_path: item.poster_path
      }))

    const total = targetSet.length
    const owned = targetSet.length - missing.length
    const percentage = total > 0 ? Math.round((owned / total) * 100) : 100

    return { total, owned, missing, percentage }
  }

  /**
   * Calculate completeness for an episodic set (e.g. TV Series).
   */
  static calculateEpisodic(
    targetEpisodes: Array<{ season_number: number; episode_number: number; air_date?: string }>,
    ownedKeys: Set<string>, // e.g. "S1E1"
    cutoffDate = new Date()
  ): CompletenessResult<MissingEpisode> {
    const missing: MissingEpisode[] = targetEpisodes.filter(ep => {
      const key = `S${ep.season_number}E${ep.episode_number}`
      if (ownedKeys.has(key)) return false
      
      // Only count as missing if it has aired
      if (ep.air_date) {
        const airDate = new Date(ep.air_date)
        return airDate <= cutoffDate
      }
      return true
    }).map(ep => ({
      season_number: ep.season_number,
      episode_number: ep.episode_number,
      air_date: ep.air_date
    }))

    const total = targetEpisodes.length
    const owned = targetEpisodes.length - missing.length
    const percentage = total > 0 ? Math.round((owned / total) * 100) : 100

    return { total, owned, missing, percentage }
  }
}
