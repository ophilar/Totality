import { IMetadataProvider, MetadataSearchQuery, MetadataSearchResult, MediaMetadataDetails, MetadataType } from '../IMetadataProvider'

export class AniListMetadataProvider implements IMetadataProvider {
  readonly providerId = 'anilist'
  readonly providerName = 'AniList (Anime Metadata)'
  readonly supportedTypes: MetadataType[] = ['anime', 'tv']

  private readonly graphqlEndpoint = 'https://graphql.anilist.co'

  async search(query: MetadataSearchQuery): Promise<MetadataSearchResult[]> {
    const gqlQuery = `
      query ($search: String) {
        Page(perPage: 10) {
          media(search: $search, type: ANIME) {
            id
            title {
              romaji
              english
              native
            }
            startDate {
              year
            }
            coverImage {
              large
            }
            bannerImage
            description
            meanScore
          }
        }
      }
    `

    try {
      const res = await fetch(this.graphqlEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({ query: gqlQuery, variables: { search: query.title } })
      })

      if (!res.ok) {
        console.error(`[AniListMetadataProvider] Search HTTP ${res.status} for query: ${query.title}`)
        return []
      }
      const body = await res.json()
      const mediaList = body?.data?.Page?.media || []

      return mediaList.map((item: any) => ({
        id: String(item.id),
        provider: this.providerId,
        title: item.title?.english || item.title?.romaji || query.title,
        year: item.startDate?.year || undefined,
        type: 'anime' as MetadataType,
        posterUrl: item.coverImage?.large,
        bannerUrl: item.bannerImage,
        overview: item.description,
        score: item.meanScore ? item.meanScore / 10 : undefined
      }))
    } catch (err) {
      console.error('[AniListMetadataProvider] Search error:', err)
      return []
    }
  }

  async getDetails(externalId: string, type: MetadataType): Promise<MediaMetadataDetails | null> {
    const gqlQuery = `
      query ($id: Int) {
        Media(id: $id, type: ANIME) {
          id
          title {
            romaji
            english
          }
          startDate { year }
          coverImage { large }
          bannerImage
          description
          meanScore
          episodes
          genres
        }
      }
    `

    try {
      const res = await fetch(this.graphqlEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({ query: gqlQuery, variables: { id: parseInt(externalId, 10) } })
      })

      if (!res.ok) {
        console.error(`[AniListMetadataProvider] API HTTP ${res.status} for ID: ${externalId}`)
        return null
      }

      const body = await res.json()
      const item = body?.data?.Media
      if (!item) return null

      return {
        id: String(item.id),
        provider: this.providerId,
        title: item.title?.english || item.title?.romaji,
        year: item.startDate?.year,
        type: type === 'anime' || type === 'tv' ? type : 'anime',
        posterUrl: item.coverImage?.large,
        bannerUrl: item.bannerImage,
        overview: item.description,
        score: item.meanScore ? item.meanScore / 10 : undefined,
        genres: item.genres || [],
        totalEpisodes: item.episodes,
        raw: item
      }
    } catch (err) {
      console.error('[AniListMetadataProvider] Error fetching details:', err)
      throw err
    }
  }
}
