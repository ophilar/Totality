import { IPC_CHANNELS } from '@main/constants/ipcChannels'
import { getLoggingService } from '@main/services/LoggingService'
/**
 * IPC Handlers for Jellyfin and Emby operations
 *
 * Handles server discovery, Quick Connect, and other shared features.
 */

import { ipcMain } from 'electron'
import { getUdpDiscoveryService } from '@main/services/UdpDiscoveryService'
import { getSourceManager } from '@main/services/SourceManager'
import { JellyfinProvider } from '@main/providers/jellyfin-emby/JellyfinProvider'
import { getErrorMessage } from '@main/ipc/utils/createHandler'
import {
  validateInput,
  JellyfinApiKeyAuthSchema,
  SafeUrlSchema,
} from '@main/validation/schemas'
import { ProviderType } from '@main/types/database'

export function registerJellyfinHandlers(): void {
  const discovery = getUdpDiscoveryService()
  const manager = getSourceManager()

  // ============================================================================
  // SERVER DISCOVERY (Unified)
  // ============================================================================

  /**
   * Discover Jellyfin/Emby servers on the local network via UDP broadcast
   */
  const registerDiscovery = (type: ProviderType.Jellyfin | ProviderType.Emby) => {
    ipcMain.handle(`${type}:discoverServers`, async () => {
      try {
        getLoggingService().info('[IPC]', `Starting ${type} server discovery...`)
        return await discovery.discoverServers(type)
      } catch (error: unknown) {
        getLoggingService().error('[jellyfin]', `Error discovering ${type} servers:`, error)
        throw error
      }
    })

    ipcMain.handle(`${type}:testServerUrl`, async (_event, url: unknown) => {
      try {
        const validatedUrl = validateInput(SafeUrlSchema, url, `${type}:testServerUrl`)
        return await discovery.testServerUrl(validatedUrl)
      } catch (error: unknown) {
        getLoggingService().error('[jellyfin]', `Error testing ${type} server URL:`, error)
        throw error
      }
    })
  }

  registerDiscovery(ProviderType.Jellyfin)
  registerDiscovery(ProviderType.Emby)

  // ============================================================================
  // API KEY AUTHENTICATION
  // ============================================================================

  const registerApiKeyAuth = (type: ProviderType.Jellyfin | ProviderType.Emby) => {
    ipcMain.handle(`${type}:authenticateApiKey`, async (
      _event,
      serverUrl: unknown,
      apiKey: unknown,
      displayName: unknown
    ) => {
      try {
        const validated = validateInput(JellyfinApiKeyAuthSchema, {
          serverUrl,
          apiKey,
          displayName,
        }, `${type}:authenticateApiKey`)

        const { EmbyProvider } = await import('@main/providers/jellyfin-emby/EmbyProvider')
        const ProviderClass = type === ProviderType.Emby ? EmbyProvider : JellyfinProvider

        const provider = new ProviderClass({
          sourceId: undefined,
          sourceType: type,
          displayName: validated.displayName,
          connectionConfig: { serverUrl: validated.serverUrl, apiKey: validated.apiKey },
        })

        const testResult = await provider.testConnection()
        if (!testResult.success) {
          return {
            success: false,
            error: testResult.error || 'Failed to connect with API key',
          }
        }

        const source = await manager.addSource({
          sourceType: type,
          displayName: validated.displayName,
          connectionConfig: {
            serverUrl: validated.serverUrl,
            apiKey: validated.apiKey,
          },
        })

        return {
          success: true,
          source,
          serverName: testResult.serverName,
        }
      } catch (error: unknown) {
        getLoggingService().error('[jellyfin]', `Error authenticating with ${type} API key:`, error)
        return {
          success: false,
          error: getErrorMessage(error) || 'Authentication failed',
        }
      }
    })
  }

  registerApiKeyAuth(ProviderType.Jellyfin)
  registerApiKeyAuth(ProviderType.Emby)

  // ============================================================================
  // QUICK CONNECT (Jellyfin only)
  // ============================================================================

  ipcMain.handle(IPC_CHANNELS.JELLYFIN.IS_QUICK_CONNECT_ENABLED, async (_event, serverUrl: string) => {
    try {
      const tempProvider = new JellyfinProvider({
        sourceId: 'temp-qc-check',
        sourceType: ProviderType.Jellyfin,
        displayName: 'Temp',
        connectionConfig: { serverUrl },
      })
      return await tempProvider.isQuickConnectEnabled()
    } catch (error: unknown) {
      getLoggingService().error('[jellyfin]', 'Error checking Quick Connect:', error)
      return false
    }
  })

  ipcMain.handle(IPC_CHANNELS.JELLYFIN.INITIATE_QUICK_CONNECT, async (_event, serverUrl: string) => {
    try {
      const tempProvider = new JellyfinProvider({
        sourceId: 'temp-qc-init',
        sourceType: ProviderType.Jellyfin,
        displayName: 'Temp',
        connectionConfig: { serverUrl },
      })
      return await tempProvider.initiateQuickConnect()
    } catch (error: unknown) {
      getLoggingService().error('[jellyfin]', 'Error initiating Quick Connect:', error)
      throw error
    }
  })

  ipcMain.handle(IPC_CHANNELS.JELLYFIN.CHECK_QUICK_CONNECT_STATUS, async (_event, serverUrl: string, secret: string) => {
    try {
      const tempProvider = new JellyfinProvider({
        sourceId: 'temp-qc-check',
        sourceType: ProviderType.Jellyfin,
        displayName: 'Temp',
        connectionConfig: { serverUrl },
      })
      return await tempProvider.checkQuickConnectStatus(secret)
    } catch (error: unknown) {
      getLoggingService().error('[jellyfin]', 'Error checking Quick Connect status:', error)
      return { authenticated: false, error: getErrorMessage(error) }
    }
  })

  ipcMain.handle(IPC_CHANNELS.JELLYFIN.COMPLETE_QUICK_CONNECT, async (
    _event,
    serverUrl: string,
    secret: string,
    displayName: string
  ) => {
    try {
      const provider = new JellyfinProvider({
        sourceId: undefined,
        sourceType: ProviderType.Jellyfin,
        displayName,
        connectionConfig: { serverUrl },
      })

      const authResult = await provider.completeQuickConnect(secret)
      if (!authResult.success) {
        throw new Error(authResult.error || 'Quick Connect failed')
      }

      const source = await manager.addSource({
        sourceType: ProviderType.Jellyfin,
        displayName,
        connectionConfig: {
          serverUrl,
          accessToken: authResult.token,
          userId: authResult.userId,
        },
      })

      return {
        success: true,
        source,
        userName: authResult.userName,
      }
    } catch (error: unknown) {
      getLoggingService().error('[jellyfin]', 'Error completing Quick Connect:', error)
      throw error
    }
  })

  // ============================================================================
  // CREDENTIALS AUTHENTICATION (Unified)
  // ============================================================================

  ipcMain.handle(IPC_CHANNELS.JELLYFIN.AUTHENTICATE_CREDENTIALS, async (
    _event,
    serverUrl: string,
    username: string,
    password: string,
    displayName: string,
    isEmby: boolean = false
  ) => {
    try {
      const providerType = isEmby ? ProviderType.Emby : ProviderType.Jellyfin
      const { EmbyProvider } = await import('@main/providers/jellyfin-emby/EmbyProvider')

      const ProviderClass = isEmby ? EmbyProvider : JellyfinProvider
      const provider = new ProviderClass({
        sourceId: undefined,
        sourceType: providerType,
        displayName,
        connectionConfig: { serverUrl },
      })

      const authResult = await provider.authenticate({
        serverUrl,
        username,
        password,
      })

      if (!authResult.success) {
        throw new Error(authResult.error || 'Authentication failed')
      }

      const source = await manager.addSource({
        sourceType: providerType,
        displayName,
        connectionConfig: {
          serverUrl,
          accessToken: authResult.token,
          userId: authResult.userId,
        },
      })

      return {
        success: true,
        source,
        userName: authResult.userName,
      }
    } catch (error: unknown) {
      getLoggingService().error('[jellyfin]', 'Error authenticating with credentials:', error)
      return {
        success: false,
        error: getErrorMessage(error) || 'Authentication failed',
      }
    }
  })

  getLoggingService().info('[jellyfin]', '[IPC] Unified Jellyfin/Emby handlers registered')
}

