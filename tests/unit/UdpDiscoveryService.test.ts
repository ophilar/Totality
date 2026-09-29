import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createServer, type Server } from 'node:http'
import { UdpDiscoveryService, getUdpDiscoveryService } from '../../src/main/services/UdpDiscoveryService'
import * as dgram from 'dgram'

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

describe('UdpDiscoveryService', () => {
  let service: UdpDiscoveryService
  let httpServer: Server
  let serverUrl: string
  let responseStatus: number
  let responseBody: unknown
  let requestPath: string | undefined
  let acceptHeader: string | undefined
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
    beforeEach(async () => {
      vi.useRealTimers()
      responseStatus = 200
      responseBody = { ServerName: 'Test Server', Id: 'test-id-123', Version: '10.8.10' }
      httpServer = createServer((request, response) => {
        requestPath = request.url
        acceptHeader = request.headers.accept
        response.writeHead(responseStatus, { 'Content-Type': 'application/json' })
        response.end(JSON.stringify(responseBody))
      })
      await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve))
      const address = httpServer.address()
      if (!address || typeof address === 'string') throw new Error('Loopback HTTP server did not bind')
      serverUrl = `http://127.0.0.1:${address.port}`
    })

    afterEach(async () => {
      await new Promise<void>((resolve, reject) =>
        httpServer.close((error) => error ? reject(error) : resolve())
      )
    })

    it('should return server info on successful request', async () => {
      const result = await service.testServerUrl(serverUrl)

      expect(result).toEqual({
        success: true,
        serverName: 'Test Server',
        serverId: 'test-id-123',
        version: '10.8.10'
      })
      expect(requestPath).toBe('/System/Info/Public')
      expect(acceptHeader).toBe('application/json')
    })

    it('should handle trailing slash in url', async () => {
      await service.testServerUrl(`${serverUrl}/`)
      expect(requestPath).toBe('/System/Info/Public')
    })

    it('should return failure info when the server rejects the request', async () => {
      responseStatus = 503
      responseBody = { message: 'Unavailable' }

      const result = await service.testServerUrl(serverUrl)

      expect(result).toMatchObject({
        success: false,
      })
      expect(result.error).toContain('HTTP 503:')
    })
  })
})
