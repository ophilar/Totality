import type { ITimelineRecipeProvider, TimelineDefinition, TimelineRecipeSummary } from './ITimelineRecipeProvider'
import type { TimelineFetchOptions } from './ITimelineRecipeProvider'
import { createHash } from 'node:crypto'
import { getTimelineCacheService } from './TimelineCacheService'
import { TimelineParserPluginProvider } from '@main/services/timelines/TimelineParserPluginProvider'
import { MetadataRegistryService } from '@main/services/metadata/MetadataRegistryService'
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
    const registry = MetadataRegistryService.getInstance()
    const matching = registry.getMatchingService()
    const providers = registry.getCompositeProvider().getProviders()
    const identities = new Map<string, Promise<{ identifiers: TimelineDefinition['items'][number]['identifiers']; type?: 'movie' | 'show'; issue?: string }>>()
    for (const item of timeline.items) {
      if (Object.keys(item.identifiers).length) continue
      const title = item.type === 'episode' ? item.seriesTitle! : item.seriesTitle || item.title.replace(/\s+seasons?\s+\d+.*$/i, '')
      const key = `${item.type === 'episode' ? 'show' : item.type}:${title}:${item.releaseYear ?? ''}`
      if (!identities.has(key)) identities.set(key, (async () => {
        try {
          const type = item.type === 'movie' ? 'movie' : 'tv'
          const searchResults = await matching.matchMediaItem({ title, type, year: item.releaseYear })
          const detailed = await Promise.all(searchResults.map(async candidate => {
            if (!candidate.externalIds?.tmdbId) return candidate
            const provider = providers.find(provider => provider.providerId === 'tmdb')!
            const details = await provider.getDetails(candidate.externalIds.tmdbId, candidate.type)
            if (!details) throw new Error(`Could not verify TMDB identity ${candidate.externalIds.tmdbId} for ${title}`)
            return { ...candidate, ...details, externalIds: { ...candidate.externalIds, ...details.externalIds } }
          }))
          const candidates: typeof searchResults = []
          for (const candidate of detailed) {
            if (item.releaseYear !== undefined && candidate.year !== item.releaseYear) continue
            if (![candidate.title, ...(candidate.alternateTitles ?? [])].some(alias => normalizeMediaTitle(alias) === normalizeMediaTitle(title))) continue
            const sameIdentity = candidates.find(existing => existing.type === candidate.type && Object.entries(candidate.externalIds ?? {}).some(([key, value]) => value && existing.externalIds?.[key as keyof typeof existing.externalIds] === value))
            if (sameIdentity) {
              if (Object.entries(candidate.externalIds ?? {}).some(([key, value]) => value && sameIdentity.externalIds?.[key as keyof typeof sameIdentity.externalIds] && sameIdentity.externalIds[key as keyof typeof sameIdentity.externalIds] !== value)) return { identifiers: {}, issue: `Contradictory online identifiers for ${title}` }
              sameIdentity.externalIds = { ...sameIdentity.externalIds, ...candidate.externalIds }
            }
            else candidates.push(candidate)
          }
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
