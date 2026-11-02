import type { ITimelineRecipeProvider, TimelineDefinition, TimelineRecipeSummary, TimelineFetchOptions } from './ITimelineRecipeProvider'
import { getTimelineCacheService, TimelineCacheService } from './TimelineCacheService'
import { getGeminiService, GeminiService } from '@main/services/GeminiService'
import { validateTimelineDefinition } from './TimelineValidation'

export class WebGuideRecipeProvider implements ITimelineRecipeProvider {
  constructor(
    private readonly cacheService: TimelineCacheService = getTimelineCacheService(),
    private readonly _gemini?: GeminiService
  ) {}

  private get gemini(): GeminiService {
    return this._gemini || getGeminiService()
  }

  async listAvailableRecipes(): Promise<TimelineRecipeSummary[]> {
    return []
  }

  async supports(input: string): Promise<boolean> {
    return !/^https?:\/\//i.test(input) && !input.startsWith('tmdb-') && !input.startsWith('trakt-')
  }

  async fetchTimeline(input: string, options: TimelineFetchOptions = {}): Promise<TimelineDefinition> {
    const prompt = input.trim()
    if (/^https?:\/\//i.test(prompt)) {
      throw new Error('Online guide URLs require a saved parser definition. Add one in the timeline parser editor.')
    }
    const cached = await this.cacheService.getRecipe(prompt)
    if (cached && !options.refresh) return cached
    if (!this.gemini.isConfigured()) throw new Error('Configure Gemini in Settings to generate a timeline from a prompt.')

    const response = await this.gemini.sendMessage({
      messages: [{
        role: 'user',
        content: `Create the complete viewing order for this franchise: ${prompt}. Return JSON with franchise, name, description, and an ordered items array. Each item must be a movie or an episode with seriesTitle, seasonNumber, and episodeNumber. Include airDate and timelineEra when known.`,
      }],
      system: `You are a media cataloger. Return only valid JSON with this shape: {"franchise":"string","name":"string","description":"string","items":[{"order":1,"type":"movie|episode","title":"string","seriesTitle":"string","seasonNumber":1,"episodeNumber":1,"airDate":"YYYY-MM-DD","timelineEra":"string","identifiers":{"tmdbId":123,"imdbId":"tt...","tvdbId":123}}]}. Do not invent external identifiers.`,
    })
    const payload = JSON.parse(response.text.replace(/```(?:json)?/gi, '').trim()) as Record<string, unknown>
    const timeline = {
      ...payload,
      id: `ai-${prompt.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`,
      version: 1,
      items: payload.items,
    }
    const validation = validateTimelineDefinition(timeline)
    if (!validation.valid) throw new Error(`Generated timeline is invalid: ${validation.reason}.`)

    await this.cacheService.setRecipe(prompt, validation.value)
    await this.cacheService.setRecipe(validation.value.id, validation.value)
    return validation.value
  }
}
