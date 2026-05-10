import { describe, it, expect, vi, beforeEach } from 'vitest'
import { PlexProvider } from '@main/providers/plex/PlexProvider'
import axios from 'axios'

vi.mock('axios')
const mockedAxios = vi.mocked(axios)

describe('Plex Authentication Logic', () => {
  const config = {
    sourceId: 'test-plex',
    sourceType: 'plex',
    displayName: 'Test Plex',
    connectionConfig: {}
  }

  beforeEach(() => {
    vi.clearAllMocks()
    // Mock axios.create to return an object with post/get methods
    const mockAxiosInstance = {
      post: vi.fn(),
      get: vi.fn(),
      defaults: { headers: { common: {} } }
    }
    mockedAxios.create.mockReturnValue(mockAxiosInstance as any)
  })

  it('should generate a valid Auth URL with properly encoded context parameters', () => {
    const provider = new PlexProvider(config as any)
    const pinId = 12345
    const code = 'abcd-1234'
    const url = provider.getAuthUrl(pinId, code)
    
    expect(url).toContain('https://app.plex.tv/auth#?')
    expect(url).toContain('clientID=totality')
    expect(url).toContain(`code=${code}`)
    
    // Crucial fix: check for encoded brackets %5B and %5D
    // context[device][product] -> context%5Bdevice%5D%5Bproduct%5D
    expect(url).toContain('context%5Bdevice%5D%5Bproduct%5D=Totality')
    expect(url).toContain('context%5Bdevice%5D%5Bplatform%5D=')
    expect(url).toContain('context%5Bdevice%5D%5Bdevice%5D=Totality')
    
    // Ensure no slash before #
    expect(url).not.toContain('auth/#')
  })

  it('should request a PIN with the correct headers and 30s timeout', async () => {
    const provider = new PlexProvider(config as any)
    const mockInstance = vi.mocked((provider as any).api)
    mockInstance.post.mockResolvedValueOnce({
      data: { id: 1, code: 'XYZ' }
    })

    await provider.requestAuthPin()

    expect(mockedAxios.create).toHaveBeenCalledWith(expect.objectContaining({
      timeout: 30000,
      headers: expect.objectContaining({
        'X-Plex-Client-Identifier': 'totality',
        'X-Plex-Product': 'Totality'
      })
    }))
    expect(mockInstance.post).toHaveBeenCalledWith(expect.stringContaining('/pins'), {
      strong: true
    })
  })

  it('should check a PIN and return the token if available', async () => {
    const provider = new PlexProvider(config as any)
    const mockInstance = vi.mocked((provider as any).api)
    mockInstance.get.mockResolvedValueOnce({
      data: { id: 1, authToken: 'valid-token' }
    })

    const token = await provider.checkAuthPin(1)

    expect(token).toBe('valid-token')
    expect(mockInstance.get).toHaveBeenCalledWith(expect.stringContaining('/pins/1'))
  })

  it('should return null if PIN is not yet authorized', async () => {
    const provider = new PlexProvider(config as any)
    const mockInstance = vi.mocked((provider as any).api)
    mockInstance.get.mockResolvedValueOnce({
      data: { id: 1, authToken: null }
    })

    const token = await provider.checkAuthPin(1)

    expect(token).toBeNull()
  })
})
