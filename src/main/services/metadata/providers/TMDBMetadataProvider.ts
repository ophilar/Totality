import { IMetadataProvider, MetadataSearchQuery, MetadataSearchResult, MediaMetadataDetails, MetadataType } from '../IMetadataProvider'

interface TmdbItem {
  id: number
  title?: string
  name?: string
  release_date?: string
  first_air_date?: string
  poster_path?: string
  backdrop_path?: string
  overview?: string
  vote_average?: number
  genres?: Array<{ name?: string }>
  number_of_seasons?: number
  number_of_episodes?: number
  belongs_to_collection?: { id?: number; name?: string } | null
  origin_country?: string[]
  original_language?: string
  status?: string
  networks?: Array<{ id?: number; name?: string }>
  production_companies?: Array<{ id?: number; name?: string }>
  production_countries?: Array<{ iso_3166_1?: string; name?: string }>
  media_type?: 'movie' | 'tv' | 'person'
  known_for?: TmdbItem[]
}

function isTmdbItem(value: unknown): value is TmdbItem {
  return typeof value === 'object' && value !== null && typeof (value as Record<string, unknown>).id === 'number'
}

export class TMDBMetadataProvider implements IMetadataProvider {
  readonly providerId = 'tmdb'
  readonly providerName = 'The Movie Database (TMDB)'
  readonly supportedTypes: MetadataType[] = ['movie', 'tv']

  constructor(private apiKeyGetter: () => string) {}

  async search(query: MetadataSearchQuery): Promise<MetadataSearchResult[]> {
    const apiKey = this.apiKeyGetter()
    if (!apiKey) return []

    const expanded = query.includeExpanded ?? query.includeAdult ?? false
    const endpoint = query.type === 'movie' ? 'search/movie' : 'search/tv'
    const adultParam = expanded ? '&include_adult=true' : ''
    const yearParam = query.year ? (query.type === 'movie' ? `&year=${query.year}` : `&first_air_date_year=${query.year}`) : ''

    try {
      const url = `https://api.themoviedb.org/3/${endpoint}?api_key=${apiKey}&query=${encodeURIComponent(query.title)}${yearParam}${adultParam}`
      const res = await fetch(url)
        if (!res.ok) throw new Error(`TMDB search HTTP ${res.status}`)
      const data = await res.json() as Record<string, unknown>
      const items = Array.isArray(data.results) ? data.results.filter(isTmdbItem) : []
      const uniqueItems = Array.from(new Map(items.map(item => [item.id, item])).values())
      const results = uniqueItems.slice(0, expanded ? 50 : 10).map((item) => ({
        id: String(item.id),
        provider: this.providerId,
        title: item.title || item.name || query.title,
        year: item.release_date ? parseInt(item.release_date.slice(0, 4)) : item.first_air_date ? parseInt(item.first_air_date.slice(0, 4)) : undefined,
        type: query.type,
        posterUrl: item.poster_path ? `https://image.tmdb.org/t/p/w500${item.poster_path}` : undefined,
        bannerUrl: item.backdrop_path ? `https://image.tmdb.org/t/p/w1280${item.backdrop_path}` : undefined,
        overview: item.overview,
        firstAirDate: item.first_air_date,
        releaseDate: item.release_date,
        country: Array.isArray(item.origin_country) && item.origin_country.length > 0 ? item.origin_country[0] : undefined,
        originalLanguage: item.original_language,
        status: item.status,
        externalIds: { tmdbId: String(item.id) },
        score: item.vote_average
      }))

      if (!expanded) return results

      // Expanded search is entity-aware: resolve people, then search their credits.
      // The original query and year are never rewritten.
      const personUrl = `https://api.themoviedb.org/3/search/person?api_key=${apiKey}&query=${encodeURIComponent(query.title)}&include_adult=true`
      const personResponse = await fetch(personUrl)
      if (!personResponse.ok) return results
      const people = (await personResponse.json() as Record<string, unknown>).results
      const personIds = Array.isArray(people) ? people.filter(isTmdbItem).slice(0, 5).map(person => person.id) : []
      const credits = await Promise.all(personIds.map(async personId => {
        const creditsUrl = `https://api.themoviedb.org/3/person/${personId}/${query.type === 'movie' ? 'movie_credits' : 'tv_credits'}?api_key=${apiKey}`
        const creditsResponse = await fetch(creditsUrl)
        if (!creditsResponse.ok) return []
        const body = await creditsResponse.json() as Record<string, unknown>
        return (Array.isArray(body.cast) ? body.cast : []).filter(isTmdbItem)
      }))
      const creditItems = credits.flat().filter(item => {
        const date = item.release_date || item.first_air_date
        return !query.year || date?.startsWith(String(query.year))
      })
      return [...results, ...creditItems.slice(0, 50).map(item => ({
        id: String(item.id), provider: this.providerId, title: item.title || item.name || query.title,
        year: item.release_date ? parseInt(item.release_date.slice(0, 4)) : item.first_air_date ? parseInt(item.first_air_date.slice(0, 4)) : undefined,
        type: query.type, posterUrl: item.poster_path ? `https://image.tmdb.org/t/p/w500${item.poster_path}` : undefined,
        bannerUrl: item.backdrop_path ? `https://image.tmdb.org/t/p/w1280${item.backdrop_path}` : undefined,
        overview: item.overview, externalIds: { tmdbId: String(item.id) }, score: item.vote_average
      }))]
    } catch (err) {
      console.error('[TMDBMetadataProvider] Search error:', err)
      return []
    }
  }

