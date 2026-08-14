import type { ITimelineRecipeProvider, TimelineDefinition, TimelineRecipeSummary } from './ITimelineRecipeProvider'
import { STAR_TREK_AIR_DATE, STAR_TREK_CHRONOLOGICAL } from './presets/starTrekPresets'
import { STAR_WARS_CANON, MCU_TIMELINE } from './presets/otherPresets'

export class RemoteRegistryRecipeProvider implements ITimelineRecipeProvider {
  private readonly presets: Map<string, TimelineDefinition> = new Map()
  private readonly remoteCache: Map<string, TimelineDefinition> = new Map()

  constructor(private readonly registryBaseUrl?: string) {
    this.presets.set(STAR_TREK_AIR_DATE.id, STAR_TREK_AIR_DATE)
    this.presets.set(STAR_TREK_CHRONOLOGICAL.id, STAR_TREK_CHRONOLOGICAL)
    this.presets.set(STAR_WARS_CANON.id, STAR_WARS_CANON)
    this.presets.set(MCU_TIMELINE.id, MCU_TIMELINE)
  }

  async listAvailableRecipes(): Promise<TimelineRecipeSummary[]> {
    const list: TimelineRecipeSummary[] = []
    
    for (const preset of this.presets.values()) {
      list.push({
        id: preset.id,
        name: preset.name,
        franchise: preset.franchise,
        description: preset.description,
        totalItems: preset.items.length,
        sourceType: 'preset',
      })
    }

    if (this.registryBaseUrl) {
      try {
        const response = await fetch(`${this.registryBaseUrl}/manifest.json`, { signal: AbortSignal.timeout(5000) })
        if (response.ok) {
          const remoteManifest: TimelineRecipeSummary[] = await response.json()
          for (const item of remoteManifest) {
            if (!this.presets.has(item.id)) {
              list.push({ ...item, sourceType: 'remote' })
            }
          }
        }
      } catch {
        // Upstream unreachable; local presets remain available
      }
    }

    return list
  }

  async fetchTimeline(id: string): Promise<TimelineDefinition> {
    if (this.presets.has(id)) {
      return this.presets.get(id)!
    }

    if (this.remoteCache.has(id)) {
      return this.remoteCache.get(id)!
    }

    if (!this.registryBaseUrl) {
      throw new Error(`Timeline recipe '${id}' not found and no remote registry URL configured.`)
    }

    const response = await fetch(`${this.registryBaseUrl}/recipes/${id}.json`, { signal: AbortSignal.timeout(10000) })
    if (!response.ok) {
      throw new Error(`Failed to fetch timeline '${id}' from remote registry (status ${response.status}).`)
    }

    const recipe: TimelineDefinition = await response.json()
    this.validateRecipe(recipe)
    this.remoteCache.set(id, recipe)
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
