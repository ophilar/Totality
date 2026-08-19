import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MetadataMatchingService, selectAutomaticMatch } from '../../../../src/main/services/metadata/MetadataMatchingService'
import { CompositeMetadataProvider } from '../../../../src/main/services/metadata/CompositeMetadataProvider'
import { MetadataSearchResult } from '../../../../src/main/services/metadata/IMetadataProvider'

describe('MetadataMatchingService', () => {
  let mockCompositeProvider: CompositeMetadataProvider
  let matchingService: MetadataMatchingService

  beforeEach(() => {
    mockCompositeProvider = new CompositeMetadataProvider()
    matchingService = new MetadataMatchingService(mockCompositeProvider)
  })

  it('should call CompositeMetadataProvider.searchAndFuse when matching a media item', async () => {
    const mockResult: MetadataSearchResult = {
      id: '123',
      provider: 'tmdb',
      title: 'Test Movie',
      year: 2023,
      type: 'movie',
      score: 100
    }

    vi.spyOn(mockCompositeProvider, 'searchAndFuse').mockResolvedValue([mockResult])

    const results = await matchingService.matchMediaItem({
      title: 'Test Movie',
      year: 2023,
      type: 'movie'
    })

    expect(mockCompositeProvider.searchAndFuse).toHaveBeenCalledWith({
      title: 'Test Movie',
      year: 2023,
      type: 'movie',
      externalIds: undefined
    })
    expect(results).toEqual([mockResult])
  })

  it('should forward externalIds correctly to searchAndFuse', async () => {
    vi.spyOn(mockCompositeProvider, 'searchAndFuse').mockResolvedValue([])

    await matchingService.matchMediaItem({
      title: 'Test Show',
      year: 2020,
      type: 'tv',
      externalIds: { imdb_id: 'tt123456' }
    })

    expect(mockCompositeProvider.searchAndFuse).toHaveBeenCalledWith({
      title: 'Test Show',
      year: 2020,
      type: 'tv',
      externalIds: { imdb_id: 'tt123456' }
    })
  })

  it('selects automatic match immediately when candidate matches query externalIds', () => {
    const candidates: MetadataSearchResult[] = [
      { id: '100', provider: 'tmdb', title: 'Different Title', year: 2020, type: 'movie', externalIds: { imdbId: 'tt1234567' } },
      { id: '200', provider: 'tmdb', title: 'Query Title', year: 2020, type: 'movie' }
    ]
    const match = selectAutomaticMatch(candidates, {
      title: 'Query Title',
      year: 2020,
      type: 'movie',
      externalIds: { imdbId: 'tt1234567' }
    })
    expect(match).toBeDefined()
    expect(match?.id).toBe('100')
  })

  it('resolves directly via external IDs before heuristic search when externalIds are present', async () => {
    const directResult = {
      id: 'tt9999999',
      provider: 'omdb',
      title: 'Authoritative Title',
      year: 2021,
      type: 'movie' as const,
      externalIds: { imdbId: 'tt9999999' },
      score: 100
    }
    vi.spyOn(mockCompositeProvider, 'findByExternalId').mockResolvedValue(directResult)
    vi.spyOn(mockCompositeProvider, 'searchAndFuse').mockResolvedValue([])

    const results = await matchingService.matchMediaItem({
      title: 'Some Completely Misnamed File',
      type: 'movie',
      externalIds: { imdbId: 'tt9999999' }
    })

    expect(mockCompositeProvider.findByExternalId).toHaveBeenCalledWith('tt9999999', 'imdb_id', 'movie')
    expect(results.length).toBeGreaterThan(0)
    expect(results[0]?.externalIds?.imdbId).toBe('tt9999999')
  })
})


