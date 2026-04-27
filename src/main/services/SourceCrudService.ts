import { BetterSQLiteService } from '@main/database/getDatabase'
import { LoggingService, getLoggingService } from './LoggingService'
import { createProvider } from '@main/providers/ProviderFactory'
import type { MediaProvider, ProviderType, SourceConfig } from '@main/providers/base/MediaProvider'
import type { MediaSource } from '@main/types/database'
import { app } from 'electron'
import * as path from 'path'
import * as fs from 'fs/promises'

export class SourceCrudService {
  constructor(
    private db: BetterSQLiteService,
    private providers: Map<string, MediaProvider>,
    private logging: LoggingService = getLoggingService()
  ) {}

  async addSource(config: SourceConfig): Promise<MediaSource> {
    const sourceId = config.sourceId || this.generateSourceId(config.sourceType)
    const provider = createProvider(config.sourceType, { ...config, sourceId })

    const sourceRecord: Omit<MediaSource, 'id' | 'created_at' | 'updated_at'> = {
      source_id: sourceId,
      source_type: config.sourceType,
      display_name: config.displayName,
      connection_config: JSON.stringify(config.connectionConfig),
      is_enabled: config.isEnabled !== false,
    }

    await this.db.sources.upsertSource(sourceRecord)
    this.providers.set(sourceId, provider)

    const source = this.db.sources.getSourceById(sourceId)
    if (!source) throw new Error('Failed to retrieve created source')

    this.logging.info('[SourceCrudService]', `Added source: ${config.displayName} (${sourceId})`)
    return source
  }

  async updateSource(sourceId: string, updates: Partial<SourceConfig>): Promise<void> {
    const existing = this.db.sources.getSourceById(sourceId)
    if (!existing) throw new Error(`Source not found: ${sourceId}`)

    const updatedSource: Omit<MediaSource, 'id' | 'created_at' | 'updated_at'> = {
      source_id: sourceId,
      source_type: updates.sourceType || existing.source_type,
      display_name: updates.displayName || existing.display_name,
      connection_config: updates.connectionConfig ? JSON.stringify(updates.connectionConfig) : existing.connection_config,
      is_enabled: updates.isEnabled !== undefined ? updates.isEnabled : !!existing.is_enabled,
    }

    await this.db.sources.upsertSource(updatedSource)

    if (updates.connectionConfig) {
      const config: SourceConfig = {
        sourceId,
        sourceType: updatedSource.source_type as ProviderType,
        displayName: updatedSource.display_name,
        connectionConfig: updates.connectionConfig,
        isEnabled: !!updatedSource.is_enabled,
      }
      this.providers.set(sourceId, createProvider(updatedSource.source_type as ProviderType, config))
    }

    this.logging.info('[SourceCrudService]', `Updated source: ${sourceId}`)
  }

  async removeSource(sourceId: string, onRemove?: (id: string) => void): Promise<void> {
    if (onRemove) onRemove(sourceId)
    this.providers.delete(sourceId)
    this.db.sources.deleteSource(sourceId)
    await this.cleanupArtworkCache(sourceId)
    this.logging.info('[SourceCrudService]', `Removed source: ${sourceId}`)
  }

  private async cleanupArtworkCache(sourceId: string): Promise<void> {
    const artworkPath = path.join(app.getPath('userData'), 'artwork', sourceId)
    try {
      await fs.rm(artworkPath, { recursive: true, force: true })
    } catch { /* ignore */ }
  }

  private generateSourceId(type: ProviderType): string {
    return `${type}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
  }
}
