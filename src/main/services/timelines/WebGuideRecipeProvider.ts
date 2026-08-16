import type { ITimelineRecipeProvider, TimelineDefinition, TimelineItem, TimelineRecipeSummary } from './ITimelineRecipeProvider'
import { getTimelineCacheService, TimelineCacheService } from './TimelineCacheService'
import { getGeminiService, GeminiService } from '@main/services/GeminiService'
import { getTMDBService, TMDBService } from '@main/services/TMDBService'
import { getLoggingService } from '@main/services/LoggingService'

export class WebGuideRecipeProvider implements ITimelineRecipeProvider {
  constructor(
    private readonly cacheService: TimelineCacheService = getTimelineCacheService(),
    private _gemini?: GeminiService,
    private _tmdb?: TMDBService
  ) {}

  private get gemini(): GeminiService {
    return this._gemini || getGeminiService()
  }

  private get tmdb(): TMDBService {
    return this._tmdb || getTMDBService()
  }

  async listAvailableRecipes(): Promise<TimelineRecipeSummary[]> {
    return []
  }

  async fetchTimeline(urlOrPrompt: string): Promise<TimelineDefinition> {
    const cached = await this.cacheService.getRecipe(urlOrPrompt)
    if (cached) {
      return cached
    }

    const isUrl = /^https?:\/\//i.test(urlOrPrompt.trim())
    let timeline: TimelineDefinition

    if (isUrl) {
      timeline = await this.fetchAndParseUrl(urlOrPrompt.trim())
    } else {
      timeline = await this.generateFromPrompt(urlOrPrompt.trim())
    }

    this.validateRecipe(timeline)
    await this.cacheService.setRecipe(timeline.id, timeline)
    if (urlOrPrompt !== timeline.id) {
      await this.cacheService.setRecipe(urlOrPrompt, timeline)
    }

    return timeline
  }

