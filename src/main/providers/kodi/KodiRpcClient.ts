import axios, { AxiosInstance } from 'axios'
import type { AxiosBasicCredentials } from 'axios'

export interface KodiRpcClientOptions {
  host: string
  port: number
  username?: string
  password?: string
  sourceId: string
}

export class KodiRpcClient {
  private api: AxiosInstance
  private options: KodiRpcClientOptions
  private nextId = 1

  constructor(options: KodiRpcClientOptions) {
    this.options = options
    const baseURL = `http://${options.host}:${options.port}`
    
    let auth: AxiosBasicCredentials | undefined
    if (options.username && options.password) {
      auth = { username: options.username, password: options.password }
    }

    this.api = axios.create({
      baseURL,
      timeout: 30000,
      auth,
    })
  }

  getHost() { return this.options.host }
  getPort() { return this.options.port }

  async call<T>(method: string, params: unknown = {}): Promise<T> {
    const id = this.nextId++
    try {
      const response = await this.api.post('/jsonrpc', {
        jsonrpc: '2.0',
        method,
        params,
        id,
      })

      if (response.data.error) {
        throw new Error(`Kodi RPC Error: ${response.data.error.message} (code: ${response.data.error.code})`)
      }

      return response.data.result as T
    } catch (error: unknown) {
      const responseStatus = typeof error === 'object' && error !== null && 'response' in error
        ? (error.response as { status?: number } | undefined)?.status
        : undefined
      if (responseStatus === 401) {
        throw new Error('Kodi authentication failed (401). Check username and password.')
      }
      throw error
    }
  }

  buildImageUrl(kodiUrl: string): string {
    if (!kodiUrl) return ''
    if (kodiUrl.startsWith('http')) return kodiUrl
    
    // Kodi encodes image URLs in its database: image://<urlencoded-path>/
    return `http://${this.options.host}:${this.options.port}/image/${encodeURIComponent(kodiUrl)}`
  }
}
