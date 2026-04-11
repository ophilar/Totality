/**
 * SourceManager Unit Tests
 *
 * Tests for source management including CRUD operations,
 * provider lifecycle, and scan control.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { SourceManager } from '../../src/main/services/SourceManager'

describe('SourceManager', () => {
  let manager: SourceManager
  let mockDb: any
  let mockLogging: any
  let mockLiveMonitoring: any
  let mockTaskQueue: any
  let mockMediaSources: any[]

  beforeEach(() => {
    vi.clearAllMocks()
    mockMediaSources = []
    
    mockDb = {
      getMediaSources: vi.fn(() => mockMediaSources),
      getMediaSourceById: vi.fn((id: string) => mockMediaSources.find(s => s.source_id === id) || null),
      getEnabledMediaSources: vi.fn(() => mockMediaSources.filter(s => s.is_enabled)),
      upsertMediaSource: vi.fn((source: any) => {
        const existingIndex = mockMediaSources.findIndex(s => s.source_id === source.source_id)
        if (existingIndex >= 0) {
          mockMediaSources[existingIndex] = { ...mockMediaSources[existingIndex], ...source }
        } else {
          mockMediaSources.push({ ...source, created_at: new Date().toISOString() })
        }
        return source.source_id
      }),
      deleteMediaSource: vi.fn(),
      isLibraryEnabled: vi.fn(() => true),
      getLibraryScanTimes: vi.fn(() => new Map()),
      createNotification: vi.fn(),
      updateSourceScanTime: vi.fn(),
      updateLastScanAt: vi.fn(),
    }

    mockLogging = {
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      verbose: vi.fn(),
    }

    mockLiveMonitoring = {
      removeSource: vi.fn(),
      notifyLibraryUpdated: vi.fn(),
    }

    mockTaskQueue = {
      removeTasksForSource: vi.fn(),
    }

    manager = new SourceManager({
      db: mockDb,
      logging: mockLogging,
      liveMonitoring: mockLiveMonitoring,
      taskQueue: mockTaskQueue
    })
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  // ============================================================================
  // INITIALIZATION
  // ============================================================================

  describe('initialization', () => {
    it('should initialize without sources', async () => {
      await manager.initialize()
      const sources = await manager.getSources()
      expect(sources).toEqual([])
    })

    it('should load existing sources on initialize', async () => {
      mockMediaSources.push({
        source_id: 'source-1',
        source_type: 'plex',
        display_name: 'Test Plex',
        connection_config: JSON.stringify({ serverUrl: 'http://localhost:32400' }),
        is_enabled: true,
      })

      await manager.initialize()
      const sources = await manager.getSources()

      expect(sources).toHaveLength(1)
    })
  })

  // ============================================================================
  // SOURCE CRUD
  // ============================================================================

  describe('source CRUD', () => {
    beforeEach(async () => {
      await manager.initialize()
    })

    it('should add a new source', async () => {
      const config = {
        sourceType: 'jellyfin' as const,
        displayName: 'Test Jellyfin',
        connectionConfig: { serverUrl: 'http://localhost:8096', apiKey: 'test-key' },
      }

      const source = await manager.addSource(config)

      expect(source).toBeDefined()
      expect(source.display_name).toBe('Test Jellyfin')
      expect(source.source_type).toBe('jellyfin')
    })

    it('should get all sources', async () => {
      mockMediaSources.push({
        source_id: 'source-1',
        source_type: 'plex',
        display_name: 'Plex Server',
        connection_config: '{}',
        is_enabled: true,
      })

      const sources = await manager.getSources()
      expect(sources).toHaveLength(1)
    })

    it('should get source by ID', async () => {
      mockMediaSources.push({
        source_id: 'source-1',
        source_type: 'plex',
        display_name: 'Plex Server',
        connection_config: '{}',
        is_enabled: true,
      })

      const source = await manager.getSource('source-1')
      expect(source).toBeDefined()
      expect(source?.source_id).toBe('source-1')
    })

    it('should return null for non-existent source', async () => {
      const source = await manager.getSource('non-existent')
      expect(source).toBeNull()
    })
  })

  // ============================================================================
  // SCAN CONTROL
  // ============================================================================

  describe('scan control', () => {
    beforeEach(async () => {
      await manager.initialize()
    })

    it('should report no scan in progress initially', () => {
      expect(manager.isScanInProgress()).toBe(false)
    })

    it('should report scan cancelled status', () => {
      expect(manager.isScanCancelled()).toBe(false)
      manager.stopScan()
      expect(manager.isScanCancelled()).toBe(false)
    })
  })
})
