import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MetadataMatchingService } from '../../../../src/main/services/metadata/MetadataMatchingService'
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
})

