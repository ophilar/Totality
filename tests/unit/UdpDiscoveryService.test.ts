import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { UdpDiscoveryService, getUdpDiscoveryService } from '../../src/main/services/UdpDiscoveryService'
import * as dgram from 'dgram'
import { fetchJSON } from '@main/services/utils/httpClient'

const { mockSocket } = vi.hoisted(() => {
  const mockSocket = {
    on: vi.fn(),
    bind: vi.fn(),
    setBroadcast: vi.fn(),
    send: vi.fn(),
    close: vi.fn(),
  }
  return { mockSocket }
})

vi.mock('dgram', () => {
  return {
    createSocket: vi.fn(() => mockSocket),
    default: {
      createSocket: vi.fn(() => mockSocket),
    }
  }
})

vi.mock('@main/services/utils/httpClient', () => {
  return {
    fetchJSON: vi.fn(),
  }
})

vi.mock('@main/services/LoggingService', () => {
  return {
    getLoggingService: vi.fn(() => ({
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
    }))
  }
})

describe('UdpDiscoveryService', () => {
  let service: UdpDiscoveryService
  type Callback = (...args: unknown[]) => void

  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    service = new UdpDiscoveryService()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('Singleton Pattern', () => {
    it('should return the same instance', () => {
      const instance1 = getUdpDiscoveryService()
      const instance2 = getUdpDiscoveryService()
      expect(instance1).toBe(instance2)
    })
  })

  describe('discoverServers', () => {
    it('should discover Jellyfin server', async () => {
      vi.mocked(mockSocket.bind).mockImplementation((cb: Callback) => {
        cb()
      })

      vi.mocked(mockSocket.on).mockImplementation((event: string, cb: Callback) => {
        if (event === 'message') {
          // Simulate server response
          const response = JSON.stringify({
            Id: 'server-1',
            Name: 'Jellyfin Server',
            Address: 'http://192.168.1.100:8096'
          })
          cb(Buffer.from(response), { address: '192.168.1.100' })
        }
        return mockSocket
      })

      const discoverPromise = service.discoverServers('jellyfin')

      vi.advanceTimersByTime(3000)

      const servers = await discoverPromise

      expect(servers).toHaveLength(1)
      expect(servers[0]).toEqual({
        id: 'server-1',
        name: 'Jellyfin Server',
        address: 'http://192.168.1.100:8096',
        endpointAddress: undefined,
        localAddress: undefined,
        type: 'jellyfin'
      })
    })

    it('should fallback to rinfo address if Address is not provided', async () => {
      vi.mocked(mockSocket.bind).mockImplementation((cb: Callback) => {
        cb()
      })

      vi.mocked(mockSocket.on).mockImplementation((event: string, cb: Callback) => {
        if (event === 'message') {
          const response = JSON.stringify({
            Id: 'server-2',
            Name: 'Emby Server'
          })
          cb(Buffer.from(response), { address: '192.168.1.101' })
        }
        return mockSocket
      })

      const discoverPromise = service.discoverServers('emby')

      vi.advanceTimersByTime(3000)

      const servers = await discoverPromise

      expect(servers).toHaveLength(1)
      expect(servers[0].address).toBe('http://192.168.1.101:8096')
      expect(servers[0].type).toBe('emby')
    })

    it('should ignore duplicate IDs', async () => {
      vi.mocked(mockSocket.bind).mockImplementation((cb: Callback) => {
        cb()
      })

      vi.mocked(mockSocket.on).mockImplementation((event: string, cb: Callback) => {
        if (event === 'message') {
          const response = JSON.stringify({
            Id: 'server-1',
            Name: 'Jellyfin Server'
          })
          // Call twice with same ID
          cb(Buffer.from(response), { address: '192.168.1.100' })
          cb(Buffer.from(response), { address: '192.168.1.100' })
        }
        return mockSocket
      })

      const discoverPromise = service.discoverServers('jellyfin')

      vi.advanceTimersByTime(3000)

      const servers = await discoverPromise

      expect(servers).toHaveLength(1)
    })

    it('should ignore invalid JSON responses', async () => {
      vi.mocked(mockSocket.bind).mockImplementation((cb: Callback) => {
        cb()
      })

      vi.mocked(mockSocket.on).mockImplementation((event: string, cb: Callback) => {
        if (event === 'message') {
          cb(Buffer.from('not json'), { address: '192.168.1.100' })
        }
        return mockSocket
      })

      const discoverPromise = service.discoverServers('jellyfin')

      vi.advanceTimersByTime(3000)

      const servers = await discoverPromise

      expect(servers).toHaveLength(0)
    })

    it('should handle socket errors', async () => {
      vi.mocked(mockSocket.bind).mockImplementation((cb: Callback) => {
        cb()
      })

      vi.mocked(mockSocket.on).mockImplementation((event: string, cb: Callback) => {
        if (event === 'error') {
          cb(new Error('Socket error'))
        }
        return mockSocket
      })

      const discoverPromise = service.discoverServers('jellyfin')

      vi.advanceTimersByTime(3000)

      const servers = await discoverPromise

      expect(servers).toHaveLength(0)
    })

    it('should handle socket bind exception', async () => {
      vi.mocked(mockSocket.bind).mockImplementation(() => {
        throw new Error('Bind failed')
      })

      const discoverPromise = service.discoverServers('jellyfin')

      vi.advanceTimersByTime(3000)

      const servers = await discoverPromise

      expect(servers).toHaveLength(0)
    })

    it('should handle send exceptions gracefully', async () => {
      vi.mocked(mockSocket.bind).mockImplementation((cb: Callback) => {
        cb()
      })

      vi.mocked(mockSocket.send).mockImplementation(() => {
        throw new Error('Send failed')
      })

      const discoverPromise = service.discoverServers('jellyfin')

      vi.advanceTimersByTime(3000)

      const servers = await discoverPromise

      expect(servers).toHaveLength(0)
    })

    it('should handle socket creation error gracefully', async () => {
      vi.mocked(dgram.createSocket).mockImplementationOnce(() => {
        throw new Error('Socket creation failed')
      })

      const servers = await service.discoverServers('jellyfin')
      expect(servers).toHaveLength(0)
    })

    it('should handle setBroadcast exception gracefully', async () => {
      vi.mocked(mockSocket.bind).mockImplementation((cb: Callback) => {
        cb()
      })

      vi.mocked(mockSocket.setBroadcast).mockImplementation(() => {
        throw new Error('setBroadcast failed')
      })

      const discoverPromise = service.discoverServers('jellyfin')

      vi.advanceTimersByTime(3000)

      const servers = await discoverPromise

      expect(servers).toHaveLength(0)
    })

    it('should handle close exception gracefully', async () => {
      vi.mocked(mockSocket.bind).mockImplementation((cb: Callback) => {
        cb()
      })

      vi.mocked(mockSocket.close).mockImplementation(() => {
        throw new Error('close failed')
      })

      const discoverPromise = service.discoverServers('jellyfin')

      vi.advanceTimersByTime(3000)

      const servers = await discoverPromise
      expect(servers).toHaveLength(0)
    })
  })

  describe('testServerUrl', () => {
    it('should return server info on successful request', async () => {
      vi.mocked(fetchJSON).mockResolvedValueOnce({
        ServerName: 'Test Server',
        Id: 'test-id-123',
        Version: '10.8.10'
      })

      const result = await service.testServerUrl('http://192.168.1.100:8096')

      expect(result).toEqual({
        success: true,
        serverName: 'Test Server',
        serverId: 'test-id-123',
        version: '10.8.10'
      })
      expect(fetchJSON).toHaveBeenCalledWith('http://192.168.1.100:8096/System/Info/Public', {
        timeoutMs: 5000,
        headers: { Accept: 'application/json' },
      })
    })

    it('should handle trailing slash in url', async () => {
      vi.mocked(fetchJSON).mockResolvedValueOnce({
        ServerName: 'Test Server',
        Id: 'test-id-123',
        Version: '10.8.10'
      })

      await service.testServerUrl('http://192.168.1.100:8096/')

      expect(fetchJSON).toHaveBeenCalledWith('http://192.168.1.100:8096/System/Info/Public', {
        timeoutMs: 5000,
        headers: { Accept: 'application/json' },
      })
    })

    it('should return failure info on request error', async () => {
      vi.mocked(fetchJSON).mockRejectedValueOnce(new Error('Network error'))

      const result = await service.testServerUrl('http://192.168.1.100:8096')

      expect(result).toEqual({
        success: false,
        error: 'Network error', // getErrorMessage will extract this
      })
    })

    it('should return default failure info on missing error message', async () => {
      const errorObj = {
        toString: () => ''
      }
      vi.mocked(fetchJSON).mockRejectedValueOnce(errorObj)

      const result = await service.testServerUrl('http://192.168.1.100:8096')

      expect(result).toEqual({
        success: false,
        error: 'Failed to connect',
      })
    })
  })
})
