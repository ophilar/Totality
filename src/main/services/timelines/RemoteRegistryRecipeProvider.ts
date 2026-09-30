import type { ITimelineRecipeProvider, TimelineDefinition, TimelineRecipeSummary, TimelineFetchOptions } from './ITimelineRecipeProvider'
import { getTimelineCacheService, TimelineCacheService } from './TimelineCacheService'

export class RemoteRegistryRecipeProvider implements ITimelineRecipeProvider {
  constructor(
    private readonly registryBaseUrl?: string,
    private readonly cacheService: TimelineCacheService = getTimelineCacheService()
  ) {}

  async listAvailableRecipes(): Promise<TimelineRecipeSummary[]> {
    if (!this.registryBaseUrl) return []
    const cachedManifest = await this.cacheService.getManifest(this.registryBaseUrl)
    if (cachedManifest) return cachedManifest
    const response = await fetch(`${this.registryBaseUrl}/manifest.json`, { signal: AbortSignal.timeout(6000) })
    if (!response.ok) throw new Error(`Cannot fetch timeline registry: ${response.status} ${response.statusText}`)
    const remoteManifest: TimelineRecipeSummary[] = await response.json()
    const list = remoteManifest.map(item => ({ ...item, sourceType: 'remote' as const }))
    await this.cacheService.setManifest(list, this.registryBaseUrl)
    return list
  }

  async supports(input: string): Promise<boolean> {
    return (await this.listAvailableRecipes()).some(recipe => recipe.id === input)
  }

  async fetchTimeline(id: string, options: TimelineFetchOptions = {}): Promise<TimelineDefinition> {
    if (!this.registryBaseUrl) throw new Error('No timeline registry is configured')
    const cached = await this.cacheService.getRecipe(id)
    if (cached && !options.refresh) return cached

    const response = await fetch(`${this.registryBaseUrl}/recipes/${id}.json`, { signal: AbortSignal.timeout(10000) })
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
