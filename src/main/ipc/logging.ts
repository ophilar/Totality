import { IPC_CHANNELS } from '../../shared/ipcChannels'
/**
 * Logging IPC Handlers
 *
 * Provides IPC communication for log viewing and export functionality.
 */

import { dialog, BrowserWindow, shell, app } from 'electron'
import { getLoggingService } from '../services/LoggingService'
import type { SourceInfo, DiagnosticInfo } from '../services/LoggingService'
import { getSourceManager } from '../services/SourceManager'
import { getMediaFileAnalyzer } from '../services/MediaFileAnalyzer'
import { getLiveMonitoringService } from '../services/LiveMonitoringService'
import { getDatabase } from '../database/getDatabase'
import { getErrorMessage } from './utils'
import { validateInput, BooleanSchema } from '../validation/schemas'
import { z } from 'zod'
import { createIpcHandler } from './utils/createHandler'

const FileLoggingSettingsSchema = z.object({
  enabled: z.boolean().optional(),
  retentionDays: z.number().int().min(1).max(365).optional(),
})
const RendererLogEventSchema = z.object({
  level: z.enum(['info', 'warn', 'error']),
  source: z.enum(['TVOptimizationUI', 'EncodingCapabilitiesUI']),
  event: z.string().min(1).max(160),
  details: z.record(z.string(), z.unknown()).optional(),
})
import * as fs from 'fs'
import * as path from 'node:path'

async function getSourceInfo(): Promise<SourceInfo[]> {
  const manager = getSourceManager()
  const sources = await manager.getSources()

  return Promise.all(
    sources.map(async (source) => {
      let serverVersion: string | null = null
      const provider = manager.getProvider(source.source_id)
      if (provider) {
        try {
          const test = await Promise.race([
            provider.testConnection(),
            new Promise<null>((resolve) => setTimeout(() => resolve(null), 5000)),
          ])
          if (test?.success) {
            serverVersion = test.serverVersion || null
          }
        } catch {
          // An unreachable source has no server version to report.
        }
      }
      return {
        displayName: source.display_name,
        sourceType: source.source_type,
        serverVersion,
      }
    })
  )
}

async function getDiagnosticInfo(): Promise<DiagnosticInfo> {
  const analyzer = getMediaFileAnalyzer()
  const db = getDatabase()
  const monitoring = getLiveMonitoringService()
  const manager = getSourceManager()

  const [ffAvailable, ffVersion, ffBundled] = await Promise.all([
    analyzer.isAvailable(),
    analyzer.getVersion(),
    analyzer.isBundledVersion(),
  ])

  const dbPath = db.getDbPath()
  const stats = await fs.promises.stat(dbPath)
  const dbSizeMB = Math.round((stats.size / 1024 / 1024) * 10) / 10

  const sources = await manager.getSources()
  const libraries = sources.map((s) => ({
    sourceName: s.display_name,
    sourceType: s.source_type,
    itemCount: db.getMediaItemsCountBySource(s.source_id),
  }))

  return {
    ffprobe: { available: ffAvailable, version: ffVersion, bundled: ffBundled },
    database: { path: path.basename(dbPath), sizeMB: dbSizeMB },
    libraries,
    monitoring: { enabled: monitoring.isMonitoringActive() },
  }
}

export function registerLoggingHandlers(): void {
  createIpcHandler(IPC_CHANNELS.logsRendererEvent, async (payload: unknown) => {
    const event = validateInput(RendererLogEventSchema, payload, 'logs:rendererEvent')
    const logger = getLoggingService()
    const message = event.event.replace(/[\r\n]/g, ' ')
    if (event.details) logger[event.level](`[${event.source}]`, message, event.details)
    else logger[event.level](`[${event.source}]`, message)
  })

  createIpcHandler(IPC_CHANNELS.logsGetAll, async (limit?: unknown) => {
    const validLimit = limit !== undefined ? validateInput(z.number().int().positive().max(100000), limit, 'logs:getAll') : undefined
    return getLoggingService().getLogs(validLimit)
  })

  createIpcHandler(IPC_CHANNELS.logsClear, async () => {
    getLoggingService().clearLogs()
  })

  createIpcHandler(IPC_CHANNELS.logsSetVerbose, async (enabled: unknown) => {
    const validEnabled = validateInput(BooleanSchema, enabled, 'logs:setVerbose')
    getLoggingService().setVerboseLogging(validEnabled)
    return { success: true }
  })

  createIpcHandler(IPC_CHANNELS.logsIsVerbose, async () => {
    return getLoggingService().isVerboseEnabled()
  })

  createIpcHandler(IPC_CHANNELS.logsGetFileLoggingSettings, async () => {
    const db = getDatabase()
    return {
      enabled: db.getSetting('file_logging_enabled') !== 'false',
      retentionDays: parseInt(db.getSetting('log_retention_days') || '7', 10),
    }
  })

  createIpcHandler(IPC_CHANNELS.logsSetFileLoggingSettings, async (settings: unknown) => {
    const valid = validateInput(FileLoggingSettingsSchema, settings, 'logs:setFileLoggingSettings')
    const db = getDatabase()
    if (valid.enabled !== undefined) db.setSetting('file_logging_enabled', String(valid.enabled))
    if (valid.retentionDays !== undefined) db.setSetting('log_retention_days', String(valid.retentionDays))
    getLoggingService().updateFileLoggingSettings(valid)
    return { success: true }
  })

  createIpcHandler(IPC_CHANNELS.logsExport, async () => {
    const win = BrowserWindow.getFocusedWindow()
    if (!win) return { success: false, error: 'No window' }

    const result = await dialog.showSaveDialog(win, {
      title: 'Export Logs',
      defaultPath: `totality-logs-${new Date().toISOString().split('T')[0]}.txt`,
      filters: [
        { name: 'Text Files', extensions: ['txt'] },
        { name: 'JSON Files', extensions: ['json'] },
      ],
    })

    if (result.canceled || !result.filePath) {
      return { success: false, canceled: true }
    }

    try {
      // Gather connected source info and diagnostics
      const [sourceInfo, diagnostics] = await Promise.all([
        getSourceInfo(),
        getDiagnosticInfo(),
      ])

      const isJson = result.filePath.endsWith('.json')
      if (isJson) {
        await getLoggingService().exportLogs(result.filePath, sourceInfo, diagnostics)
      } else {
        await getLoggingService().exportLogsAsText(result.filePath, sourceInfo, diagnostics)
      }
      return { success: true, filePath: result.filePath }
    } catch (error: unknown) {
      return { success: false, error: getErrorMessage(error) }
    }
  })

  createIpcHandler(IPC_CHANNELS.logsOpenLogFolder, async () => {
    const logDir = path.join(app.getPath('userData'), 'logs')
    try {
      await fs.promises.mkdir(logDir, { recursive: true })
      await shell.openPath(logDir)
      return { success: true }
    } catch (error: unknown) {
      return { success: false, error: getErrorMessage(error) }
    }
  })
}
