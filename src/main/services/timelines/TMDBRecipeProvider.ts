import type { ITimelineRecipeProvider, TimelineDefinition, TimelineItem, TimelineRecipeSummary } from './ITimelineRecipeProvider'
import { getTMDBService, TMDBService } from '@main/services/TMDBService'
import { getDatabase } from '@main/database/BetterSQLiteService'
import { movieCollections } from '@main/database/drizzleSchema'
import { getTimelineCacheService, TimelineCacheService } from './TimelineCacheService'

export class TMDBRecipeProvider implements ITimelineRecipeProvider {
  constructor(
    private _tmdb?: TMDBService,
    private readonly cacheService: TimelineCacheService = getTimelineCacheService()
  ) {}

  private get tmdb(): TMDBService {
    return this._tmdb || getTMDBService()
  }

  async listAvailableRecipes(): Promise<TimelineRecipeSummary[]> {
    const recipes: TimelineRecipeSummary[] = []
    const seenIds = new Set<string>()

    try {
      // Discover collections present in the user's database
      const db = getDatabase().drizzle
      const localCollections = await db.select().from(movieCollections)
      for (const col of localCollections) {
        if (col.tmdbCollectionId && !seenIds.has(col.tmdbCollectionId)) {
          seenIds.add(col.tmdbCollectionId)
          recipes.push({
            id: `tmdb-collection-${col.tmdbCollectionId}`,
            name: col.collectionName,
            franchise: col.collectionName,
            description: `Official TMDB Collection (${col.totalMovies} films)`,
            totalItems: col.totalMovies,
            sourceType: 'remote',
          })
        }
      }
    } catch {
      // Database not ready yet or empty
    }

    return recipes
  }

  async fetchTimeline(idOrQuery: string): Promise<TimelineDefinition> {
    const cached = await this.cacheService.getRecipe(idOrQuery)
    if (cached) {
      return cached
    }

    let collectionId: string

    if (idOrQuery.startsWith('tmdb-collection-')) {
      collectionId = idOrQuery.replace('tmdb-collection-', '')
    } else if (/^\d+$/.test(idOrQuery)) {
      collectionId = idOrQuery
    } else {
      // Search TMDB for collection by name/query
      const searchRes = await this.tmdb.searchCollection(idOrQuery)
      if (!searchRes.results || searchRes.results.length === 0) {
        throw new Error(`No TMDB collection found for '${idOrQuery}'.`)
      }
      collectionId = String(searchRes.results[0].id)
    }

    const collection = await this.tmdb.getCollectionDetails(collectionId)
    if (!collection || !Array.isArray(collection.parts)) {
      throw new Error(`Failed to load TMDB collection details for ID '${collectionId}'.`)
    }

    // Sort parts chronologically by release date
    const sortedParts = [...collection.parts].sort((a, b) => {
      const dateA = a.release_date || '9999-99-99'
      const dateB = b.release_date || '9999-99-99'
      return dateA.localeCompare(dateB)
    })

    const items: TimelineItem[] = sortedParts.map((part, index) => {
      const year = part.release_date ? part.release_date.substring(0, 4) : undefined
      return {
        order: index + 1,
        type: 'movie',
        title: part.title,
        airDate: part.release_date || undefined,
        timelineEra: year ? `${year}` : undefined,
        identifiers: {
          tmdbId: part.id,
        },
      }
    })

    const definition: TimelineDefinition = {
      id: `tmdb-collection-${collection.id}`,
      franchise: collection.name,
      name: collection.name,
      description: collection.overview || `Official ${collection.name} from TMDB.`,
      sourceUrl: `https://www.themoviedb.org/collection/${collection.id}`,
      version: 1,
      items,
    }

    await this.cacheService.setRecipe(definition.id, definition)
    if (idOrQuery !== definition.id) {
      await this.cacheService.setRecipe(idOrQuery, definition)
    }
    return definition
  }
}
