export type ArrKind = 'sonarr' | 'radarr'

export interface ArrConfig { baseUrl: string; apiKey: string; timeoutMs?: number }

export class ArrIntegrationService {
  private readonly baseUrl: string
  private readonly timeoutMs: number

  constructor(private readonly config: ArrConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, '')
    this.timeoutMs = config.timeoutMs || 10000
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs)
    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        ...init,
        signal: controller.signal,
        headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-Api-Key': this.config.apiKey, ...(init?.headers || {}) }
      })
      if (!response.ok) throw new Error(`*arr request failed (${response.status})`)
      return await response.json() as T
    } finally { clearTimeout(timeout) }
  }

  async testConnection(): Promise<{ success: boolean; version?: string; error?: string }> {
    try {
      const status = await this.request<{ version?: string }>('/api/v3/system/status')
      return { success: true, version: status.version }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Connection failed' }
    }
  }

  async searchMovie(movieId: number): Promise<Record<string, unknown>> {
    return this.request('/api/v3/command', { method: 'POST', body: JSON.stringify({ name: 'MovieSearch', movieIds: [movieId] }) })
  }

  async lookupMovieByTmdbId(tmdbId: number): Promise<Record<string, unknown>[]> {
    return this.request(`/api/v3/movie/lookup?term=${encodeURIComponent(`tmdb:${tmdbId}`)}`)
  }

  async lookupSeriesByTvdbId(tvdbId: number): Promise<Record<string, unknown>[]> {
    return this.request(`/api/v3/series/lookup?term=${encodeURIComponent(`tvdb:${tvdbId}`)}`)
  }

  async findManagedMovieByTmdbId(tmdbId: number): Promise<Record<string, unknown> | null> {
    const movies = await this.request<Record<string, unknown>[]>(`/api/v3/movie?tmdbId=${encodeURIComponent(tmdbId)}`)
    return movies[0] || null
  }

  async findManagedSeriesByTvdbId(tvdbId: number): Promise<Record<string, unknown> | null> {
    const series = await this.request<Record<string, unknown>[]>(`/api/v3/series?tvdbId=${encodeURIComponent(tvdbId)}`)
    return series[0] || null
  }

  async searchSeries(seriesId: number, seasonNumber?: number, episodeIds?: number[]): Promise<Record<string, unknown>> {
    const body = seasonNumber !== undefined
      ? { name: 'SeasonSearch', seriesId, seasonNumber }
      : episodeIds?.length ? { name: 'EpisodeSearch', episodeIds } : { name: 'SeriesSearch', seriesId }
    return this.request('/api/v3/command', { method: 'POST', body: JSON.stringify(body) })
  }

  async getCommand(commandId: number): Promise<Record<string, unknown>> {
    return this.request(`/api/v3/command/${commandId}`)
  }

  async waitForCommand(commandId: number, options: { pollIntervalMs?: number; timeoutMs?: number } = {}): Promise<Record<string, unknown>> {
    const pollIntervalMs = options.pollIntervalMs ?? 2000
    const timeoutMs = options.timeoutMs ?? 120000
    const deadline = Date.now() + timeoutMs
    const terminal = new Set(['completed', 'failed', 'aborted'])
    while (Date.now() <= deadline) {
      const command = await this.getCommand(commandId)
      if (terminal.has(String(command.status).toLowerCase())) return command
      await new Promise(resolve => setTimeout(resolve, pollIntervalMs))
    }
    throw new Error('*arr command polling timed out')
  }
}