  private async fetchAndParseUrl(url: string): Promise<TimelineDefinition> {
    getLoggingService().info('[WebGuideRecipeProvider]', `Fetching web viewing guide from ${url}`)

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Totality/1.0',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
      signal: AbortSignal.timeout(15000),
    })

    if (!response.ok) {
      throw new Error(`Failed to fetch web viewing guide from ${url} (${response.status}: ${response.statusText})`)
    }

    const html = await response.text()
    const cleanedText = this.cleanHtml(html)
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i)
    const pageTitle = titleMatch ? titleMatch[1].replace(/\s*[-–|].*$/, '').trim() : 'Web Viewing Guide'

    // 1. If Gemini AI is configured, use AI extraction
    if (this.gemini.isConfigured()) {
      try {
        const aiTimeline = await this.extractWithGemini(cleanedText, url, pageTitle)
        if (aiTimeline && aiTimeline.items.length > 0) {
          return aiTimeline
        }
      } catch (aiErr) {
        getLoggingService().warn('[WebGuideRecipeProvider]', `Gemini extraction failed, falling back to heuristic parsing: ${String(aiErr)}`)
      }
    }

    // 2. Heuristic DOM/regex extraction fallback
    return await this.extractWithHeuristics(html, cleanedText, url, pageTitle)
  }

  private async generateFromPrompt(prompt: string): Promise<TimelineDefinition> {
    if (this.gemini.isConfigured()) {
      getLoggingService().info('[WebGuideRecipeProvider]', `Generating timeline with Gemini for: "${prompt}"`)
      const aiTimeline = await this.extractWithGemini('', `ai:${prompt}`, prompt)
      if (aiTimeline && aiTimeline.items.length > 0) {
        return aiTimeline
      }
    }

    // If Gemini is not configured, search TMDB for movie collection
    getLoggingService().info('[WebGuideRecipeProvider]', `Searching TMDB collection for query: "${prompt}"`)
    const searchRes = await this.tmdb.searchCollection(prompt)
    if (searchRes.results && searchRes.results.length > 0) {
      const col = await this.tmdb.getCollectionDetails(String(searchRes.results[0].id))
      if (col && col.parts && col.parts.length > 0) {
        const sorted = [...col.parts].sort((a, b) => (a.release_date || '').localeCompare(b.release_date || ''))
        const items: TimelineItem[] = sorted.map((p, idx) => ({
          order: idx + 1,
          type: 'movie',
          title: p.title,
          airDate: p.release_date || undefined,
          timelineEra: p.release_date ? p.release_date.slice(0, 4) : undefined,
          identifiers: { tmdbId: p.id },
        }))

        return {
          id: `web-tmdb-${col.id}`,
          franchise: col.name,
          name: col.name,
          description: col.overview || `Curated order for ${col.name}`,
          sourceUrl: `https://www.themoviedb.org/collection/${col.id}`,
          version: 1,
          items,
        }
      }
    }

    throw new Error(`Unable to generate timeline for '${prompt}'. Ensure Gemini AI is configured in Settings or provide a direct guide URL / TMDB collection.`)
  }

  private cleanHtml(html: string): string {
    return html
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
      .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
      .replace(/<nav\b[^<]*(?:(?!<\/nav>)<[^<]*)*<\/nav>/gi, '')
      .replace(/<footer\b[^<]*(?:(?!<\/footer>)<[^<]*)*<\/footer>/gi, '')
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'")
      .replace(/\s+/g, ' ')
      .trim()
  }

  private async extractWithGemini(content: string, sourceUrl: string, titleHint: string): Promise<TimelineDefinition> {
    const promptText = content
      ? `Extract the complete media viewing timeline / franchise order from the following web guide text into a clean JSON structure.\n\nGuide Content:\n"""\n${content.slice(0, 15000)}\n"""`
      : `Generate the complete, canonical viewing order (chronological or release order) for the franchise: "${titleHint}". Include all relevant movies, TV series, and major episodes.`

    const systemPrompt = `You are an expert media cataloger for Totality. Output ONLY valid JSON matching this exact structure without markdown backticks:
{
  "franchise": "Franchise Name",
  "name": "Timeline Name",
  "description": "Brief description of the viewing order",
  "items": [
    {
      "order": 1,
      "type": "movie" | "show" | "episode",
      "title": "Title of movie or series",
      "seriesTitle": "Series Title (if episode or show)",
      "seasonNumber": 1 (optional),
      "episodeNumber": 1 (optional),
      "airDate": "YYYY-MM-DD" or "YYYY" (optional),
      "timelineEra": "In-universe year or air year" (optional),
      "identifiers": {
        "tmdbId": 123 (if known),
        "imdbId": "tt..." (if known),
        "tvdbId": 456 (if known)
      }
    }
  ]
}`

    const response = await this.gemini.sendMessage({
      messages: [{ role: 'user', content: promptText }],
      system: systemPrompt,
    })

    const rawJson = response.text.replace(/```(?:json)?/gi, '').trim()
    const parsed = JSON.parse(rawJson)

    const sanitizedId = 'web-' + (titleHint || 'custom').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

    return {
      id: sanitizedId,
      franchise: parsed.franchise || titleHint,
      name: parsed.name || titleHint,
      description: parsed.description || `Imported viewing guide from ${sourceUrl}`,
      sourceUrl,
      version: 1,
      items: (parsed.items || []).map((item: Partial<TimelineItem>, idx: number) => ({
        order: item.order || idx + 1,
        type: item.type === 'movie' || item.type === 'episode' || item.type === 'show' ? item.type : 'movie',
        title: item.title || `Item ${idx + 1}`,
        seriesTitle: item.seriesTitle,
        seasonNumber: item.seasonNumber,
        episodeNumber: item.episodeNumber,
        airDate: item.airDate,
        timelineEra: item.timelineEra,
        identifiers: {
          tmdbId: item.identifiers?.tmdbId,
          imdbId: item.identifiers?.imdbId,
          tvdbId: item.identifiers?.tvdbId,
        },
      })),
    }
  }

  private async extractWithHeuristics(html: string, _cleanedText: string, sourceUrl: string, pageTitle: string): Promise<TimelineDefinition> {
    const items: TimelineItem[] = []
    const lineRegex = /(?:<h[2-4][^>]*>|<li[^>]*>|<p[^>]*><strong>)\s*(\d+)[\.\):\-]\s*([^<]+?)(?:<\/h[2-4]>|<\/li>|<\/strong>)/gi

    let match: RegExpExecArray | null
    const seenTitles = new Set<string>()

    while ((match = lineRegex.exec(html)) !== null) {
      const rawOrder = parseInt(match[1], 10)
      let titleStr = match[2].trim()

      // Strip trailing year in parenthesis
      const yearMatch = titleStr.match(/\((\d{4}(?:[–-]\d{4}|[–-]present)?)\)/i)
      const year = yearMatch ? yearMatch[1] : undefined
      titleStr = titleStr.replace(/\(\d{4}(?:[–-]\d{4}|[–-]present)?\)/i, '').trim()

      if (titleStr.length > 2 && !seenTitles.has(titleStr.toLowerCase())) {
        seenTitles.add(titleStr.toLowerCase())
        const isTv = /season|series|episode|animated/i.test(titleStr)

        items.push({
          order: isNaN(rawOrder) ? items.length + 1 : rawOrder,
          type: isTv ? 'show' : 'movie',
          title: titleStr,
          seriesTitle: isTv ? titleStr : undefined,
          timelineEra: year,
          identifiers: {},
        })
      }
    }

    // If regex found items, enrich first 10 with TMDB search
    if (items.length > 0) {
      for (const item of items.slice(0, 15)) {
        try {
          if (item.type === 'movie') {
            const res = await this.tmdb.searchMovie(item.title)
            if (res.results && res.results[0]) {
              item.identifiers.tmdbId = res.results[0].id
              if (!item.airDate && res.results[0].release_date) {
                item.airDate = res.results[0].release_date
              }
            }
          } else {
            const res = await this.tmdb.searchTVShow(item.title)
            if (res.results && res.results[0]) {
              item.identifiers.tmdbId = res.results[0].id
              if (!item.airDate && res.results[0].first_air_date) {
                item.airDate = res.results[0].first_air_date
              }
            }
          }
        } catch {
          // TMDB search enrichment is optional
        }
      }
    }

    if (items.length === 0) {
      throw new Error(`Could not automatically detect a numbered viewing order on ${sourceUrl}. Please verify the URL or configure Gemini AI for deep parsing.`)
    }

    // Sort by order
    items.sort((a, b) => a.order - b.order)
    // Re-index order to guarantee 1..N
    items.forEach((it, idx) => {
      it.order = idx + 1
    })

    const sanitizedId = 'web-' + pageTitle.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

    return {
      id: sanitizedId,
      franchise: pageTitle,
      name: pageTitle,
      description: `Parsed from web guide: ${sourceUrl}`,
      sourceUrl,
      version: 1,
      items,
    }
  }

  private validateRecipe(recipe: TimelineDefinition): void {
    if (!recipe.id || !recipe.name || !Array.isArray(recipe.items) || recipe.items.length === 0) {
      throw new Error(`Invalid timeline recipe structure: missing id, name, or items.`)
    }
  }
}
