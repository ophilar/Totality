import { describe, it, expect, vi, beforeEach } from 'vitest'
import axios from 'axios'
import { KodiProvider } from '../../src/main/providers/kodi/KodiProvider'

vi.mock('axios')
const mockedAxios = axios as jest.Mocked<typeof axios>

describe('KodiProvider', () => {
  let provider: KodiProvider

  beforeEach(() => {
    vi.resetAllMocks()
    
    const mockAxiosInstance = {
      post: vi.fn(),
      get: vi.fn(),
      defaults: { headers: { common: {} } },
      interceptors: { request: { use: vi.fn() }, response: { use: vi.fn() } }
    }
    mockedAxios.create.mockReturnValue(mockAxiosInstance as any)

    provider = new KodiProvider({
      sourceId: 's1',
      displayName: 'Kodi',
      connectionConfig: {
        host: 'localhost',
        port: 8080,
        username: 'user',
        password: 'password'
      }
    })
  })

  it('should test connection successfully', async () => {
    const mockAxiosInstance = (provider as any).api
    mockAxiosInstance.post.mockResolvedValueOnce({
      data: {
        jsonrpc: '2.0',
        id: 1,
        result: {
          version: { major: 19, minor: 0, revision: 0, tag: 'stable' },
          name: 'Kodi'
        }
      }
    })

    const result = await provider.testConnection({
      host: 'localhost',
      port: 8080,
      username: 'user',
      password: 'password'
    })

    expect(result.success).toBe(true)
    expect(mockAxiosInstance.post).toHaveBeenCalledWith('http://localhost:8080/jsonrpc', expect.objectContaining({
      method: 'JSONRPC.Version'
    }), expect.anything())
  })

  it('should get libraries (mocked Kodi libraries)', async () => {
    // Kodi doesn't have "libraries" in the same way Plex/Jellyfin do, 
    // it returns virtual libraries based on content type.
    const libraries = await provider.getLibraries()
    
    expect(libraries.length).toBe(3)
    expect(libraries.map(l => l.type)).toContain('movie')
    expect(libraries.map(l => l.type)).toContain('show')
    expect(libraries.map(l => l.type)).toContain('music')
  })
})
