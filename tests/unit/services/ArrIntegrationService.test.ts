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
})
