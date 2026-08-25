import { IMetadataProvider, MetadataSearchQuery, MetadataSearchResult, MediaMetadataDetails, MetadataType } from '../IMetadataProvider'

interface TVMazeShow {
  id: number
  name?: string
  premiered?: string | null
  image?: { medium?: string; original?: string } | null
  summary?: string | null
  rating?: { average?: number | null }
  status?: string | null
  language?: string | null
  network?: { name?: string; country?: { code?: string; name?: string } } | null
  webChannel?: { name?: string; country?: { code?: string; name?: string } } | null
  externals?: { imdb?: string | null; thetvdb?: number | null; tvrage?: number | null }
}

export class TVMazeMetadataProvider implements IMetadataProvider {
  readonly providerId = 'tvmaze'
  readonly providerName = 'TVmaze (Free TV Metadata)'
  readonly supportedTypes: MetadataType[] = ['tv']

  private readonly baseUrl = 'https://api.tvmaze.com'

  async search(query: MetadataSearchQuery): Promise<MetadataSearchResult[]> {
    if (query.type !== 'tv') return []
    try {
      const response = await fetch(`${this.baseUrl}/search/shows?q=${encodeURIComponent(query.title)}`)
      if (!response.ok) return []
      const entries = await response.json() as Array<{ score?: number; show?: TVMazeShow }>
      return entries.slice(0, 10).flatMap(entry => entry.show ? [this.mapShow(entry.show, query.type)] : [])
    } catch {
      return []
    }
  }

  async getDetails(externalId: string, type: MetadataType): Promise<MediaMetadataDetails | null> {
    if (type !== 'tv') return null
    try {
      const response = await fetch(`${this.baseUrl}/shows/${encodeURIComponent(externalId)}`)
      if (!response.ok) return null
      return this.mapShow(await response.json() as TVMazeShow, type)
    } catch {
      return null
    }
  }

  private mapShow(show: TVMazeShow, type: MetadataType): MediaMetadataDetails {
    const year = show.premiered ? Number.parseInt(show.premiered.slice(0, 4), 10) : undefined
    return {
      id: String(show.id),
      provider: this.providerId,
      title: show.name || '',
      year: Number.isNaN(year) ? undefined : year,
      type,
      posterUrl: show.image?.original || show.image?.medium || undefined,
      overview: show.summary?.replace(/<[^>]+>/g, '').trim() || undefined,
      score: show.rating?.average ?? undefined,
      firstAirDate: show.premiered || undefined,
      network: show.network?.name || show.webChannel?.name || undefined,
      country: show.network?.country?.code || show.webChannel?.country?.code || undefined,
      status: show.status || undefined,
      originalLanguage: show.language || undefined,
      externalIds: {
        imdbId: show.externals?.imdb || undefined,
        tvdbId: show.externals?.thetvdb ? String(show.externals.thetvdb) : undefined
      }
    }
  }
}
