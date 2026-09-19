import { describe, expect, it, vi } from 'vitest'
import { LocalTimelineRecipeProvider } from '@main/services/timelines/LocalTimelineRecipeProvider'
import { RemoteRegistryRecipeProvider } from '@main/services/timelines/RemoteRegistryRecipeProvider'

describe('timeline recipe providers', () => {
  it('loads validated timelines from individual local files', async () => {
    const provider = new LocalTimelineRecipeProvider('tests/fixtures/timelines')
    const recipes = await provider.listAvailableRecipes()
    expect(recipes).toEqual([{ id: 'example-order', name: 'Example Order', franchise: 'Example', description: 'Synthetic timeline fixture.', totalItems: 2, sourceType: 'preset' }])
    await expect(provider.fetchTimeline('example-order')).resolves.toMatchObject({ id: 'example-order', items: [{ order: 1 }, { order: 2 }] })
  })

  it('reports missing local timeline files explicitly', async () => {
    await expect(new LocalTimelineRecipeProvider('tests/fixtures/timelines').fetchTimeline('missing')).rejects.toThrow("Timeline 'missing' was not found")
  })

  it('loads a remote timeline only when an explicit registry is provided', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ id: 'remote-order', franchise: 'Example', name: 'Remote Order', description: '', version: 2, items: [{ order: 1, type: 'movie', title: 'Example Film', identifiers: { tmdbId: 1 } }] }) } as unknown as Response)
    await expect(new RemoteRegistryRecipeProvider('https://registry.example.test').fetchTimeline('remote-order')).resolves.toMatchObject({ id: 'remote-order' })
    vi.restoreAllMocks()
  })
})
