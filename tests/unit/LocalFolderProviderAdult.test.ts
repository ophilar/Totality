import { describe, it, expect, vi } from 'vitest'
import { MetadataMatchingService } from '../../src/main/services/metadata/MetadataMatchingService'
import { CompositeMetadataProvider } from '../../src/main/services/metadata/CompositeMetadataProvider'

describe('LocalFolderProvider - Adult Parameter Forwarding', () => {
  it('forwards includeAdult and includeExpanded flags to MetadataMatchingService for movies and episodes', async () => {
    const mockCompositeProvider = new CompositeMetadataProvider()
    const matchingService = new MetadataMatchingService(mockCompositeProvider)
    
    const searchSpy = vi.spyOn(mockCompositeProvider, 'searchAndFuse').mockResolvedValue([])

    await matchingService.matchMediaItem({
      title: 'Protected Media Item',
      type: 'movie',
      includeAdult: true,
      includeExpanded: true
    })

    expect(searchSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Protected Media Item',
        type: 'movie',
        includeAdult: true,
        includeExpanded: true
      })
    )
  })
})
