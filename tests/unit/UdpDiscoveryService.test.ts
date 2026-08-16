import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { UdpDiscoveryService, getUdpDiscoveryService } from '../../src/main/services/UdpDiscoveryService'
import * as dgram from 'dgram'
import axios from 'axios'

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

vi.mock('axios', () => {
  return {
    default: {
      get: vi.fn(),
    }
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
      const mockSocket = dgram.createSocket('udp4')

      const onCallbackMap: Record<string, Callback> = {}
      vi.mocked(mockSocket.on).mockImplementation((event: string, cb: Callback) => {
        onCallbackMap[event] = cb
      })

      vi.mocked(mockSocket.bind).mockImplementation((cb: Callback) => {
        cb()
      })

      const discoverPromise = service.discoverServers('jellyfin')

      // Simulate receiving a valid message
      const validMessage = JSON.stringify({
        Id: 'server-id-1',
        Name: 'My Jellyfin Server',
        Address: 'http://192.168.1.100:8096',
        EndpointAddress: '192.168.1.100',
        LocalAddress: 'http://127.0.0.1:8096'
      })
      onCallbackMap['message'](Buffer.from(validMessage), { address: '192.168.1.100' })

      vi.advanceTimersByTime(3000) // DISCOVERY_TIMEOUT

      const servers = await discoverPromise
      expect(servers).toHaveLength(1)
      expect(servers[0]).toEqual({
        id: 'server-id-1',
        name: 'My Jellyfin Server',
        address: 'http://192.168.1.100:8096',
        endpointAddress: '192.168.1.100',
        localAddress: 'http://127.0.0.1:8096',
        type: 'jellyfin',
      })
      expect(mockSocket.send).toHaveBeenCalled()
      expect(mockSocket.close).toHaveBeenCalled()
    })

    it('should fallback to rinfo address if Address is not provided', async () => {
      const mockSocket = dgram.createSocket('udp4')

      const onCallbackMap: Record<string, Callback> = {}
      vi.mocked(mockSocket.on).mockImplementation((event: string, cb: Callback) => {
        onCallbackMap[event] = cb
      })

      vi.mocked(mockSocket.bind).mockImplementation((cb: Callback) => {
        cb()
      })

      const discoverPromise = service.discoverServers('emby')

      const validMessageWithoutAddress = JSON.stringify({
        Id: 'server-id-2',
        Name: 'My Emby Server',
      })
      onCallbackMap['message'](Buffer.from(validMessageWithoutAddress), { address: '192.168.1.101' })

      vi.advanceTimersByTime(3000)

      const servers = await discoverPromise
      expect(servers[0].address).toBe('http://192.168.1.101:8096')
      expect(servers[0].type).toBe('emby')
    })

    it('should ignore duplicate IDs', async () => {
      const mockSocket = dgram.createSocket('udp4')

      const onCallbackMap: Record<string, Callback> = {}
      vi.mocked(mockSocket.on).mockImplementation((event: string, cb: Callback) => {
        onCallbackMap[event] = cb
      })

      vi.mocked(mockSocket.bind).mockImplementation((cb: Callback) => {
        cb()
      })

      const discoverPromise = service.discoverServers('jellyfin')

      const validMessage = JSON.stringify({
        Id: 'server-id-1',
        Name: 'My Jellyfin Server',
      })

      onCallbackMap['message'](Buffer.from(validMessage), { address: '192.168.1.100' })
      // Send the exact same message again
      onCallbackMap['message'](Buffer.from(validMessage), { address: '192.168.1.100' })

      vi.advanceTimersByTime(3000)

      const servers = await discoverPromise
      expect(servers).toHaveLength(1) // Duplicate ignored
    })

    it('should ignore invalid JSON responses', async () => {
      const mockSocket = dgram.createSocket('udp4')

      const onCallbackMap: Record<string, Callback> = {}
      vi.mocked(mockSocket.on).mockImplementation((event: string, cb: Callback) => {
        onCallbackMap[event] = cb
      })

      vi.mocked(mockSocket.bind).mockImplementation((cb: Callback) => {
        cb()
      })

      // We need to mock console.debug because the code calls it
      const consoleSpy = vi.spyOn(console, 'debug').mockImplementation(() => {})

      const discoverPromise = service.discoverServers('jellyfin')

      onCallbackMap['message'](Buffer.from('not valid json'), { address: '192.168.1.100' })

      vi.advanceTimersByTime(3000)

      const servers = await discoverPromise
      expect(servers).toHaveLength(0)
      expect(consoleSpy).toHaveBeenCalledWith('[JellyfinDiscovery] Invalid response:', 'not valid json')

      consoleSpy.mockRestore()
    })

    it('should handle socket errors', async () => {
       const mockSocket = dgram.createSocket('udp4')

      const onCallbackMap: Record<string, Callback> = {}
      vi.mocked(mockSocket.on).mockImplementation((event: string, cb: Callback) => {
        onCallbackMap[event] = cb
      })

      vi.mocked(mockSocket.bind).mockImplementation((cb: Callback) => {
        cb()
      })

      const discoverPromise = service.discoverServers('jellyfin')

      // Simulate error
      onCallbackMap['error'](new Error('Socket explosion'))

      vi.advanceTimersByTime(3000)

      const servers = await discoverPromise
      expect(servers).toHaveLength(0) // Resolves normally despite error
    })

    it('should handle socket bind exception', async () => {
      const mockSocket = dgram.createSocket('udp4')

      vi.mocked(mockSocket.bind).mockImplementation((cb: Callback) => {
         throw new Error('Bind failed')
      })

      const discoverPromise = service.discoverServers('jellyfin')

      vi.advanceTimersByTime(3000)

      const servers = await discoverPromise
      expect(servers).toHaveLength(0)
    })

    it('should handle send exceptions gracefully', async () => {
       const mockSocket = dgram.createSocket('udp4')

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
         throw new Error('Failed to create')
       })

      const servers = await service.discoverServers('jellyfin')
      expect(servers).toHaveLength(0)
    })

    it('should handle setBroadcast exception gracefully', async () => {
      const mockSocket = dgram.createSocket('udp4')

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
      const mockSocket = dgram.createSocket('udp4')

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
      vi.mocked(axios.get).mockResolvedValueOnce({
        data: {
          ServerName: 'Test Server',
          Id: 'test-id-123',
          Version: '10.8.10'
        }
      })

      const result = await service.testServerUrl('http://192.168.1.100:8096')

      expect(result).toEqual({
        success: true,
        serverName: 'Test Server',
        serverId: 'test-id-123',
        version: '10.8.10'
      })
      expect(axios.get).toHaveBeenCalledWith('http://192.168.1.100:8096/System/Info/Public', {
        timeout: 5000,
        headers: { Accept: 'application/json' },
      })
    })

    it('should handle trailing slash in url', async () => {
      vi.mocked(axios.get).mockResolvedValueOnce({
        data: {
          ServerName: 'Test Server',
          Id: 'test-id-123',
          Version: '10.8.10'
        }
      })

      await service.testServerUrl('http://192.168.1.100:8096/')

      expect(axios.get).toHaveBeenCalledWith('http://192.168.1.100:8096/System/Info/Public', {
        timeout: 5000,
        headers: { Accept: 'application/json' },
      })
    })

    it('should return failure info on request error', async () => {
      vi.mocked(axios.get).mockRejectedValueOnce(new Error('Network error'))

      const result = await service.testServerUrl('http://192.168.1.100:8096')

      expect(result).toEqual({
        success: false,
        error: 'Network error', // getErrorMessage will extract this
      })
    })

    it('should return default failure info on missing error message', async () => {
      // getErrorMessage falls back to String(error) which will return "[object Object]"
      // when passing an empty object, so it will not return an empty string and fallback to "Failed to connect"
      // Therefore, I will mock getErrorMessage to return empty string to test the fallback,
      // Or I can test an object with custom toString that returns empty string.
      const errorObj = {
        toString: () => ''
      }
      vi.mocked(axios.get).mockRejectedValueOnce(errorObj)

      const result = await service.testServerUrl('http://192.168.1.100:8096')

      expect(result).toEqual({
        success: false,
        error: 'Failed to connect',
      })
    })
  })
})
