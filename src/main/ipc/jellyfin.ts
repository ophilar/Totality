import { IPC_CHANNELS } from '@main/constants/ipcChannels'
import { getLoggingService } from '@main/services/LoggingService'
import { getUdpDiscoveryService } from '@main/services/UdpDiscoveryService'
import { getSourceManager } from '@main/services/SourceManager'
import { JellyfinProvider } from '@main/providers/jellyfin-emby/JellyfinProvider'
import { JellyfinApiKeyAuthSchema, SafeUrlSchema, JellyfinQcStatusTupleSchema, JellyfinQcCompleteTupleSchema, JellyfinAuthCredentialsTupleSchema } from '@main/validation/schemas'
import { ProviderType } from '@main/types/database'
import { createIpcHandler, createValidatedIpcHandler } from '@main/ipc/utils/createHandler'
import { z } from 'zod'

export function registerJellyfinHandlers(): void {
  const discovery = getUdpDiscoveryService()
  const manager = getSourceManager()

  const registerType = (type: ProviderType.Jellyfin | ProviderType.Emby) => {
    createIpcHandler(`${type}:discoverServers`, async () => discovery.discoverServers(type))
    createValidatedIpcHandler(`${type}:testServerUrl`, SafeUrlSchema, async (url) => discovery.testServerUrl(url))
    createValidatedIpcHandler(`${type}:authenticateApiKey`, JellyfinApiKeyAuthSchema, async (config) => {
      const { EmbyProvider } = await import('@main/providers/jellyfin-emby/EmbyProvider')
      const p = new (type === ProviderType.Emby ? EmbyProvider : JellyfinProvider)({ sourceType: type, displayName: config.displayName, connectionConfig: { serverUrl: config.serverUrl, apiKey: config.apiKey } })
      const res = await p.testConnection()
      if (!res.success) return { success: false, error: res.error || 'Connection failed' }
      const source = await manager.addSource({ sourceType: type, displayName: config.displayName, connectionConfig: { serverUrl: config.serverUrl, apiKey: config.apiKey } })
      return { success: true, source, serverName: res.serverName }
    })
  }

  registerType(ProviderType.Jellyfin)
  registerType(ProviderType.Emby)

  createValidatedIpcHandler(IPC_CHANNELS.JELLYFIN.IS_QUICK_CONNECT_ENABLED, z.string().url(), async (url) => {
    return new JellyfinProvider({ sourceId: 'temp', sourceType: ProviderType.Jellyfin, displayName: 'T', connectionConfig: { serverUrl: url } }).isQuickConnectEnabled()
  })

  createValidatedIpcHandler(IPC_CHANNELS.JELLYFIN.INITIATE_QUICK_CONNECT, z.string().url(), async (url) => {
    return new JellyfinProvider({ sourceId: 'temp', sourceType: ProviderType.Jellyfin, displayName: 'T', connectionConfig: { serverUrl: url } }).initiateQuickConnect()
  })

  createValidatedIpcHandler(IPC_CHANNELS.JELLYFIN.CHECK_QUICK_CONNECT_STATUS, JellyfinQcStatusTupleSchema, async (url, secret) => {
    return new JellyfinProvider({ sourceId: 'temp', sourceType: ProviderType.Jellyfin, displayName: 'T', connectionConfig: { serverUrl: url } }).checkQuickConnectStatus(secret)
  })

  createValidatedIpcHandler(IPC_CHANNELS.JELLYFIN.COMPLETE_QUICK_CONNECT, JellyfinQcCompleteTupleSchema, async (url, secret, name) => {
    const p = new JellyfinProvider({ sourceType: ProviderType.Jellyfin, displayName: name, connectionConfig: { serverUrl: url } })
    const res = await p.completeQuickConnect(secret)
    if (!res.success) throw new Error(res.error || 'Failed')
    const source = await manager.addSource({ sourceType: ProviderType.Jellyfin, displayName: name, connectionConfig: { serverUrl: url, accessToken: res.token, userId: res.userId } })
    return { success: true, source, userName: res.userName }
  })

  createValidatedIpcHandler(IPC_CHANNELS.JELLYFIN.AUTHENTICATE_CREDENTIALS, JellyfinAuthCredentialsTupleSchema, async (url, user, pass, name, isEmby) => {
    const type = isEmby ? ProviderType.Emby : ProviderType.Jellyfin
    const { EmbyProvider } = await import('@main/providers/jellyfin-emby/EmbyProvider')
    const p = new (isEmby ? EmbyProvider : JellyfinProvider)({ sourceType: type, displayName: name, connectionConfig: { serverUrl: url } })
    const res = await p.authenticate({ serverUrl: url, username: user, password: pass })
    if (!res.success) throw new Error(res.error || 'Failed')
    const source = await manager.addSource({ sourceType: type, displayName: name, connectionConfig: { serverUrl: url, accessToken: res.token, userId: res.userId } })
    return { success: true, source, userName: res.userName }
  })

  getLoggingService().info('[jellyfin]', '[IPC] Unified Jellyfin/Emby handlers registered')
}

