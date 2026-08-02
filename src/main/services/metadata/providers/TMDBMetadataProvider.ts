import { IMetadataProvider, MetadataSearchQuery, MetadataSearchResult, MediaMetadataDetails, MetadataType } from '../IMetadataProvider'

export class TMDBMetadataProvider implements IMetadataProvider {
  readonly providerId = 'tmdb'
  readonly providerName = 'The Movie Database (TMDB)'
  readonly supportedTypes: MetadataType[] = ['movie', 'tv']

  constructor(private apiKeyGetter: () => string) {}

  async search(query: MetadataSearchQuery): Promise<MetadataSearchResult[]> {
    const apiKey = this.apiKeyGetter()
    if (!apiKey) return []

    const endpoint = query.type === 'movie' ? 'search/movie' : 'search/tv'
    const adultParam = (query.includeExpanded ?? query.includeAdult) ? '&include_adult=true' : ''
    const url = `https://api.themoviedb.org/3/${endpoint}?api_key=${apiKey}&query=${encodeURIComponent(query.title)}${query.year ? `&year=${query.year}` : ''}${adultParam}`

    try {
      const res = await fetch(url)
      if (!res.ok) {
        console.error(`[TMDBMetadataProvider] Search HTTP ${res.status} for query: ${query.title}`)
        return []
      }
      const data = await res.json()

      const items = Array.isArray(data.results) ? data.results : []
      return items.slice(0, 10).map((item: any) => ({
        id: String(item.id),
        provider: this.providerId,
        title: item.title || item.name || query.title,
        year: item.release_date ? parseInt(item.release_date.slice(0, 4)) : item.first_air_date ? parseInt(item.first_air_date.slice(0, 4)) : undefined,
        type: query.type,
        posterUrl: item.poster_path ? `https://image.tmdb.org/t/p/w500${item.poster_path}` : undefined,
        bannerUrl: item.backdrop_path ? `https://image.tmdb.org/t/p/w1280${item.backdrop_path}` : undefined,
        overview: item.overview,
        externalIds: { tmdbId: String(item.id) },
        score: item.vote_average
      }))
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
      const data = await res.json()

      const match = type === 'movie'
        ? (Array.isArray(data.movie_results) ? data.movie_results[0] : null)
        : (Array.isArray(data.tv_results) ? data.tv_results[0] : null)

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
      const item = await res.json()

      return {
        id: String(item.id),
        provider: this.providerId,
        title: item.title || item.name,
        year: item.release_date ? parseInt(item.release_date.slice(0, 4)) : item.first_air_date ? parseInt(item.first_air_date.slice(0, 4)) : undefined,
        type,
        posterUrl: item.poster_path ? `https://image.tmdb.org/t/p/w500${item.poster_path}` : undefined,
        bannerUrl: item.backdrop_path ? `https://image.tmdb.org/t/p/w1280${item.backdrop_path}` : undefined,
        overview: item.overview,
        externalIds: { tmdbId: String(item.id) },
        score: item.vote_average,
        genres: Array.isArray(item.genres) ? item.genres.map((g: any) => g.name) : [],
        totalSeasons: item.number_of_seasons,
        totalEpisodes: item.number_of_episodes,
        collectionId: item.belongs_to_collection ? String(item.belongs_to_collection.id) : undefined,
        collectionName: item.belongs_to_collection ? item.belongs_to_collection.name : undefined,
        raw: item
      }
    } catch (err) {
      console.error('[TMDBMetadataProvider] Details error:', err)
      throw err
    }
  }
}
