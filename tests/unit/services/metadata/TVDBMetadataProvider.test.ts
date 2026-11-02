import { describe, expect, it, vi, afterEach } from 'vitest'
import { TVDBMetadataProvider } from '@main/services/metadata/providers/TVDBMetadataProvider'

describe('TVDBMetadataProvider', () => {
  afterEach(() => vi.restoreAllMocks())

  it('authenticates and fuses TVDB search results into metadata candidates', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { token: 'token-1' } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ id: 123, name: 'The Example Show', year: '2020', image_url: 'https://img/show.jpg', overview: 'A show' }] }), { status: 200 }))

    const provider = new TVDBMetadataProvider(() => ({ apiKey: 'key-1' }))
    const results = await provider.search({ title: 'The Example Show', type: 'tv' })

    expect(results[0]).toMatchObject({
      id: '123',
      provider: 'tvdb',
      title: 'The Example Show',
      year: 2020,
      posterUrl: 'https://img/show.jpg',
      externalIds: { tvdbId: '123' }
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('does not call TVDB when no API key is configured', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
    const provider = new TVDBMetadataProvider(() => ({ apiKey: '' }))

    await expect(provider.search({ title: 'Example', type: 'tv' })).resolves.toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
