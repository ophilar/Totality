import { describe, it, expect, vi, beforeEach } from 'vitest'
import axios from 'axios'
import { JellyfinProvider } from '../../src/main/providers/jellyfin-emby/JellyfinProvider'

vi.mock('axios')
const mockedAxios = axios as jest.Mocked<typeof axios>

describe('JellyfinProvider', () => {
  let provider: JellyfinProvider

  beforeEach(() => {
    vi.resetAllMocks()
    
    // Create mock instance with minimal axios-like behavior
    const mockAxiosInstance = {
      post: vi.fn(),
      get: vi.fn(),
      defaults: { headers: { common: {} } },
      interceptors: { request: { use: vi.fn() }, response: { use: vi.fn() } }
    }
    mockedAxios.create.mockReturnValue(mockAxiosInstance as any)

    provider = new JellyfinProvider({
      sourceId: 's1',
      displayName: 'JF',
      connectionConfig: {
        serverUrl: 'http://localhost:8096',
        username: 'user',
        password: 'password'
      }
    })
  })

  it('should authenticate with the server', async () => {
    const mockAxiosInstance = (provider as any).api
    mockAxiosInstance.post.mockResolvedValueOnce({
      data: {
        AccessToken: 'test-token',
        User: { Id: 'u1', Name: 'user' },
        ServerId: 'server1'
      }
    })

    const result = await provider.authenticate({
      username: 'user',
      password: 'password',
      serverUrl: 'http://localhost:8096'
    })

    expect(result.success).toBe(true)
    expect(result.accessToken || (result as any).token).toBe('test-token')
  })

  it('should fetch libraries from the server', async () => {
    const mockAxiosInstance = (provider as any).api
    // Set internal state for testing
    ;(provider as any).accessToken = 'token'
    ;(provider as any).userId = 'u1'
    ;(provider as any).serverUrl = 'http://localhost:8096'
    
    mockAxiosInstance.get.mockResolvedValueOnce({
      data: {
        Items: [
          { Id: 'l1', Name: 'Movies', CollectionType: 'movies' },
          { Id: 'l2', Name: 'TV Shows', CollectionType: 'tvshows' }
        ]
      }
    })

    const libraries = await provider.getLibraries()
    expect(libraries.length).toBe(2)
    expect(libraries[0].name).toBe('Movies')
    expect(libraries[1].type).toBe('show')
  })
})
