import type { ITimelineRecipeProvider, TimelineDefinition, TimelineRecipeSummary } from './ITimelineRecipeProvider'
import { getTimelineCacheService, TimelineCacheService } from './TimelineCacheService'
import { BUNDLED_MANIFEST, BUNDLED_RECIPES } from './bundledRecipes'

export class RemoteRegistryRecipeProvider implements ITimelineRecipeProvider {
  private readonly defaultRegistryUrl = 'https://raw.githubusercontent.com/totality-app/timelines-registry/main'

  constructor(
    private readonly registryBaseUrl?: string,
    private readonly cacheService: TimelineCacheService = getTimelineCacheService()
  ) {}

  private get effectiveBaseUrl(): string {
    return this.registryBaseUrl || this.defaultRegistryUrl
  }

  async listAvailableRecipes(): Promise<TimelineRecipeSummary[]> {
    const isCustomUrl = !!this.registryBaseUrl && this.registryBaseUrl !== this.defaultRegistryUrl

    // 1. Check persistent/memoized cache
    const cachedManifest = await this.cacheService.getManifest(this.effectiveBaseUrl)
    if (cachedManifest && cachedManifest.length > 0) {
      if (!isCustomUrl) {
        // Ensure bundled presets reflect the latest manifest metadata and item counts
        const merged = cachedManifest.map((item) => {
          const bundled = BUNDLED_MANIFEST.find((b) => b.id === item.id)
          return bundled ? { ...item, ...bundled } : item
        })
        for (const b of BUNDLED_MANIFEST) {
          if (!merged.some((m) => m.id === b.id)) {
            merged.push(b)
          }
        }
        return merged
      }
      return cachedManifest
    }

    if (isCustomUrl) {
      try {
        const response = await fetch(`${this.effectiveBaseUrl}/manifest.json`, { signal: AbortSignal.timeout(6000) })
        if (response.ok) {
          const remoteManifest: TimelineRecipeSummary[] = await response.json()
          const list = remoteManifest.map((item) => ({ ...item, sourceType: 'remote' as const }))
          await this.cacheService.setManifest(list, this.effectiveBaseUrl)
          return list
        }
      } catch {
        // Remote registry unreachable or offline
      }
      return []
    }

    const list: TimelineRecipeSummary[] = [...BUNDLED_MANIFEST]
    const seenIds = new Set(list.map((r) => r.id))

    try {
      const response = await fetch(`${this.effectiveBaseUrl}/manifest.json`, { signal: AbortSignal.timeout(6000) })
      if (response.ok) {
        const remoteManifest: TimelineRecipeSummary[] = await response.json()
        for (const item of remoteManifest) {
          if (!seenIds.has(item.id)) {
            list.push({ ...item, sourceType: 'remote' })
            seenIds.add(item.id)
          }
        }
        await this.cacheService.setManifest(list, this.effectiveBaseUrl)
      }
    } catch {
      // Remote registry unreachable or offline — use bundled
    }

    return list
  }

  async fetchTimeline(id: string): Promise<TimelineDefinition> {
    const isCustomUrl = !!this.registryBaseUrl && this.registryBaseUrl !== this.defaultRegistryUrl

    // 1. Check persistent/memoized cache
    const cached = await this.cacheService.getRecipe(id)
    if (cached) {
      const preset = BUNDLED_RECIPES[id]
      if (preset && (preset.version || 1) > (cached.version || 1)) {
        // Bundled preset is newer than stale cache — fall through to update cache with preset
      } else {
        return cached
      }
    }

    if (isCustomUrl) {
      const response = await fetch(`${this.effectiveBaseUrl}/recipes/${id}.json`, { signal: AbortSignal.timeout(10000) })
      if (!response.ok) {
        throw new Error(`Failed to fetch timeline '${id}' from remote registry (${response.status}: ${response.statusText}).`)
      }

      const recipe: TimelineDefinition = await response.json()
      this.validateRecipe(recipe)
      await this.cacheService.setRecipe(id, recipe)
      return recipe
    }

    // 2. Check presets with optional remote registry version verification
    if (BUNDLED_RECIPES[id]) {
      const preset = BUNDLED_RECIPES[id]

      try {
        const response = await fetch(`${this.effectiveBaseUrl}/recipes/${id}.json`, { signal: AbortSignal.timeout(4000) })
        if (response.ok) {
          const remoteRecipe: TimelineDefinition = await response.json()
          this.validateRecipe(remoteRecipe)
          if ((remoteRecipe.version || 1) > (preset.version || 1)) {
            await this.cacheService.setRecipe(id, remoteRecipe)
            return remoteRecipe
          }
        }
      } catch {
        // Offline or remote registry unavailable — use bundled preset
      }

      this.validateRecipe(preset)
      await this.cacheService.setRecipe(id, preset)
      return preset
    }

    // 3. Fall back to remote registry fetch
    const response = await fetch(`${this.effectiveBaseUrl}/recipes/${id}.json`, { signal: AbortSignal.timeout(10000) })
    if (!response.ok) {
      throw new Error(`Failed to fetch timeline '${id}' from remote registry (${response.status}: ${response.statusText}).`)
    }

    const recipe: TimelineDefinition = await response.json()
    this.validateRecipe(recipe)
    await this.cacheService.setRecipe(id, recipe)
    return recipe
  }

  private validateRecipe(recipe: TimelineDefinition): void {
    if (!recipe.id || !recipe.name || !Array.isArray(recipe.items)) {
      throw new Error(`Invalid timeline recipe structure: missing id, name, or items array.`)
    }
    for (const item of recipe.items) {
      if (!item.identifiers || (!item.identifiers.tmdbId && !item.identifiers.tvdbId && !item.identifiers.imdbId)) {
        throw new Error(`Invalid timeline item '${item.title}' at order ${item.order}: must contain at least one valid external identifier (tmdbId, tvdbId, or imdbId).`)
      }
    }
  }
}
