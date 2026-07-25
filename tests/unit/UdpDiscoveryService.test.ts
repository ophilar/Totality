import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as dgram from 'dgram'
import { UdpDiscoveryService } from '@main/services/UdpDiscoveryService'
import { getLoggingService } from '@main/services/LoggingService'

// Mock dependencies
vi.mock('dgram', () => {
  return {
    createSocket: vi.fn(),
  }
})

vi.mock('@main/services/LoggingService', () => {
  return {
    getLoggingService: vi.fn(() => ({
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
    })),
  }
})

describe('UdpDiscoveryService', () => {
  let service: UdpDiscoveryService
  let mockLogger: any

  beforeEach(() => {
    vi.clearAllMocks()
    service = new UdpDiscoveryService()
    mockLogger = {
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
    }
    vi.mocked(getLoggingService).mockReturnValue(mockLogger)
  })

  describe('discoverServers', () => {
    it('should handle socket creation failure gracefully', async () => {
      // Setup mock to throw error on socket creation
      const mockError = new Error('Failed to bind to port')
      vi.mocked(dgram.createSocket).mockImplementation(() => {
        throw mockError
      })

      // Run discovery
      const servers = await service.discoverServers('jellyfin')

      // Assertions
      expect(servers).toEqual([])
      expect(mockLogger.error).toHaveBeenCalledWith(
        '[UdpDiscoveryService]',
        '[JellyfinDiscovery] Failed to create socket:',
        mockError
      )
    })
  })
})
