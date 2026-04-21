import axios, { AxiosInstance } from 'axios'

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
    
    const auth: any = {}
    if (options.username && options.password) {
      auth.username = options.username
      auth.password = options.password
    }

    this.api = axios.create({
      baseURL,
      timeout: 30000,
      auth: Object.keys(auth).length > 0 ? auth : undefined,
    })
  }

  getHost() { return this.options.host }
  getPort() { return this.options.port }

  async call<T>(method: string, params: any = {}): Promise<T> {
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
    } catch (error: any) {
      if (error.response?.status === 401) {
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
