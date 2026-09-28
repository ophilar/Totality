import type { ITimelineRecipeProvider, TimelineDefinition, TimelineRecipeSummary } from './ITimelineRecipeProvider'

export class TimelineRecipeProviderFactory implements ITimelineRecipeProvider {
  constructor(private readonly providers: ITimelineRecipeProvider[]) {}

  async supports(input: string): Promise<boolean> {
    return (await Promise.all(this.providers.map(provider => provider.supports(input)))).some(Boolean)
  }

  async listAvailableRecipes(): Promise<TimelineRecipeSummary[]> {
    const recipeLists = await Promise.all(this.providers.map(provider => provider.listAvailableRecipes()))
    const liveSourceUrls = new Set(recipeLists.flat()
      .filter(recipe => recipe.sourceType === 'web' && recipe.sourceUrl)
      .map(recipe => recipe.sourceUrl))
    const recipes = new Map<string, TimelineRecipeSummary>()
    for (const recipe of recipeLists.flat().filter(recipe =>
      recipe.sourceType !== 'preset' || !recipe.sourceUrl || !liveSourceUrls.has(recipe.sourceUrl)
    )) {
      if (!recipes.has(recipe.id)) recipes.set(recipe.id, recipe)
    }
    return [...recipes.values()]
  }

  async fetchTimeline(idOrInput: string): Promise<TimelineDefinition> {
    const input = idOrInput.trim()
    for (const provider of this.providers) {
      if (await provider.supports(input)) return await provider.fetchTimeline(input)
    }
    throw new Error(`No timeline provider supports '${input}'.`)
  }
}
