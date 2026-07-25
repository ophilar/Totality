import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { UdpDiscoveryService } from '../../src/main/services/UdpDiscoveryService'
import * as dgram from 'dgram'

vi.mock('dgram', () => {
  return {
    createSocket: vi.fn()
  }
})

describe('UdpDiscoveryService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should try all broadcast addresses even if send throws an error', async () => {
    const mockSend = vi.fn()

    // Throw an error on the first call, succeed on subsequent calls
    mockSend.mockImplementationOnce(() => {
      throw new Error('EACCES: permission denied')
    })

    const mockSocket = {
      on: vi.fn(),
      bind: vi.fn((cb) => {
        if (cb) cb()
      }),
      setBroadcast: vi.fn(),
      send: mockSend,
      close: vi.fn()
    }

    vi.mocked(dgram.createSocket).mockReturnValue(mockSocket as any)

    const service = new UdpDiscoveryService()
    const discoverPromise = service.discoverServers('jellyfin')

    // Fast-forward the timeout inside discoverServers
    vi.runAllTimers()

    await discoverPromise

    // The service attempts 4 broadcast addresses:
    // ['255.255.255.255', '192.168.255.255', '192.168.1.255', '10.255.255.255']
    expect(mockSend).toHaveBeenCalledTimes(4)

    expect(mockSend).toHaveBeenNthCalledWith(1, expect.any(Buffer), 0, expect.any(Number), 7359, '255.255.255.255')
    expect(mockSend).toHaveBeenNthCalledWith(2, expect.any(Buffer), 0, expect.any(Number), 7359, '192.168.255.255')
    expect(mockSend).toHaveBeenNthCalledWith(3, expect.any(Buffer), 0, expect.any(Number), 7359, '192.168.1.255')
    expect(mockSend).toHaveBeenNthCalledWith(4, expect.any(Buffer), 0, expect.any(Number), 7359, '10.255.255.255')
  })
})
