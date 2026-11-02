import { describe, expect, it, vi } from 'vitest'
import { TVMazeMetadataProvider } from '../../../../src/main/services/metadata/providers/TVMazeMetadataProvider'

describe('TVMazeMetadataProvider', () => {
  it('maps free TV search results into the shared metadata shape', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [{ score: 0.9, show: {
        id: 42,
        name: 'The Expanse',
        premiered: '2015-12-14',
        summary: '<p>A show.</p>',
        externals: { imdb: 'tt3230854', thetvdb: 280619 },
        image: { medium: 'poster.jpg' }
      } }]
    }))

    const [result] = await new TVMazeMetadataProvider().search({ title: 'The Expanse', type: 'tv' })

    expect(result).toMatchObject({
      id: '42', provider: 'tvmaze', title: 'The Expanse', year: 2015, type: 'tv', overview: 'A show.'
    })
    expect(result.externalIds).toEqual({ imdbId: 'tt3230854', tvdbId: '280619' })
  })
})
