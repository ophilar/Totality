import { IMetadataProvider, MetadataSearchQuery, MetadataSearchResult, MediaMetadataDetails, MetadataType } from '../IMetadataProvider'
import type { ProviderHealthResult } from '@shared/serviceHealth'
import { fetchWithTimeout } from '@main/services/utils/httpClient'

interface TVDBConfig { apiKey: string | null; pin?: string | null }
interface TVDBSearchItem {
  id?: number
  name?: string
  year?: string
  image_url?: string
  overview?: string
  first_air_time?: string
  aliases?: string[]
  remoteIds?: Array<{ type?: number; id?: string }>
  country?: string
  network?: string
  status?: string
  primary_language?: string
}

export class TVDBMetadataProvider implements IMetadataProvider {
  readonly providerId = 'tvdb'
  readonly providerName = 'TheTVDB'
  readonly supportedTypes: MetadataType[] = ['tv']
  private readonly baseUrl = 'https://api4.thetvdb.com/v4'
  private token: string | null = null
  private tokenConfiguration: string | null = null

  constructor(private readonly getConfig: () => TVDBConfig | Promise<TVDBConfig> = () => ({ apiKey: '' })) {}

  async testSavedCredential(signal: AbortSignal): Promise<ProviderHealthResult> {
    const config = await this.getConfig()
    if (!config.apiKey) return { status: 'not-configured', message: null }
    const configIdentity = JSON.stringify([config.apiKey, config.pin ?? null])
    if (this.tokenConfiguration !== configIdentity) {
      this.token = null
      this.tokenConfiguration = configIdentity
    }
    try {
      const response = await fetchWithTimeout(`${this.baseUrl}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ apikey: config.apiKey, pin: config.pin || undefined }),
        signal,
      }, 10000)
      if (response.status === 401) return { status: 'invalid-credential', message: 'TVDB rejected the saved credentials.' }
      if (response.status === 403) return { status: 'permission-denied', message: 'TVDB denied access for this account or subscription.' }
      if (response.status === 429) return { status: 'rate-limited', message: 'TVDB rate limit reached.' }
      if (!response.ok) return { status: 'unavailable', message: `TVDB returned HTTP ${response.status}.` }
      const body = await response.json() as { data?: { token?: string } }
      if (!body.data?.token) return { status: 'unavailable', message: 'TVDB returned no authentication token.' }
      this.token = body.data.token
      return { status: 'valid', message: null }
    } catch (error) {
      if (signal.aborted) throw error
      if (error instanceof Error && /timed out/i.test(error.message)) return { status: 'timed-out', message: 'TVDB validation timed out.' }
      return { status: 'unavailable', message: 'TVDB could not be reached.' }
    }
  }

  private async authenticate(signal?: AbortSignal): Promise<string | null> {
    signal?.throwIfAborted()
    const config = await this.getConfig()
    if (!config.apiKey) return null
    const configIdentity = JSON.stringify([config.apiKey, config.pin ?? null])
    if (this.token && this.tokenConfiguration === configIdentity) return this.token
    if (this.tokenConfiguration !== configIdentity) {
      this.token = null
      this.tokenConfiguration = configIdentity
    }
    const response = await fetch(`${this.baseUrl}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ apikey: config.apiKey, pin: config.pin || undefined }),
      signal,
    })
    if (!response.ok) return null
    const body = await response.json() as { data?: { token?: string } }
    this.token = body.data?.token || null
    return this.token
  }

  private async request<T>(path: string, signal?: AbortSignal): Promise<T | null> {
    signal?.throwIfAborted()
    const token = await this.authenticate(signal)
    if (!token) return null
    const response = await fetch(`${this.baseUrl}${path}`, {
      headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
      signal,
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
      firstAirDate: item.first_air_time || undefined,
      network: item.network || undefined,
      country: item.country || undefined,
      status: item.status || undefined,
      originalLanguage: item.primary_language || undefined,
      externalIds: { tvdbId: id, imdbId, tmdbId },
      alternateTitles: item.aliases || []
    }
  }

  async search(query: MetadataSearchQuery, signal?: AbortSignal): Promise<MetadataSearchResult[]> {
    signal?.throwIfAborted()
    if (!(await this.getConfig()).apiKey || !this.supportedTypes.includes(query.type)) return []
    const body = await this.request<{ data?: TVDBSearchItem[] }>(`/search?query=${encodeURIComponent(query.title)}&type=series`, signal)
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
