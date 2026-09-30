import type { ITimelineRecipeProvider, TimelineDefinition, TimelineRecipeSummary } from './ITimelineRecipeProvider'
import type { TimelineFetchOptions } from './ITimelineRecipeProvider'
import { createHash } from 'node:crypto'
import { getTimelineCacheService } from './TimelineCacheService'
import { TimelineParserPluginProvider } from './TimelineParserPluginProvider'
import { MetadataRegistryService } from '../metadata/MetadataRegistryService'
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
      if (!await provider.supports(input)) continue
      const cache = getTimelineCacheService()
      const previous = await cache.getRecipe(input, true)
      try {
        const timeline = await provider.fetchTimeline(input, options)
        if (provider instanceof TimelineParserPluginProvider) await this.resolveIdentities(timeline)
        const result: TimelineDefinition = {
          ...timeline,
          retrievedAt: options.refresh || !timeline.retrievedAt ? new Date().toISOString() : timeline.retrievedAt,
          contentFingerprint: createHash('sha256').update(JSON.stringify(timeline.items)).digest('hex'),
          refreshError: undefined,
          granularity: timeline.granularity ?? (timeline.items.some(item => item.type === 'show') ? 'series-blocks' : 'episode-interleaved'),
        }
        await cache.setRecipe(input, result)
        return result
      } catch (error) {
        if (!options.refresh || !previous) throw error
        return { ...previous, refreshError: error instanceof Error ? error.message : String(error) }
      }
    }
    throw new Error(`No timeline provider supports '${input}'.`)
  }

  private async resolveIdentities(timeline: TimelineDefinition): Promise<void> {
    const matching = MetadataRegistryService.getInstance().getMatchingService()
    const identities = new Map<string, Promise<{ identifiers: TimelineDefinition['items'][number]['identifiers']; type?: 'movie' | 'show'; issue?: string }>>()
    for (const item of timeline.items) {
      if (Object.keys(item.identifiers).length) continue
      const title = item.type === 'episode' ? item.seriesTitle! : item.seriesTitle || item.title.replace(/\s+seasons?\s+\d+.*$/i, '')
      const key = `${item.type === 'episode' ? 'show' : item.type}:${title}`
      if (!identities.has(key)) identities.set(key, (async () => {
        try {
          const types = item.type === 'episode' || item.type === 'show' ? ['tv'] as const : ['movie', 'tv'] as const
          const candidates = (await Promise.all(types.map(type => matching.matchMediaItem({ title, type })))).flat()
            .filter(candidate => normalizeMediaTitle(candidate.title) === normalizeMediaTitle(title))
          if (candidates.length !== 1) return { identifiers: {}, issue: candidates.length ? `Ambiguous online identity for ${title}` : `No unambiguous online identity for ${title}` }
          const candidate = candidates[0], ids = candidate.externalIds
          return { type: candidate.type === 'tv' ? 'show' as const : 'movie' as const, identifiers: { tmdbId: ids?.tmdbId ? Number(ids.tmdbId) : undefined, tvdbId: ids?.tvdbId ? Number(ids.tvdbId) : undefined, imdbId: ids?.imdbId } }
        } catch (error) { return { identifiers: {}, issue: `Identity lookup failed for ${title}: ${error instanceof Error ? error.message : String(error)}` } }
      })())
      const identity = await identities.get(key)!
      item.identifiers = identity.identifiers
      item.identityIssue = identity.issue
      if (item.type !== 'episode' && identity.type) {
        item.type = identity.type
        if (item.type === 'show') item.seriesTitle = title
      }
    }
  }
}
