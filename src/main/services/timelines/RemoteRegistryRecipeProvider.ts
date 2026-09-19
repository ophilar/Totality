import type { ITimelineRecipeProvider, TimelineDefinition, TimelineRecipeSummary } from './ITimelineRecipeProvider'
import { getTimelineCacheService, TimelineCacheService } from './TimelineCacheService'

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
    const isCustomUrl = !!this.registryBaseUrl

    // 1. Check persistent/memoized cache
    const cachedManifest = await this.cacheService.getManifest(this.effectiveBaseUrl)
    if (cachedManifest && cachedManifest.length > 0) {
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

    try {
      const response = await fetch(`${this.effectiveBaseUrl}/manifest.json`, { signal: AbortSignal.timeout(6000) })
      if (response.ok) {
        const remoteManifest: TimelineRecipeSummary[] = await response.json()
        const list = remoteManifest.map(item => ({ ...item, sourceType: 'remote' as const }))
        await this.cacheService.setManifest(list, this.effectiveBaseUrl)
        return list
      }
    } catch { /* The caller receives an empty remote catalog. */ }
    return []
  }

  async fetchTimeline(id: string): Promise<TimelineDefinition> {
    const isCustomUrl = !!this.registryBaseUrl

    // 1. Check persistent/memoized cache
    const cached = await this.cacheService.getRecipe(id)
    if (cached) {
      return cached
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
