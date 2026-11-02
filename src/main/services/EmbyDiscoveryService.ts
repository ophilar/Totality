
import { getErrorMessage } from './utils/errorUtils'
/**
 * EmbyDiscoveryService
 *
 * Handles automatic discovery of Emby servers on the local network
 * using UDP broadcast on port 7359.
 *
 * Protocol: Send "who is EmbyServer?" to broadcast address,
 * servers respond with JSON containing address, ID, and name.
 */

import { fetchWithTimeout } from './utils/httpClient'
import { discoverMediaServers, type DiscoveredMediaServer } from './MediaServerDiscovery'

export type DiscoveredEmbyServer = DiscoveredMediaServer

const DISCOVERY_MESSAGE = 'who is EmbyServer?'

export class EmbyDiscoveryService {
  /**
   * Discover Emby servers on the local network using UDP broadcast
   */
  async discoverServers(): Promise<DiscoveredEmbyServer[]> {
    return discoverMediaServers(DISCOVERY_MESSAGE, 'Emby')
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
      const response = await fetchWithTimeout(
        `${url.replace(/\/$/, '')}/emby/System/Info/Public`,
        { headers: { Accept: 'application/json' } },
        5000
      )
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const data = await response.json() as { ServerName: string; Id: string; Version: string }

      return {
        success: true,
        serverName: data.ServerName,
        serverId: data.Id,
        version: data.Version,
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
let instance: EmbyDiscoveryService | null = null

export function getEmbyDiscoveryService(): EmbyDiscoveryService {
  if (!instance) {
    instance = new EmbyDiscoveryService()
  }
  return instance
}
