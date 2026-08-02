import { describe, expect, it, vi, afterEach } from 'vitest'
import { ArrIntegrationService } from '@main/services/ArrIntegrationService'

describe('ArrIntegrationService', () => {
  afterEach(() => vi.restoreAllMocks())

  it('tests a configured *arr connection without exposing credentials', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ version: '4.0.0' }), { status: 200 }))
    const service = new ArrIntegrationService({ baseUrl: 'http://localhost:8989', apiKey: 'secret' })

    await expect(service.testConnection()).resolves.toMatchObject({ success: true, version: '4.0.0' })
    expect(fetchMock.mock.calls[0][0]).toBe('http://localhost:8989/api/v3/system/status')
    expect(String(fetchMock.mock.calls[0][0])).not.toContain('secret')
  })

  it('submits an explicit search command for a managed item', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ id: 42 }), { status: 200 }))
    const service = new ArrIntegrationService({ baseUrl: 'http://localhost:7878', apiKey: 'secret' })

    await expect(service.searchMovie(123)).resolves.toEqual({ id: 42 })
    expect(fetchMock.mock.calls[0][0]).toBe('http://localhost:7878/api/v3/command')
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({ name: 'MovieSearch', movieIds: [123] })
  })

  it('looks up managed movie and series records by external identity', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response('[]', { status: 200 }))
    const service = new ArrIntegrationService({ baseUrl: 'http://localhost:8989', apiKey: 'secret' })

    await service.lookupMovieByTmdbId(123)
    await service.lookupSeriesByTvdbId(456)

    expect(fetchMock.mock.calls[0][0]).toBe('http://localhost:8989/api/v3/movie/lookup?term=tmdb%3A123')
    expect(fetchMock.mock.calls[1][0]).toBe('http://localhost:8989/api/v3/series/lookup?term=tvdb%3A456')
  })

  it('resolves managed records from the library before issuing searches', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response('[]', { status: 200 }))
    const service = new ArrIntegrationService({ baseUrl: 'http://localhost:8989', apiKey: 'secret' })

    await service.findManagedMovieByTmdbId(123)
    await service.findManagedSeriesByTvdbId(456)

    expect(fetchMock.mock.calls[0][0]).toBe('http://localhost:8989/api/v3/movie?tmdbId=123')
    expect(fetchMock.mock.calls[1][0]).toBe('http://localhost:8989/api/v3/series?tvdbId=456')
  })

  it('polls a command until a terminal status is returned', async () => {
    const service = new ArrIntegrationService({ baseUrl: 'http://localhost:8989', apiKey: 'secret' })
    const getCommand = vi.spyOn(service, 'getCommand')
      .mockResolvedValueOnce({ status: 'started' })
      .mockResolvedValueOnce({ status: 'completed' })

    await expect(service.waitForCommand(42, { pollIntervalMs: 1, timeoutMs: 100 })).resolves.toMatchObject({ status: 'completed' })
    expect(getCommand).toHaveBeenCalledTimes(2)
  })
})
