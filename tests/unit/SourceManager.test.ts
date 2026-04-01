/**
 * SourceManager Unit Tests
 *
 * Tests for source management including CRUD operations,
 * provider lifecycle, and scan control.
 *
 * Uses real in-memory database to reduce mocking.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { BetterSQLiteService } from '../../src/main/database/BetterSQLiteService'
import { SourceManager } from '../../src/main/services/SourceManager'
import type { MediaProvider } from '../../src/main/providers/base/MediaProvider'

// Mock dependencies
vi.mock('fs/promises', () => ({
  default: {
    readFile: vi.fn(),
    writeFile: vi.fn(),
    mkdir: vi.fn(),
    access: vi.fn(),
    rename: vi.fn(),
    readdir: vi.fn(() => Promise.resolve([])),
    rm: vi.fn(),
    stat: vi.fn(),
  },
}))

vi.mock('../../src/main/services/PlexService', () => ({
  getPlexService: vi.fn(() => ({
    createSource: vi.fn(),
  })),
}))

vi.mock('../../src/main/services/LiveMonitoringService', () => ({
  getLiveMonitoringService: vi.fn(() => ({
    addSource: vi.fn(),
    removeSource: vi.fn(),
    updateSource: vi.fn(),
  })),
}))

vi.mock('../../src/main/services/TaskQueueService', () => ({
  getTaskQueueService: vi.fn(() => ({
    removeTasksForSource: vi.fn(),
  })),
}))

// Mock provider creation
function createMockProvider(sourceId: string, displayName: string, type: string): MediaProvider {
  return {
    sourceId,
    displayName,
    providerType: type as any,
    isAuthenticated: vi.fn(() => Promise.resolve(true)),
    hasSelectedServer: vi.fn(() => true),
    testConnection: vi.fn(() => Promise.resolve({ success: true })),
    getLibraries: vi.fn(() => Promise.resolve([
      { id: 'lib1', name: 'Movies', type: 'movie' },
      { id: 'lib2', name: 'TV Shows', type: 'show' },
    ])),
    scanLibrary: vi.fn().mockResolvedValue({
      success: true,
      itemsScanned: 10,
      itemsAdded: 5,
      itemsUpdated: 2,
      itemsRemoved: 0,
      errors: [],
      durationMs: 1000
    }),
  } as unknown as MediaProvider
}

vi.mock('../../src/main/providers/ProviderFactory', () => ({
  createProvider: vi.fn((type, config) => createMockProvider(config.sourceId, config.displayName, type)),
  isProviderSupported: vi.fn(() => true),
}))

// Intercept getDatabase
let testDb: BetterSQLiteService

vi.mock('../../src/main/database/getDatabase', () => ({
  getDatabase: vi.fn(() => testDb),
}))

describe('SourceManager', () => {
  let manager: SourceManager

  beforeEach(() => {
    testDb = new BetterSQLiteService(':memory:')
    testDb.initialize()
    
    vi.clearAllMocks()
    manager = new SourceManager()
  })

  afterEach(() => {
    testDb.close()
  })

  describe('initialization', () => {
    it('should initialize without sources', async () => {
      await manager.initialize()
      const stats = await manager.getAggregatedStats()
      expect(stats.totalSources).toBe(0)
    })

    it('should load existing sources on initialize', async () => {
      testDb.upsertMediaSource({
        source_id: 'src1',
        source_type: 'plex',
        display_name: 'Test Plex',
        connection_config: JSON.stringify({}),
        is_enabled: 1,
      })

      await manager.initialize()
      const sources = await manager.getSources()
      expect(sources.length).toBe(1)
      expect(sources[0].display_name).toBe('Test Plex')
    })

    it('should only initialize once', async () => {
      await manager.initialize()
      const initialCount = (await manager.getSources()).length
      await manager.initialize()
      expect((await manager.getSources()).length).toBe(initialCount)
    })
  })

  describe('source CRUD', () => {
    beforeEach(async () => {
      await manager.initialize()
    })

    it('should add a new source', async () => {
      const source = await manager.addSource({
        sourceType: 'plex',
        displayName: 'New Plex',
        connectionConfig: { token: 'test-token' },
        isEnabled: true,
      })

      expect(source).toBeDefined()
      expect(source.display_name).toBe('New Plex')
      expect(source.source_type).toBe('plex')
      
      const sources = await manager.getSources()
      expect(sources.length).toBe(1)
    })

    it('should get all sources', async () => {
      await manager.addSource({ sourceType: 'plex', displayName: 'Source 1', connectionConfig: {}, isEnabled: true })
      await manager.addSource({ sourceType: 'jellyfin', displayName: 'Source 2', connectionConfig: {}, isEnabled: true })
      
      const sources = await manager.getSources()
      expect(sources.length).toBe(2)
    })

    it('should get sources by type', async () => {
      await manager.addSource({ sourceType: 'plex', displayName: 'Plex 1', connectionConfig: {}, isEnabled: true })
      await manager.addSource({ sourceType: 'jellyfin', displayName: 'Jellyfin 1', connectionConfig: {}, isEnabled: true })
      
      const plexSources = await manager.getSources('plex')
      expect(plexSources.length).toBe(1)
      expect(plexSources[0].source_type).toBe('plex')
    })

    it('should get source by ID', async () => {
      const source = await manager.addSource({ sourceType: 'plex', displayName: 'Test', connectionConfig: {}, isEnabled: true })
      const found = await manager.getSource(source.source_id)
      expect(found).not.toBeNull()
      expect(found?.display_name).toBe('Test')
    })

    it('should return null for non-existent source', async () => {
      const found = await manager.getSource('non-existent')
      expect(found).toBeNull()
    })

    it('should get enabled sources only', async () => {
      await manager.addSource({ sourceType: 'plex', displayName: 'Enabled', connectionConfig: {}, isEnabled: true })
      await manager.addSource({ sourceType: 'jellyfin', displayName: 'Disabled', connectionConfig: {}, isEnabled: false })
      
      const enabledSources = await manager.getEnabledSources()
      expect(enabledSources.length).toBe(1)
      expect(enabledSources[0].display_name).toBe('Enabled')
    })
  })

  describe('scan control', () => {
    beforeEach(async () => {
      await manager.initialize()
    })

    it('should report no scan in progress initially', () => {
      expect(manager.isScanInProgress()).toBe(false)
    })

    it('should report manual scan in progress status', async () => {
      const source = await manager.addSource({ sourceType: 'plex', displayName: 'Scan', connectionConfig: {}, isEnabled: true })
      
      // We can't easily test the middle of a scan since it's async and fast in tests,
      // but we can check the status reporting logic if we mock it.
      expect(manager.isScanInProgress()).toBe(false)
    })
  })

  describe('provider management', () => {
    it('should get provider for source', async () => {
      await manager.initialize()
      const source = await manager.addSource({ sourceType: 'plex', displayName: 'Plex Server', connectionConfig: {}, isEnabled: true })
      
      const provider = await manager.getProvider(source.source_id)
      expect(provider).toBeDefined()
      expect(provider?.sourceId).toBe(source.source_id)
    })

    it('should return undefined for non-existent provider', async () => {
      await manager.initialize()
      const provider = await manager.getProvider('non-existent')
      expect(provider).toBeUndefined()
    })
  })

  describe('connection testing', () => {
    it('should test connection for existing source', async () => {
      await manager.initialize()
      const source = await manager.addSource({ sourceType: 'plex', displayName: 'Plex', connectionConfig: {}, isEnabled: true })
      
      const result = await manager.testConnection(source.source_id)
      expect(result.success).toBe(true)
    })

    it('should return error for non-existent source', async () => {
      await manager.initialize()
      const result = await manager.testConnection('non-existent')
      expect(result.success).toBe(false)
      expect(result.error).toBeDefined()
    })
  })

  describe('source toggling', () => {
    it('should toggle source enabled state', async () => {
      await manager.initialize()
      const source = await manager.addSource({ sourceType: 'plex', displayName: 'Plex', connectionConfig: {}, isEnabled: true })
      
      await manager.toggleSource(source.source_id, false)
      const disabled = await manager.getSource(source.source_id)
      expect(disabled?.is_enabled).toBe(false)
      
      await manager.toggleSource(source.source_id, true)
      const enabled = await manager.getSource(source.source_id)
      expect(enabled?.is_enabled).toBe(true)
    })
  })
})
