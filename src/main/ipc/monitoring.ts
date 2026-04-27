/**
 * IPC Handlers for Live Monitoring System
 */

import { ipcMain } from 'electron'
import { getLiveMonitoringService } from '@main/services/LiveMonitoringService'
import { validateInput, MonitoringConfigSchema, SourceIdSchema } from '@main/validation/schemas'
import { getLoggingService } from '@main/services/LoggingService'

export function registerMonitoringHandlers(): void {
  const service = getLiveMonitoringService()

  /**
   * Get monitoring configuration
   */
  ipcMain.handle('monitoring:getConfig', async () => {
    try {
      return service.getConfig()
    } catch (error) {
      getLoggingService().error('[monitoring]', '[IPC monitoring:getConfig] Error:', error)
      throw error
    }
  })

  /**
   * Update monitoring configuration
   */
  ipcMain.handle('monitoring:setConfig', async (_event, config: unknown) => {
    try {
      const validConfig = validateInput(MonitoringConfigSchema, config, 'monitoring:setConfig')
      await service.setConfig(validConfig)
      return { success: true }
    } catch (error) {
      getLoggingService().error('[monitoring]', '[IPC monitoring:setConfig] Error:', error)
      throw error
    }
  })

  /**
   * Start live monitoring
   */
  ipcMain.handle('monitoring:start', async () => {
    try {
      getLoggingService().info('[monitoring]', '[IPC monitoring:start] Live monitoring started')
      service.start()
      return { success: true }
    } catch (error) {
      getLoggingService().error('[monitoring]', '[IPC monitoring:start] Error:', error)
      throw error
    }
  })

  /**
   * Stop live monitoring
   */
  ipcMain.handle('monitoring:stop', async () => {
    try {
      getLoggingService().info('[monitoring]', '[IPC monitoring:stop] Live monitoring stopped')
      service.stop()
      return { success: true }
    } catch (error) {
      getLoggingService().error('[monitoring]', '[IPC monitoring:stop] Error:', error)
      throw error
    }
  })

  /**
   * Check if monitoring is currently active
   */
  ipcMain.handle('monitoring:isActive', async () => {
    try {
      return service.isMonitoringActive()
    } catch (error) {
      getLoggingService().error('[monitoring]', '[IPC monitoring:isActive] Error:', error)
      throw error
    }
  })

  /**
   * Get monitoring status (for debug panel)
   */
  ipcMain.handle('monitoring:getStatus', async () => {
    try {
      return service.getStatus()
    } catch (error) {
      getLoggingService().error('[monitoring]', '[IPC monitoring:getStatus] Error:', error)
      throw error
    }
  })

  /**
   * Force check a specific source immediately
   */
  ipcMain.handle('monitoring:forceCheck', async (_event, sourceId: unknown) => {
    try {
      const validSourceId = validateInput(SourceIdSchema, sourceId, 'monitoring:forceCheck')
      getLoggingService().info('[monitoring]', '[IPC monitoring:forceCheck] Manual check for source:', validSourceId)
      const events = await service.forceCheck(validSourceId)
      return events
    } catch (error) {
      getLoggingService().error('[monitoring]', '[IPC monitoring:forceCheck] Error:', error)
      throw error
    }
  })

  getLoggingService().info('[monitoring]', '[IPC] Monitoring handlers registered')
}
