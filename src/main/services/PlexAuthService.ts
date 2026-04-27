import { PlexProvider } from '@main/providers/plex/PlexProvider'
import { BetterSQLiteService } from '@main/database/getDatabase'
import type { MediaProvider, SourceConfig, ServerInstance, MediaLibrary } from '@main/providers/base/MediaProvider'
import type { MediaSource } from '@main/types/database'

export class PlexAuthService {
  constructor(
    private providers: Map<string, MediaProvider>,
    private db: BetterSQLiteService
  ) {}

  async startAuth(): Promise<{ pinId: number; code: string; authUrl: string }> {
    const tempProvider = new PlexProvider({ sourceId: 'temp-auth', sourceType: 'plex', displayName: 'Temp Auth', connectionConfig: {} })
    const pin = await tempProvider.requestAuthPin()
    return { pinId: pin.id, code: pin.code, authUrl: tempProvider.getAuthUrl(pin.id, pin.code) }
  }

  async completeAuth(pinId: number): Promise<string | null> {
    const tempProvider = new PlexProvider({ sourceId: 'temp-auth', sourceType: 'plex', displayName: 'Temp Auth', connectionConfig: {} })
    return tempProvider.checkAuthPin(pinId)
  }

  async authenticateAndDiscover(token: string, displayName: string): Promise<{ source: MediaSource; servers: ServerInstance[] }> {
    const config: SourceConfig = { sourceType: 'plex', displayName, connectionConfig: { token } }
    const provider = new PlexProvider(config) as PlexProvider
    const authResult = await provider.authenticate({ token })
    if (!authResult.success) throw new Error(authResult.error || 'Authentication failed')
    
    const servers = await provider.discoverServers()
    const sourceId = `${provider.sourceId}`
    
    const sourceRecord: Omit<MediaSource, 'id' | 'created_at' | 'updated_at'> = {
      source_id: sourceId,
      source_type: 'plex',
      display_name: displayName,
      connection_config: JSON.stringify({ token }),
      is_enabled: true,
    }
    await this.db.sources.upsertSource(sourceRecord)
    const source = this.db.sources.getSourceById(sourceId)
    if (!source) throw new Error('Failed to retrieve created source')

    this.providers.set(sourceId, provider)
    return { source, servers }
  }

  async selectServer(sourceId: string, serverId: string): Promise<{ success: boolean; libraries?: MediaLibrary[] }> {
    const provider = this.providers.get(sourceId)
    if (!provider || provider.providerType !== 'plex') throw new Error(`Plex source not found: ${sourceId}`)

    const plexProvider = provider as PlexProvider
    const success = await plexProvider.selectServer(serverId)
    if (!success) return { success: false }

    const server = plexProvider.getSelectedServer()
    if (server) {
      const source = this.db.sources.getSourceById(sourceId)
      if (source) {
        const config = JSON.parse(source.connection_config)
        config.serverId = server.machineIdentifier
        config.serverUrl = server.uri
        await this.db.sources.upsertSource({ ...source, display_name: server.name || source.display_name, connection_config: JSON.stringify(config) })
      }
    }
    return { success: true, libraries: await plexProvider.getLibraries() }
  }
}
