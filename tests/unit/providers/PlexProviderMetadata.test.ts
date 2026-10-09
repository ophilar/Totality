import { describe, it, expect, vi, beforeEach } from 'vitest'
import { PlexProvider } from '../../../src/main/providers/plex/PlexProvider'
import * as httpClient from '../../../src/main/services/utils/httpClient'

vi.mock('../../../src/main/database/getDatabase', () => ({
  getDatabase: () => ({
    getMusicTracks: vi.fn(() => []),
  }),
}))

describe('PlexProvider - JSON Headers for Metadata Requests', () => {
  let provider: PlexProvider
  let fetchJSONSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.clearAllMocks()
    fetchJSONSpy = vi.spyOn(httpClient, 'fetchJSON')

    provider = new PlexProvider({
      sourceId: 'plex-test-1',
      name: 'Test Plex',
      type: 'plex',
      connectionConfig: {
        serverUrl: 'http://192.168.1.50:32400',
        token: 'test-plex-token-xyz',
      },
    })

    // Set selected server
    const providerInternal = provider as unknown as {
      selectedServer: {
        name: string
        uri: string
        accessToken: string
        connections: unknown[]
      }
      authToken: string
    }
    providerInternal.selectedServer = {
      name: 'Test Server',
      uri: 'http://192.168.1.50:32400',
      accessToken: 'server-token-123',
      connections: [],
    }
    providerInternal.authToken = 'auth-token-456'
  })

  it('includes defaultHeaders with Accept: application/json when fetching album metadata', async () => {
    fetchJSONSpy.mockResolvedValueOnce({
      MediaContainer: {
        Metadata: [
          {
            ratingKey: '101',
            title: 'Test Album',
            Guid: [{ id: 'mbid://1234-5678' }],
          },
        ],
      },
    })

    const album = await provider.getAlbumMetadata('101')
    expect(album).toBeDefined()
    expect(album?.title).toBe('Test Album')

    expect(fetchJSONSpy).toHaveBeenCalledWith(
      'http://192.168.1.50:32400/library/metadata/101',
      expect.objectContaining({
        headers: expect.objectContaining({
          'X-Plex-Token': 'server-token-123',
          Accept: 'application/json',
          'X-Plex-Client-Identifier': expect.any(String),
        }),
        timeoutMs: 30_000,
      })
    )
  })

  it('includes defaultHeaders with Accept: application/json when fetching artist metadata', async () => {
    fetchJSONSpy.mockResolvedValueOnce({
      MediaContainer: {
        Metadata: [
          {
            ratingKey: '202',
            title: 'Test Artist',
          },
        ],
      },
    })

    const artist = await provider.getArtistMetadata('202')
    expect(artist).toBeDefined()
    expect(artist?.title).toBe('Test Artist')

    expect(fetchJSONSpy).toHaveBeenCalledWith(
      'http://192.168.1.50:32400/library/metadata/202',
      expect.objectContaining({
        headers: expect.objectContaining({
          'X-Plex-Token': 'server-token-123',
          Accept: 'application/json',
          'X-Plex-Client-Identifier': expect.any(String),
        }),
        timeoutMs: 30_000,
      })
    )
  })

  it('includes defaultHeaders when fetching user info', async () => {
    fetchJSONSpy.mockResolvedValueOnce({
      id: 1,
      uuid: 'user-uuid',
      email: 'test@example.com',
      username: 'tester',
      title: 'Tester',
    })

    const user = await provider.getUserInfo()
    expect(user).toBeDefined()
    expect(user?.username).toBe('tester')

    expect(fetchJSONSpy).toHaveBeenCalledWith(
      'https://plex.tv/api/v2/user',
      expect.objectContaining({
        headers: expect.objectContaining({
          'X-Plex-Token': 'auth-token-456',
          Accept: 'application/json',
          'X-Plex-Client-Identifier': expect.any(String),
        }),
      })
    )
  })
})
