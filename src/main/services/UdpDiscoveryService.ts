import { getErrorMessage } from './utils/errorUtils'
import * as dgram from 'dgram'
import axios from 'axios'
import { getLoggingService } from '@main/services/LoggingService'

/**
 * UdpDiscoveryService
 *
 * Generic service for automatic discovery of media servers on the local network
 * using UDP broadcast (Jellyfin, Emby, etc.).
 */

export interface DiscoveredServer {
  id: string
  name: string
  address: string
  endpointAddress?: string
  localAddress?: string
  type: 'jellyfin' | 'emby'
}

const DISCOVERY_PORT = 7359
const DISCOVERY_TIMEOUT = 3000 // 3 seconds

export class UdpDiscoveryService {
  /**
   * Discover servers on the local network using UDP broadcast
   */
  async discoverServers(type: 'jellyfin' | 'emby'): Promise<DiscoveredServer[]> {
    const discoveryMessage = type === 'jellyfin' ? 'Who is JellyfinServer?' : 'Who is EmbyServer?'
    const logPrefix = `[${type === 'jellyfin' ? 'Jellyfin' : 'Emby'}Discovery]`

    return new Promise((resolve) => {
      const servers: DiscoveredServer[] = []
      const seenIds = new Set<string>()

      let socket: dgram.Socket | null = null

      try {
        socket = dgram.createSocket({ type: 'udp4', reuseAddr: true })

        socket.on('message', (msg, rinfo) => {
          try {
            const response = JSON.parse(msg.toString())

            // Both respond with: { Id, Name, Address, EndpointAddress? }
            if (response.Id && response.Name && !seenIds.has(response.Id)) {
              seenIds.add(response.Id)

              servers.push({
                id: response.Id,
                name: response.Name,
                address: response.Address || `http://${rinfo.address}:8096`,
                endpointAddress: response.EndpointAddress,
                localAddress: response.LocalAddress,
                type,
              })

              getLoggingService().info('[UdpDiscoveryService]', `${logPrefix} Found server: ${response.Name} at ${response.Address || rinfo.address}`)
            }
          } catch (e) {
            // Ignore invalid responses
            console.debug(`${logPrefix} Invalid response:`, msg.toString().substring(0, 100))
          }
        })

        socket.on('error', (err) => {
          getLoggingService().error('[UdpDiscoveryService]', `${logPrefix} Socket error:`, err.message)
        })

        socket.bind(() => {
          try {
            socket!.setBroadcast(true)

            // Send to broadcast address
            const message = Buffer.from(discoveryMessage)

            // Try multiple broadcast addresses
            const broadcastAddresses = ['255.255.255.255', '192.168.255.255', '192.168.1.255', '10.255.255.255']

            for (const addr of broadcastAddresses) {
              try {
                socket!.send(message, 0, message.length, DISCOVERY_PORT, addr)
              } catch (e) {
                // Ignore errors for specific addresses
              }
            }

            getLoggingService().info('[UdpDiscoveryService]', `${logPrefix} Broadcast sent, waiting for responses...`)
          } catch (e) {
            getLoggingService().error('[UdpDiscoveryService]', `${logPrefix} Failed to send broadcast:`, e)
          }
        })

        // Wait for responses then close
        setTimeout(() => {
          try {
            socket?.close()
          } catch (e) {
            // Ignore close errors
          }
          getLoggingService().info('[UdpDiscoveryService]', `${logPrefix} Discovery complete, found ${servers.length} server(s)`)
          resolve(servers)
        }, DISCOVERY_TIMEOUT)

      } catch (err) {
        getLoggingService().error('[UdpDiscoveryService]', `${logPrefix} Failed to create socket:`, err)
        resolve(servers)
      }
    })
  }

  /**
   * Test if a specific server URL is reachable and get its info
   */
  async testServerUrl(url: string): Promise<{
    success: boolean
    serverName?: string
    serverId?: string
    version?: string
    error?: string
  }> {
    try {
      const response = await axios.get(`${url.replace(/\/$/, '')}/System/Info/Public`, {
        timeout: 5000,
        headers: { Accept: 'application/json' },
      })

      return {
        success: true,
        serverName: response.data.ServerName,
        serverId: response.data.Id,
        version: response.data.Version,
      }
    } catch (error: unknown) {
      return {
        success: false,
        error: getErrorMessage(error) || 'Failed to connect',
      }
    }
  }
}

// Singleton
let instance: UdpDiscoveryService | null = null

export function getUdpDiscoveryService(): UdpDiscoveryService {
  if (!instance) {
    instance = new UdpDiscoveryService()
  }
  return instance
}
