
import type { ITimelineRecipeProvider, TimelineDefinition, TimelineRecipeSummary, TimelineFetchOptions } from './ITimelineRecipeProvider'
import { getTimelineCacheService, TimelineCacheService } from './TimelineCacheService'
import { fetchWithTimeout } from '../utils/httpClient'
import { validateTimelineDefinition } from './TimelineValidation'

export class RemoteRegistryRecipeProvider implements ITimelineRecipeProvider {
  constructor(
    private readonly registryBaseUrl?: string,
    private readonly cacheService: TimelineCacheService = getTimelineCacheService()
  ) {}

  async listAvailableRecipes(): Promise<TimelineRecipeSummary[]> {
    if (!this.registryBaseUrl) return []
    const cachedManifest = await this.cacheService.getManifest(this.registryBaseUrl)
    if (cachedManifest) return cachedManifest
    const response = await fetchWithTimeout(`${this.registryBaseUrl}/manifest.json`, {}, 6000)
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

    const response = await fetchWithTimeout(`${this.registryBaseUrl}/recipes/${id}.json`, { signal: options.signal }, 10000)
    if (!response.ok) {
      throw new Error(`Failed to fetch timeline '${id}' from remote registry (${response.status}: ${response.statusText}).`)
    }

    const validation = validateTimelineDefinition(await response.json())
    if (!validation.valid) throw new Error(`Invalid timeline recipe: ${validation.reason}`)
    const recipe = validation.value
    await this.cacheService.setRecipe(id, recipe)
    return recipe
  }
}
