import { IMetadataProvider, MetadataSearchQuery, MetadataSearchResult, MediaMetadataDetails, MetadataType } from '../IMetadataProvider'

interface TVDBConfig { apiKey: string; pin?: string }
interface TVDBSearchItem { id?: number; name?: string; year?: string; image_url?: string; overview?: string; first_air_time?: string; aliases?: string[]; remoteIds?: Array<{ type?: number; id?: string }> }

export class TVDBMetadataProvider implements IMetadataProvider {
  readonly providerId = 'tvdb'
  readonly providerName = 'TheTVDB'
  readonly supportedTypes: MetadataType[] = ['tv']
  private readonly baseUrl = 'https://api4.thetvdb.com/v4'
  private token: string | null = null

  constructor(private readonly getConfig: () => TVDBConfig = () => ({ apiKey: '' })) {}

  private async authenticate(): Promise<string | null> {
    const config = this.getConfig()
    if (!config.apiKey) return null
    if (this.token) return this.token
    const response = await fetch(`${this.baseUrl}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ apikey: config.apiKey, pin: config.pin || undefined })
    })
    if (!response.ok) return null
    const body = await response.json() as { data?: { token?: string } }
    this.token = body.data?.token || null
    return this.token
  }

  private async request<T>(path: string): Promise<T | null> {
    const token = await this.authenticate()
    if (!token) return null
    const response = await fetch(`${this.baseUrl}${path}`, {
      headers: { Accept: 'application/json', Authorization: `Bearer ${token}` }
    })
    if (response.status === 401) this.token = null
    if (!response.ok) return null
    return await response.json() as T
  }

  private map(item: TVDBSearchItem): MetadataSearchResult {
    const id = String(item.id)
    const year = Number((item.year || item.first_air_time || '').slice(0, 4)) || undefined
    const imdbId = item.remoteIds?.find(remote => remote.type === 2)?.id
    const tmdbId = item.remoteIds?.find(remote => remote.type === 3)?.id
    return {
      id,
      provider: this.providerId,
      title: item.name || id,
      year,
      type: 'tv',
      posterUrl: item.image_url || undefined,
      overview: item.overview || undefined,
      externalIds: { tvdbId: id, imdbId, tmdbId },
      alternateTitles: item.aliases || []
    }
  }

  async search(query: MetadataSearchQuery): Promise<MetadataSearchResult[]> {
    if (!this.getConfig().apiKey || !this.supportedTypes.includes(query.type)) return []
    const body = await this.request<{ data?: TVDBSearchItem[] }>(`/search?query=${encodeURIComponent(query.title)}&type=series`)
    return (body?.data || []).filter(item => item.id && item.name).map(item => this.map(item))
  }

  async getDetails(externalId: string, type: MetadataType): Promise<MediaMetadataDetails | null> {
    if (type !== 'tv') return null
    const body = await this.request<{ data?: TVDBSearchItem & { genres?: string[]; score?: number } }>(`/series/${encodeURIComponent(externalId)}/extended`)
    if (!body?.data) return null
    return { ...this.map(body.data), genres: body.data.genres || [], score: body.data.score }
  }

  async findByExternalId(externalId: string, source: 'imdb_id' | 'tvdb_id', type: MetadataType): Promise<MediaMetadataDetails | null> {
    if (source !== 'tvdb_id') return null
    return this.getDetails(externalId, type)
  }
}
