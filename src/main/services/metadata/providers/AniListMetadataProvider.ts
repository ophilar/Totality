import { IMetadataProvider, MetadataSearchQuery, MetadataSearchResult, MediaMetadataDetails, MetadataType } from '../IMetadataProvider'

interface AniListMedia {
  id: number
  title?: { english?: string; romaji?: string; native?: string }
  synonyms?: string[]
  startDate?: { year?: number }
  coverImage?: { large?: string }
  bannerImage?: string
  description?: string
  meanScore?: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isAniListMedia(value: unknown): value is AniListMedia {
  if (!isRecord(value) || typeof value.id !== 'number') return false
  const title = value.title
  return title === undefined || isRecord(title)
}

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
            synonyms
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
      const body: unknown = await res.json()
      const mediaList = isRecord(body) && isRecord(body.data) && isRecord(body.data.Page) && Array.isArray(body.data.Page.media)
        ? body.data.Page.media.filter(isAniListMedia)
        : []

      return mediaList.map((item) => ({
        id: String(item.id),
        provider: this.providerId,
        title: item.title?.english || item.title?.romaji || query.title,
        year: item.startDate?.year || undefined,
        type: 'anime' as MetadataType,
        posterUrl: item.coverImage?.large,
        bannerUrl: item.bannerImage,
        overview: item.description,
        score: item.meanScore ? item.meanScore / 10 : undefined,
        externalIds: { anilistId: String(item.id) },
        alternateTitles: [item.title?.romaji, item.title?.english, item.title?.native, ...(item.synonyms || [])].filter(
          (title): title is string => Boolean(title)
        )
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
            native
          }
          synonyms
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
        externalIds: { anilistId: String(item.id) },
        alternateTitles: [item.title?.romaji, item.title?.english, item.title?.native, ...(item.synonyms || [])].filter(Boolean),
        raw: item
      }
    } catch (err) {
      console.error('[AniListMetadataProvider] Error fetching details:', err)
      throw err
    }
  }
}
