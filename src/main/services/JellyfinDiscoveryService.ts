
import { getErrorMessage } from './utils/errorUtils'
/**
 * JellyfinDiscoveryService
 *
 * Handles automatic discovery of Jellyfin servers on the local network
 * using UDP broadcast on port 7359.
 *
 * Protocol: Send "Who is JellyfinServer?" to broadcast address,
 * servers respond with JSON containing address, ID, and name.
 */

import { fetchWithTimeout } from './utils/httpClient'
import { discoverMediaServers, type DiscoveredMediaServer } from './MediaServerDiscovery'

export type DiscoveredServer = DiscoveredMediaServer

const DISCOVERY_MESSAGE = 'Who is JellyfinServer?'

export class JellyfinDiscoveryService {
  /**
   * Discover Jellyfin servers on the local network using UDP broadcast
   */
  async discoverServers(): Promise<DiscoveredServer[]> {
    return discoverMediaServers(DISCOVERY_MESSAGE, 'Jellyfin')
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
        `${url.replace(/\/$/, '')}/System/Info/Public`,
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
let instance: JellyfinDiscoveryService | null = null

export function getJellyfinDiscoveryService(): JellyfinDiscoveryService {
  if (!instance) {
    instance = new JellyfinDiscoveryService()
  }
  return instance
}
