import { describe, it, expect, beforeEach, vi } from 'vitest'
import { SourceManager } from '../../src/main/services/SourceManager'

describe('Music Scan Routing', () => {
  let manager: SourceManager
  let mockDb: any
  let mockLogging: any

  beforeEach(() => {
    vi.clearAllMocks()
    mockDb = {
      getMediaSources: vi.fn(() => []),
      updateLibraryScanTime: vi.fn(),
      createNotification: vi.fn(),
      getLibraryScanTime: vi.fn(),
      isLibraryEnabled: vi.fn(() => true),
    }
    mockLogging = {
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      verbose: vi.fn(),
    }
    manager = new SourceManager({ db: mockDb, logging: mockLogging })
  })

  it('should call scanLibrary on provider when scanLibrary is called on manager', async () => {
    const mockProvider = {
      providerType: 'plex',
      sourceId: 'src-1',
      getLibraries: vi.fn().mockResolvedValue([{ id: 'lib-music-1', name: 'Music', type: 'music' }]),
      scanLibrary: vi.fn().mockResolvedValue({
        success: true,
        itemsScanned: 10,
        itemsAdded: 5,
        itemsUpdated: 2,
        itemsRemoved: 0,
        errors: [],
        durationMs: 500,
      }),
    }

    // Inject mock provider via internal Map (still using any for private Map, but reducing scope)
    ;(manager as any).providers.set('src-1', mockProvider)
    ;(manager as any).initPromise = Promise.resolve()

    const result = await manager.scanLibrary('src-1', 'lib-music-1')

    expect(mockProvider.scanLibrary).toHaveBeenCalledWith('lib-music-1', expect.anything())
    expect(result.success).toBe(true)
    expect(result.itemsScanned).toBe(10)
  })

  it('should throw error if provider does not found', async () => {
    ;(manager as any).initPromise = Promise.resolve()

    await expect(manager.scanLibrary('non-existent', 'lib-1')).rejects.toThrow('Source not found')
  })
})
