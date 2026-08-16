import type { ITimelineRecipeProvider, TimelineDefinition, TimelineRecipeSummary } from './ITimelineRecipeProvider'
import { getTimelineCacheService, TimelineCacheService } from './TimelineCacheService'
import { BUNDLED_MANIFEST, BUNDLED_RECIPES } from './bundledRecipes'
import type { WebGuideRecipeProvider } from './WebGuideRecipeProvider'

export class RemoteRegistryRecipeProvider implements ITimelineRecipeProvider {
  private readonly defaultRegistryUrl = 'https://raw.githubusercontent.com/totality-app/timelines-registry/main'

  constructor(
    private readonly registryBaseUrl?: string,
    private readonly cacheService: TimelineCacheService = getTimelineCacheService(),
    private readonly webGuideProvider?: WebGuideRecipeProvider
  ) {}

  private get effectiveBaseUrl(): string {
    return this.registryBaseUrl || this.defaultRegistryUrl
  }

  async listAvailableRecipes(): Promise<TimelineRecipeSummary[]> {
    // 1. Check persistent/memoized cache
    const cachedManifest = await this.cacheService.getManifest(this.effectiveBaseUrl)
    if (cachedManifest && cachedManifest.length > 0) {
      return cachedManifest
    }

    const isCustomUrl = !!this.registryBaseUrl && this.registryBaseUrl !== this.defaultRegistryUrl

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
    // 1. Check persistent/memoized cache
    const cached = await this.cacheService.getRecipe(id)
    if (cached) {
      return cached
    }

    const isCustomUrl = !!this.registryBaseUrl && this.registryBaseUrl !== this.defaultRegistryUrl

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

    // 2. Check presets with live web sync capability
    if (BUNDLED_RECIPES[id]) {
      const preset = BUNDLED_RECIPES[id]

      // If live web provider is available and preset has a live sourceUrl, attempt live sync
      if (preset.sourceUrl && this.webGuideProvider) {
        try {
          const liveRecipe = await this.webGuideProvider.fetchTimeline(preset.sourceUrl)
          if (liveRecipe && Array.isArray(liveRecipe.items) && liveRecipe.items.length > 0) {
            const enriched: TimelineDefinition = {
              ...preset,
              items: liveRecipe.items,
              version: (preset.version || 1) + 1,
            }
            this.validateRecipe(enriched)
            await this.cacheService.setRecipe(id, enriched)
            return enriched
          }
        } catch {
          // Fall back to baseline
        }
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
