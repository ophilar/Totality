import * as fs from 'fs'
import { getDatabase } from '../database/getDatabase'
import { getLoggingService } from './LoggingService'

export interface RetentionPolicy {
  preferHighestResolution: boolean
  preferOriginalLanguage: boolean
  subtitleLanguagesWhitelist: string[]
  preserveCommentary: boolean
  autoDelete: boolean
}

/**
 * DeduplicationService
 *
 * Identifies and manages duplicate media items within the same provider.
 * Implements configurable retention policies for resolving duplicates.
 */
export class DeduplicationService {
  
  /**
   * Scan for duplicates in a specific source or across all sources
   */
  async scanForDuplicates(sourceId?: string): Promise<number> {
    const db = getDatabase()
    const allMovies = db.media.getItems({ type: 'movie', sourceId })
    const allEpisodes = db.media.getItems({ type: 'episode', sourceId })
    
    let count = 0
    
    // Group movies by TMDB ID within the same source
    const movieGroups = new Map<string, number[]>()
    for (const movie of allMovies) {
      if (movie.tmdb_id) {
        const key = `${movie.source_id}:${movie.tmdb_id}`
        if (!movieGroups.has(key)) movieGroups.set(key, [])
        movieGroups.get(key)!.push(movie.id!)
      }
    }
    
    // Group episodes by series TMDB ID, season, and episode within the same source
    const episodeGroups = new Map<string, number[]>()
    for (const ep of allEpisodes) {
      if (ep.series_tmdb_id && ep.season_number != null && ep.episode_number != null) {
        const key = `${ep.source_id}:${ep.series_tmdb_id}:S${ep.season_number}E${ep.episode_number}`
        if (!episodeGroups.has(key)) episodeGroups.set(key, [])
        episodeGroups.get(key)!.push(ep.id!)
      }
    }
    
    // Save detected duplicates
    db.beginBatch()
    try {
      for (const [key, ids] of movieGroups.entries()) {
        if (ids.length > 1) {
          const [sId, tmdbId] = key.split(':')
          db.duplicates.upsertDuplicate({
            source_id: sId,
            external_id: tmdbId,
            external_type: 'tmdb_movie',
            media_item_ids: JSON.stringify(ids),
            status: 'pending'
          })
          count++
        }
      }

      for (const [key, ids] of episodeGroups.entries()) {
        if (ids.length > 1) {
          const parts = key.split(':')
          const sId = parts[0]
          // Use a more specific external_id for episodes if needed, but for now series_tmdb_id is used in key
          db.duplicates.upsertDuplicate({
            source_id: sId,
            external_id: key.replace(`${sId}:`, ''), // Use the unique episode key
            external_type: 'tmdb_series',
            media_item_ids: JSON.stringify(ids),
            status: 'pending'
          })
          count++
        }
      }
    } finally {
      db.endBatch()
    }
    
    getLoggingService().info('[DeduplicationService]', `Duplicate scan complete. Found ${count} duplicate groups.`)
    return count
  }

  /**
   * Get the current retention policy from settings
   */
  getRetentionPolicy(): RetentionPolicy {
    const db = getDatabase()
    return {
      preferHighestResolution: db.config.getSetting('dup_policy_highest_res') !== 'false',
      preferOriginalLanguage: db.config.getSetting('dup_policy_orig_lang') !== 'false',
      subtitleLanguagesWhitelist: JSON.parse(db.config.getSetting('dup_policy_sub_whitelist') || '[]'),
      preserveCommentary: db.config.getSetting('dup_policy_commentary') !== 'false',
      autoDelete: db.config.getSetting('dup_policy_auto_delete') === 'true'
    }
  }

  /**
   * Recommend which file to keep based on policies
   */
  recommendRetention(mediaItemIds: number[]): { keep: number; discard: number[]; reason: string } {
    const db = getDatabase()
    const items = db.media.getItemsByIds(mediaItemIds)
    
    if (items.length <= 1) return { keep: items[0]?.id || 0, discard: [], reason: 'Only one item' }

    const policy = this.getRetentionPolicy()
    
    // Simple scoring system for recommendations
    const scores = items.map(item => {
      let score = 0
      
      // 1. Resolution
      if (policy.preferHighestResolution && item.resolution) {
        const resMap: Record<string, number> = { '4K': 4, '1080p': 3, '720p': 2, 'SD': 1 }
        score += (resMap[item.resolution] || 0) * 10
      }
      
      // 2. Original Language
      if (policy.preferOriginalLanguage && item.original_language && item.audio_language) {
        if (item.original_language === item.audio_language) {
          score += 15
        }
      }
      
      // 3. Bitrate (as a tie breaker)
      if (item.video_bitrate != null) {
        score += (item.video_bitrate / 1000)
      }
      
      return { id: item.id!, score }
    })

    scores.sort((a, b) => b.score - a.score)
    
    const keepId = scores[0].id
    const discardIds = scores.slice(1).map(s => s.id)
    
    return {
      keep: keepId!,
      discard: discardIds,
      reason: `Based on policy: Highest score (${scores[0].score.toFixed(1)})`
    }
  }

  /**
   * Resolve a duplicate group
   */
  async resolveDuplicate(duplicateId: number, keepItemId: number, deleteOthers: boolean = false): Promise<boolean> {
    const db = getDatabase()
    const duplicate = db.duplicates.getById(duplicateId)
    if (!duplicate) throw new Error('Duplicate group not found')
    
    const allIds = JSON.parse(duplicate.media_item_ids) as number[]
    const discardIds = allIds.filter(id => id !== keepItemId)
    
    const policy = this.getRetentionPolicy()
    const actualDelete = deleteOthers && (policy.autoDelete || true) // If manual resolve, we respect the deleteOthers flag

    if (actualDelete) {
      const items = db.media.getItemsByIds(discardIds)
      for (const item of items) {
        if (item.file_path) {
          try {
            if (fs.existsSync(item.file_path)) {
              getLoggingService().info('[DeduplicationService]', `Deleting duplicate file: ${item.file_path}`)
              fs.unlinkSync(item.file_path)
            }
            // Only delete from DB if file unlinked successfully (or didn't exist)
            db.media.deleteItem(item.id!)
          } catch (err) {
            getLoggingService().error('[DeduplicationService]', `Failed to delete file ${item.file_path}:`, err)
          }
        } else {
          // No path, just delete record
          db.media.deleteItem(item.id!)
        }
      }
    } else {
      // Just mark them as resolved but don't delete files
    }
    
    db.duplicates.resolveDuplicate(duplicateId, actualDelete ? 'deleted' : 'kept_canonical')
    return true
  }
}

let deduplicationInstance: DeduplicationService | null = null
export function getDeduplicationService(): DeduplicationService {
  if (!deduplicationInstance) {
    deduplicationInstance = new DeduplicationService()
  }
  return deduplicationInstance
}
