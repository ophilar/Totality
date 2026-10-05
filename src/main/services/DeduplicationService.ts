import * as fs from 'fs/promises'
import { getDatabase } from '@main/database/BetterSQLiteService'
import { getLoggingService } from '@main/services/LoggingService'
import { MediaItemType, type MediaItem } from '@main/types/database'
import type { DuplicateResolutionOutcome, DuplicateResolutionError } from '@shared/duplicateResolution'

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
  async scanForDuplicates(sourceId?: string, signal?: AbortSignal, beginCommit?: () => void): Promise<number> {
    const db = getDatabase()
    const allMovies = await db.media.getItems({ type: MediaItemType.Movie, sourceId })
    signal?.throwIfAborted()
    const allEpisodes = await db.media.getItems({ type: MediaItemType.Episode, sourceId })
    signal?.throwIfAborted()

    let count = 0

    // Group movies by TMDB ID (or global key if cross-source scanning)
    const movieGroups = new Map<string, number[]>()
    for (const [index, movie] of allMovies.entries()) {
      if (index > 0 && index % 512 === 0) {
        await new Promise<void>(resolve => setImmediate(resolve))
        signal?.throwIfAborted()
      }
      if (movie.tmdb_id) {
        const key = sourceId ? `${movie.source_id}:${movie.tmdb_id}` : `global:${movie.tmdb_id}`
        if (!movieGroups.has(key)) movieGroups.set(key, [])
        movieGroups.get(key)!.push(movie.id!)
      }
    }

    // Group episodes by TMDB ID/series title + season + episode
    const episodeGroups = new Map<string, number[]>()
    for (const [index, ep] of allEpisodes.entries()) {
      if (index > 0 && index % 512 === 0) {
        await new Promise<void>(resolve => setImmediate(resolve))
        signal?.throwIfAborted()
      }
      if (ep.season_number != null && ep.episode_number != null) {
        const seriesKey = ep.series_tmdb_id
          ? `tmdb:${ep.series_tmdb_id}`
          : ep.series_title ? `title:${ep.series_title.trim().toLowerCase()}` : null
        if (seriesKey) {
          const prefix = sourceId ? ep.source_id : 'global'
          const key = `${prefix}:${seriesKey}:S${ep.season_number}E${ep.episode_number}`
          if (!episodeGroups.has(key)) episodeGroups.set(key, [])
          episodeGroups.get(key)!.push(ep.id!)
        }
      }
    }

    // Save detected duplicates
    await db.withBatch(async () => {
      const operations: (() => Promise<void>)[] = []

      for (const [key, ids] of movieGroups.entries()) {
        if (ids.length > 1) {
          const [sId, tmdbId] = key.split(':')
          operations.push(() =>
            db.duplicates.upsertDuplicate({
              source_id: sId,
              external_id: tmdbId,
              external_type: 'tmdb_movie',
              media_item_ids: JSON.stringify(ids),
              status: 'pending',
            })
          )
          count++
        }
      }

      for (const [key, ids] of episodeGroups.entries()) {
        if (ids.length > 1) {
          const parts = key.split(':')
          const sId = parts[0]
          operations.push(() =>
            db.duplicates.upsertDuplicate({
              source_id: sId,
              external_id: key.replace(`${sId}:`, ''),
              external_type: 'tmdb_series',
              media_item_ids: JSON.stringify(ids),
              status: 'pending',
            })
          )
          count++
        }
      }

      await db.duplicates.processInChunks(operations, 500, async (chunk: Array<() => Promise<unknown>>) => {
        signal?.throwIfAborted()
        await Promise.all(chunk.map((fn: () => Promise<unknown>) => fn()))
        return []
      })
      signal?.throwIfAborted()
      beginCommit?.()
    })

    await db.tvShows.mergeDuplicateShows(sourceId)

    getLoggingService().info(
      '[DeduplicationService]',
      `Duplicate scan complete. Found ${count} duplicate groups.`
    )
    return count
  }

  /**
   * Get the current retention policy from settings
   */
  async getRetentionPolicy(): Promise<RetentionPolicy> {
    const db = getDatabase()
    return {
      preferHighestResolution: (await db.config.getSetting('dup_policy_highest_res')) !== 'false',
      preferOriginalLanguage: (await db.config.getSetting('dup_policy_orig_lang')) !== 'false',
      subtitleLanguagesWhitelist: JSON.parse(
        (await db.config.getSetting('dup_policy_sub_whitelist')) || '[]'
      ),
      preserveCommentary: (await db.config.getSetting('dup_policy_commentary')) !== 'false',
      autoDelete: (await db.config.getSetting('dup_policy_auto_delete')) === 'true',
    }
  }

  /**
   * Recommend which file to keep based on policies
   */
  async recommendRetention(
    mediaItemIds: number[]
  ): Promise<{ keep: number; discard: number[]; reason: string }> {
    const db = getDatabase()
    const items = await db.media.getItemsByIds(mediaItemIds)

    if (items.length <= 1) return { keep: items[0]?.id || 0, discard: [], reason: 'Only one item' }

    const policy = await this.getRetentionPolicy()

    // Simple scoring system for recommendations
    const scores = items.map((item: MediaItem) => {
      let score = 0

      // 1. Resolution
      if (policy.preferHighestResolution && item.height) {
        score += item.height
      }

      // 2. Original Language
      if (policy.preferOriginalLanguage && item.original_language && item.audio_language) {
        if (item.original_language === item.audio_language) {
          score += 15
        }
      }

      // 3. Bitrate (as a tie breaker)
      if (item.video_bitrate != null) {
        score += item.video_bitrate / 1000
      }

      return { id: item.id!, score }
    })

    scores.sort((a, b) => b.score - a.score)

    const keepId = scores[0].id
    const discardIds = scores.slice(1).map((s) => s.id)
    return {
      keep: keepId!,
      discard: discardIds,
      reason: `Based on policy: Highest score (${scores[0].score.toFixed(1)})`,
    }
  }

  /**
   * Resolve a duplicate group
   */
  async resolveDuplicate(
    duplicateId: number,
    keepItemId: number,
    deleteOthers: boolean = false
  ): Promise<DuplicateResolutionOutcome> {
    const db = getDatabase()
    const duplicate = await db.duplicates.getById(duplicateId)
    if (!duplicate) throw new Error('Duplicate group not found')

    const allIds = JSON.parse(duplicate.media_item_ids) as number[]
    if (!allIds.includes(keepItemId)) throw new Error('Selected item does not belong to this duplicate group')
    const discardIds = allIds.filter((id) => id !== keepItemId)

    const policy = await this.getRetentionPolicy()
    if (deleteOthers && !policy.autoDelete) {
      return { status: 'policy-blocked', committedCount: 0, requestedCount: discardIds.length, errors: [] }
    }

    if (!deleteOthers) {
      await db.duplicates.resolveDuplicate(duplicateId, 'kept_canonical')
      return { status: 'kept', committedCount: 0, requestedCount: discardIds.length, errors: [] }
    }

    const items = await db.media.getItemsByIds(discardIds)
    if (items.length !== discardIds.length) {
      const foundIds = new Set(items.map(item => item.id))
      const errors: DuplicateResolutionError[] = discardIds
        .filter(id => !foundIds.has(id))
        .map(mediaItemId => ({ mediaItemId, message: 'Media record no longer exists in the library' }))
      return { status: 'failed', committedCount: 0, requestedCount: discardIds.length, errors }
    }

    const deletedIds: number[] = []
    const errors: DuplicateResolutionError[] = []
    for (const item of items) {
      try {
        if (item.file_path) {
          getLoggingService().info('[DeduplicationService]', `Deleting duplicate file: ${item.file_path}`)
          await fs.unlink(item.file_path)
        }
        deletedIds.push(item.id!)
      } catch (error) {
        errors.push({ mediaItemId: item.id!, message: error instanceof Error ? error.message : String(error) })
      }
    }

    if (deletedIds.length) {
      try {
        await db.media.deleteItems(deletedIds)
      } catch (error) {
        errors.push(...deletedIds.map(mediaItemId => ({
          mediaItemId,
          message: `File deletion completed, but its library record could not be removed: ${error instanceof Error ? error.message : String(error)}`,
        })))
      }
    }
    if (errors.length) {
      return {
        status: deletedIds.length ? 'partial' : 'failed',
        committedCount: deletedIds.length,
        requestedCount: discardIds.length,
        errors,
      }
    }

    await db.duplicates.resolveDuplicate(duplicateId, 'deleted')
    return { status: 'deleted', committedCount: deletedIds.length, requestedCount: discardIds.length, errors: [] }
  }
}

let deduplicationInstance: DeduplicationService | null = null
export function getDeduplicationService(): DeduplicationService {
  if (!deduplicationInstance) {
    deduplicationInstance = new DeduplicationService()
  }
  return deduplicationInstance
}