  async findByExternalId(externalId: string, source: 'imdb_id' | 'tvdb_id', type: MetadataType): Promise<MediaMetadataDetails | null> {
    const apiKey = this.apiKeyGetter()
    if (!apiKey || !externalId) return null

    const url = `https://api.themoviedb.org/3/find/${encodeURIComponent(externalId)}?api_key=${apiKey}&external_source=${source}`

    try {
      const res = await fetch(url)
      if (!res.ok) return null
      const data: Record<string, unknown> = await res.json()

      const match = type === 'movie'
        ? (Array.isArray(data.movie_results) ? data.movie_results.find(isTmdbItem) ?? null : null)
        : (Array.isArray(data.tv_results) ? data.tv_results.find(isTmdbItem) ?? null : null)

      if (!match) return null

      return this.getDetails(String(match.id), type)
    } catch (err) {
      console.error('[TMDBMetadataProvider] findByExternalId error:', err)
      return null
    }
  }

  async getDetails(externalId: string, type: MetadataType): Promise<MediaMetadataDetails | null> {
    const apiKey = this.apiKeyGetter()
    if (!apiKey || !externalId) return null

    const endpoint = type === 'movie' ? `movie/${externalId}` : `tv/${externalId}`
    const url = `https://api.themoviedb.org/3/${endpoint}?api_key=${apiKey}`

    try {
      const res = await fetch(url)
      if (!res.ok) {
        console.error(`[TMDBMetadataProvider] Details HTTP ${res.status} for ID: ${externalId}`)
        return null
      }
      const item: unknown = await res.json()
      if (!isTmdbItem(item)) return null

      return {
        id: String(item.id),
        provider: this.providerId,
        title: item.title || item.name || externalId,
        year: item.release_date ? parseInt(item.release_date.slice(0, 4)) : item.first_air_date ? parseInt(item.first_air_date.slice(0, 4)) : undefined,
        type,
        posterUrl: item.poster_path ? `https://image.tmdb.org/t/p/w500${item.poster_path}` : undefined,
        bannerUrl: item.backdrop_path ? `https://image.tmdb.org/t/p/w1280${item.backdrop_path}` : undefined,
        overview: item.overview,
        externalIds: { tmdbId: String(item.id) },
        score: item.vote_average,
        genres: Array.isArray(item.genres)
          ? item.genres.map((g) => String(g.name ?? '')).filter(Boolean)
          : [],
        totalSeasons: item.number_of_seasons,
        totalEpisodes: item.number_of_episodes,
        collectionId: item.belongs_to_collection ? String(item.belongs_to_collection.id) : undefined,
        collectionName: item.belongs_to_collection ? item.belongs_to_collection.name : undefined,
        raw: { ...item }
      }
    } catch (err) {
      console.error('[TMDBMetadataProvider] Details error:', err)
      throw err
    }
  }
}
