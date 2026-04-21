import axios, { AxiosInstance } from 'axios'
import { getLoggingService } from '../../services/LoggingService'
import { retryWithBackoff } from '../../services/utils/retryWithBackoff'

export interface JellyfinApiClientOptions {
  serverUrl: string
  sourceId: string
  providerType: 'jellyfin' | 'emby'
  authHeaderName: string
  clientName: string
  clientVersion: string
  accessToken?: string
  apiKey?: string
  userId?: string
}

export class JellyfinApiClient {
  private api: AxiosInstance
  private options: JellyfinApiClientOptions

  constructor(options: JellyfinApiClientOptions) {
    this.options = { ...options, serverUrl: options.serverUrl.replace(/\/$/, '') }
    this.api = axios.create({
      timeout: 30000,
    })
  }

  setServerUrl(url: string) {
    this.options.serverUrl = url.replace(/\/$/, '')
  }

  setApiKey(apiKey: string) {
    this.options.apiKey = apiKey
  }

  getApiKey() {
    return this.options.apiKey
  }

  setAccessToken(token: string, userId: string) {
    this.options.accessToken = token
    this.options.userId = userId
  }

  getUserId() { return this.options.userId }
  getAccessToken() { return this.options.accessToken }
  getServerUrl() { return this.options.serverUrl }

  private getAuthHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    }

    if (this.options.accessToken) {
      headers[this.options.authHeaderName] = this.buildAuthHeader()
    } else if (this.options.apiKey) {
      headers['X-Emby-Token'] = this.options.apiKey
    }

    return headers
  }

  buildAuthHeader(): string {
    const parts = [
      `MediaBrowser Client="${this.options.clientName}"`,
      `Device="Totality"`,
      `DeviceId="${this.options.sourceId}"`,
      `Version="${this.options.clientVersion}"`,
    ]
    if (this.options.accessToken) parts.push(`Token="${this.options.accessToken}"`)
    return parts.join(', ')
  }

  async get<T>(url: string, params?: Record<string, unknown>): Promise<T> {
    const fullUrl = url.startsWith('http') ? url : `${this.options.serverUrl}${url}`
    const response = await this.api.get<T>(fullUrl, {
      params,
      headers: this.getAuthHeaders()
    })
    return response.data
  }

  async post<T>(url: string, data?: unknown, extraHeaders?: Record<string, string>): Promise<T> {
    const fullUrl = url.startsWith('http') ? url : `${this.options.serverUrl}${url}`
    const response = await this.api.post<T>(fullUrl, data, {
      headers: { ...this.getAuthHeaders(), ...extraHeaders }
    })
    return response.data
  }

  async requestWithRetry<T>(requestFn: () => Promise<T>, context?: string): Promise<T> {
    return retryWithBackoff(requestFn, {
      maxRetries: 3,
      initialDelay: 1000,
      maxDelay: 15000,
      retryableStatuses: [429, 500, 502, 503, 504],
      onRetry: (attempt, error, delay) => {
        getLoggingService().warn(`[${this.options.providerType}]`, `${context || 'Request'} - Retry ${attempt}/3 after ${delay}ms: ${error.message}`)
      }
    })
  }

  buildImageUrl(itemId: string, imageType: string, imageTag?: string): string {
    if (!this.options.serverUrl || !itemId) return ''
    const pathPrefix = this.options.providerType === 'emby' ? '/emby' : ''
    let url = `${this.options.serverUrl}${pathPrefix}/Items/${itemId}/Images/${imageType}`
    const params = new URLSearchParams()
    if (imageTag) params.set('tag', imageTag)
    const token = this.options.apiKey || this.options.accessToken
    if (token) params.set('api_key', token)
    const qs = params.toString()
    return qs ? `${url}?${qs}` : url
  }

  /**
   * Check if Quick Connect is enabled on the server
   */
  async isQuickConnectEnabled(): Promise<boolean> {
    try {
      const response = await this.api.get<boolean>(`${this.options.serverUrl}/QuickConnect/Enabled`, {
        timeout: 5000,
      })
      return response.data === true
    } catch { return false }
  }

  /**
   * Initiate Quick Connect - returns a code for user to enter in another client
   */
  async initiateQuickConnect(): Promise<{ secret: string; code: string } | null> {
    try {
      const response = await this.api.post<{ Secret: string; Code: string }>(
        `${this.options.serverUrl}/QuickConnect/Initiate`,
        null,
        { headers: { 'X-Emby-Authorization': this.buildAuthHeader() } }
      )
      return { secret: response.data.Secret, code: response.data.Code }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      getLoggingService().error(`[${this.options.providerType}]`, 'Failed to initiate Quick Connect:', message)
      throw new Error('Failed to initiate Quick Connect')
    }
  }

  /**
   * Check Quick Connect status - poll until authenticated
   */
  async checkQuickConnectStatus(secret: string): Promise<{ authenticated: boolean; error?: string }> {
    try {
      const response = await this.api.get<{ Authenticated: boolean }>(
        `${this.options.serverUrl}/QuickConnect/Connect`,
        {
          params: { Secret: secret },
          headers: { 'X-Emby-Authorization': this.buildAuthHeader() }
        }
      )
      return { authenticated: response.data.Authenticated === true }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      return { authenticated: false, error: message }
    }
  }

  /**
   * Complete Quick Connect authentication - exchange secret for access token
   */
  async completeQuickConnect(secret: string): Promise<{ success: boolean; token?: string; userId?: string; userName?: string; error?: string }> {
    try {
      interface QuickConnectResponse {
        AccessToken: string
        User: { Id: string; Name: string }
      }
      const response = await this.api.post<QuickConnectResponse>(
        `${this.options.serverUrl}/Users/AuthenticateWithQuickConnect`,
        { Secret: secret },
        { headers: { 'X-Emby-Authorization': this.buildAuthHeader() } }
      )

      if (response.data.AccessToken) {
        this.setAccessToken(response.data.AccessToken, response.data.User.Id)
        return {
          success: true,
          token: response.data.AccessToken,
          userId: response.data.User.Id,
          userName: response.data.User.Name,
        }
      }
      return { success: false, error: 'No access token received' }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      return { success: false, error: message }
    }
  }
}
