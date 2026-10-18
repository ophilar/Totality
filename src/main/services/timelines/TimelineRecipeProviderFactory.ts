
import type { ITimelineRecipeProvider, TimelineDefinition, TimelineRecipeSummary } from './ITimelineRecipeProvider'
import type { TimelineFetchOptions } from './ITimelineRecipeProvider'
import { createHash } from 'node:crypto'
import { getTimelineCacheService } from './TimelineCacheService'
import { TimelineParserPluginProvider } from './TimelineParserPluginProvider'
import { normalizeMediaTitle } from './TimelineResolutionEngine'

export class TimelineRecipeProviderFactory implements ITimelineRecipeProvider {
  constructor(private readonly providers: ITimelineRecipeProvider[]) {}

  async supports(input: string): Promise<boolean> {
    return (await Promise.all(this.providers.map(provider => provider.supports(input)))).some(Boolean)
  }

  async listAvailableRecipes(): Promise<TimelineRecipeSummary[]> {
    const recipeLists = await Promise.all(this.providers.map(provider => provider.listAvailableRecipes()))
    const recipes = new Map<string, TimelineRecipeSummary>()
    for (const recipe of recipeLists.flat()) {
      if (!recipes.has(recipe.id)) recipes.set(recipe.id, recipe)
    }
    return [...recipes.values()].sort((a, b) => Number(b.sourceType === 'web') - Number(a.sourceType === 'web') || Number(b.granularity === 'episode-interleaved') - Number(a.granularity === 'episode-interleaved'))
  }

  async fetchTimeline(idOrInput: string, options: TimelineFetchOptions = {}): Promise<TimelineDefinition> {
    const input = idOrInput.trim()
    for (const provider of this.providers) {
      options.signal?.throwIfAborted()
      if (!await provider.supports(input)) continue
      const cache = getTimelineCacheService()
      const previous = await cache.getRecipe(input, true)
      try {
        const timeline = await provider.fetchTimeline(input, options)
        options.signal?.throwIfAborted()
        if (provider instanceof TimelineParserPluginProvider) {
          for (const item of timeline.items) {
            const title = item.type === 'episode' ? item.seriesTitle : item.seriesTitle || item.title
            if (!Object.keys(item.identifiers).length && (!title || !normalizeMediaTitle(title))) {
              item.identityIssue = `Guide entry '${item.title}' has no stable title to match.`
            }
          }
        }
        const result: TimelineDefinition = {
          ...timeline,
          retrievedAt: options.refresh || !timeline.retrievedAt ? new Date().toISOString() : timeline.retrievedAt,
          contentFingerprint: createHash('sha256').update(JSON.stringify(timeline.items)).digest('hex'),
          refreshError: undefined,
          granularity: timeline.granularity ?? (timeline.items.some(item => item.type === 'show') ? 'series-blocks' : 'episode-interleaved'),
        }
        options.signal?.throwIfAborted()
        await cache.setRecipe(input, result)
        return result
      } catch (error) {
        if (options.signal?.aborted) throw error
        if (!options.refresh || !previous) throw error
        return { ...previous, refreshError: error instanceof Error ? error.message : String(error) }
      }
    }
    throw new Error(`No timeline provider supports '${input}'.`)
  }

}
