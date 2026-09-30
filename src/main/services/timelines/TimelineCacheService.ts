import { getDatabase } from '@main/database/BetterSQLiteService'
import type { TimelineDefinition, TimelineRecipeSummary } from './ITimelineRecipeProvider'
import { getLoggingService } from '@main/services/LoggingService'
import { isTimelineRecipeSummary, validateTimelineDefinition } from './TimelineValidation'

interface CacheEntry<T> {
  data: T
  timestamp: number
  expiresAt: number
}

export class TimelineCacheService {
  private static instance: TimelineCacheService | null = null

  // In-memory memoization cache (Tier 1)
  private readonly memoryCache: Map<string, CacheEntry<unknown>> = new Map()

  // Default TTL: 7 days for timeline recipes, 24 hours for manifests
  public static readonly RECIPE_TTL_MS = 7 * 24 * 60 * 60 * 1000
  public static readonly MANIFEST_TTL_MS = 24 * 60 * 60 * 1000

  public static getInstance(): TimelineCacheService {
    if (!TimelineCacheService.instance) {
      TimelineCacheService.instance = new TimelineCacheService()
    }
    return TimelineCacheService.instance
  }

  public static resetInstanceForTesting(): void {
    TimelineCacheService.instance = null
  }

  async getRecipe(id: string, includeExpired = false): Promise<TimelineDefinition | null> {
    const key = `timeline_recipe:${id}`

    // 1. Check in-memory memoization
    const mem = this.memoryCache.get(key)
    if (mem && !isCacheEntry(mem)) {
      this.memoryCache.delete(key)
      this.warnRejectedRecipe(id, 'cache envelope is malformed')
      return null
    }
    if (mem && (includeExpired || mem.expiresAt > Date.now())) {
      const validation = validateTimelineDefinition(mem.data)
      if (validation.valid) return validation.value
      this.memoryCache.delete(key)
      this.warnRejectedRecipe(id, validation.reason)
      return null
    }

    // 2. Check persistent SQLite cache
    try {
      const db = getDatabase()
      const raw = await db.config.getSetting(key)
      if (raw) {
        const parsed: unknown = JSON.parse(raw)
        if (!isCacheEntry(parsed)) {
          this.warnRejectedRecipe(id, 'cache envelope is malformed')
          return null
        }
        const entry = parsed
        // Check expiration
        if (entry && entry.data && (includeExpired || entry.expiresAt > Date.now())) {
          const validation = validateTimelineDefinition(entry.data)
          if (!validation.valid) {
            this.warnRejectedRecipe(id, validation.reason)
            return null
          }
          // Memoize in memory for ultra-fast subsequent reads
          this.memoryCache.set(key, entry)
          return validation.value
        }
      }
    } catch (err) {
      throw new Error(`Cannot read cached timeline '${id}': ${String(err)}`)
    }

    return null
  }

  async setRecipe(id: string, recipe: TimelineDefinition, ttlMs: number = TimelineCacheService.RECIPE_TTL_MS): Promise<void> {
    const validation = validateTimelineDefinition(recipe)
    if (!validation.valid) {
      throw new Error(`Cannot cache timeline recipe '${id}': ${validation.reason}`)
    }
    const key = `timeline_recipe:${id}`
    const now = Date.now()
    const entry: CacheEntry<TimelineDefinition> = {
      data: recipe,
      timestamp: now,
      expiresAt: now + ttlMs,
    }

    // Update memory
    this.memoryCache.set(key, entry)

    // Update SQLite permanent storage
    try {
      const db = getDatabase()
      await db.config.setSetting(key, JSON.stringify(entry))
    } catch (err) {
      this.memoryCache.delete(key)
      throw new Error(`Cannot persist timeline '${id}': ${String(err)}`)
    }
  }

  async getManifest(manifestKey = 'default'): Promise<TimelineRecipeSummary[] | null> {
    const key = `timeline_manifest:${manifestKey}`

    const mem = this.memoryCache.get(key)
    if (mem && mem.expiresAt > Date.now()) {
      return mem.data as TimelineRecipeSummary[]
    }

    try {
      const db = getDatabase()
      const raw = await db.config.getSetting(key)
      if (raw) {
        const parsed: unknown = JSON.parse(raw)
        if (!isCacheEntry(parsed)) return null
        const entry = parsed
        if (entry && Array.isArray(entry.data) && entry.data.every(isTimelineRecipeSummary) && entry.expiresAt > Date.now()) {
          this.memoryCache.set(key, entry)
          return entry.data
        }
      }
    } catch (err) {
      throw new Error(`Cannot read timeline catalog '${manifestKey}': ${String(err)}`)
    }

    return null
  }

  async setManifest(manifest: TimelineRecipeSummary[], manifestKey = 'default', ttlMs: number = TimelineCacheService.MANIFEST_TTL_MS): Promise<void> {
    if (!manifest.every(isTimelineRecipeSummary)) {
      throw new Error(`Cannot cache timeline manifest '${manifestKey}': payload does not match the supported schema`)
    }
    const key = `timeline_manifest:${manifestKey}`
    const now = Date.now()
    const entry: CacheEntry<TimelineRecipeSummary[]> = {
      data: manifest,
      timestamp: now,
      expiresAt: now + ttlMs,
    }

    this.memoryCache.set(key, entry)

    try {
      const db = getDatabase()
      await db.config.setSetting(key, JSON.stringify(entry))
    } catch (err) {
      this.memoryCache.delete(key)
      throw new Error(`Cannot persist timeline catalog '${manifestKey}': ${String(err)}`)
    }
  }

  async invalidate(id?: string): Promise<void> {
    if (id) {
      const key = `timeline_recipe:${id}`
      this.memoryCache.delete(key)
      try {
        const db = getDatabase()
        await db.config.deleteSetting(key)
      } catch (error) {
        throw new Error(`Cannot invalidate timeline cache: ${String(error)}`)
      }
    } else {
      this.memoryCache.clear()
      try {
        const db = getDatabase()
        const settings = { ...await db.config.getSettingsByPrefix('timeline_recipe:'), ...await db.config.getSettingsByPrefix('timeline_manifest:') }
        for (const k of Object.keys(settings)) {
          await db.config.deleteSetting(k)
        }
      } catch (error) {
        throw new Error(`Cannot invalidate timeline cache: ${String(error)}`)
      }
    }
  }

  private warnRejectedRecipe(id: string, reason: string): void {
    getLoggingService().warn('[TimelineCacheService]', `Rejected cached timeline recipe '${id}': ${reason}`)
  }
}

export function getTimelineCacheService(): TimelineCacheService {
  return TimelineCacheService.getInstance()
}

function isCacheEntry(value: unknown): value is CacheEntry<unknown> {
  return typeof value === 'object' && value !== null && 'data' in value &&
    'timestamp' in value && typeof value.timestamp === 'number' && Number.isFinite(value.timestamp) &&
    'expiresAt' in value && typeof value.expiresAt === 'number' && Number.isFinite(value.expiresAt)
}
