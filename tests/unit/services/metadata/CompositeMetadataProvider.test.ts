import { describe, it, expect, vi, beforeEach } from 'vitest'
import { CompositeMetadataProvider } from '../../../../src/main/services/metadata/CompositeMetadataProvider'
import { IMetadataProvider, MetadataSearchQuery, MetadataSearchResult, MediaMetadataDetails, MetadataType } from '../../../../src/main/services/metadata/IMetadataProvider'

class MockProvider implements IMetadataProvider {
  providerId: string
  providerName: string
  supportedTypes: MetadataType[] = ['movie', 'tv']
  
  mockSearch = vi.fn()
  mockGetDetails = vi.fn()
  mockFindByExternalId = vi.fn()

  constructor(id: string) {
    this.providerId = id
    this.providerName = id
  }

  async search(query: MetadataSearchQuery): Promise<MetadataSearchResult[]> {
    return this.mockSearch(query)
  }
  
  async getDetails(externalId: string, type: MetadataType): Promise<MediaMetadataDetails | null> {
    return this.mockGetDetails(externalId, type)
  }

  async searchAndFuse(query: MetadataSearchQuery): Promise<MetadataSearchResult[]> {
    return this.search(query)
  }
}

describe('CompositeMetadataProvider - searchAndFuse', () => {
  let composite: CompositeMetadataProvider
  let tmdb: MockProvider
  let omdb: MockProvider

  beforeEach(() => {
    tmdb = new MockProvider('tmdb')
    omdb = new MockProvider('omdb')
    composite = new CompositeMetadataProvider([tmdb, omdb])
  })

  it('should query all registered providers concurrently and fuse results', async () => {
    const query = { title: 'The Matrix', type: 'movie' as const, year: 1999 }
    
    tmdb.mockSearch.mockResolvedValue([
      { id: '1', provider: 'tmdb', title: 'The Matrix', year: 1999, type: 'movie' }
    ])
    
    omdb.mockSearch.mockResolvedValue([
      { id: 'tt0133093', provider: 'omdb', title: 'The Matrix', year: 1999, type: 'movie', imdbRating: 8.7, imdbVotes: '2M' }
    ])

    const results = await composite.searchAndFuse(query)
    
    expect(tmdb.mockSearch).toHaveBeenCalledWith(query)
    expect(omdb.mockSearch).toHaveBeenCalledWith(query)
    
    // We expect it to fuse them into one candidate or just score them
    // The exact structure of fusion isn't strictly defined, but it should merge complementary fields
    expect(results).toHaveLength(1)
    expect(results[0].title).toBe('The Matrix')
    expect(results[0].score).toBeDefined()
    expect('imdbRating' in results[0] && results[0].imdbRating).toBe(8.7)
  })

  it('uses any shared external identity to fuse provider results', async () => {
    tmdb.mockSearch.mockResolvedValue([{ id: '10', provider: 'tmdb', title: 'Example Show', year: 2020, type: 'tv', externalIds: { tmdbId: '10', tvdbId: '77' } }])
    omdb.mockSearch.mockResolvedValue([{ id: 'tt77', provider: 'omdb', title: 'Example Series', year: 2020, type: 'tv', externalIds: { imdbId: 'tt77', tvdbId: '77' }, imdbRating: 8 }])

    const results = await composite.searchAndFuse({ title: 'Example Show', type: 'tv', year: 2020 })

    expect(results).toHaveLength(1)
    expect(results[0].externalIds).toMatchObject({ tmdbId: '10', imdbId: 'tt77', tvdbId: '77' })
  })

  it('honors persisted provider enablement and ordering preferences', async () => {
    const settings = vi.fn().mockResolvedValue({ enabled: ['omdb'], order: ['omdb', 'tmdb'] })
    composite = new CompositeMetadataProvider([tmdb, omdb], settings)
    omdb.mockSearch.mockResolvedValue([{ id: 'tt1', provider: 'omdb', title: 'Example', year: 2020, type: 'movie' }])

    const results = await composite.searchAndFuse({ title: 'Example', type: 'movie', year: 2020 })

    expect(settings).toHaveBeenCalledOnce()
    expect(tmdb.mockSearch).not.toHaveBeenCalled()
    expect(omdb.mockSearch).toHaveBeenCalledOnce()
    expect(results).toHaveLength(1)
  })
})
