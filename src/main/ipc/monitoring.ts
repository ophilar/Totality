import { IPC_CHANNELS } from '../../shared/ipcChannels'
/**
 * IPC Handlers for Live Monitoring System
 */

import { getLiveMonitoringService } from '../services/LiveMonitoringService'
import { validateInput, MonitoringConfigSchema, SourceIdSchema } from '../validation/schemas'
import { createIpcHandler } from './utils/createHandler'

export function registerMonitoringHandlers(): void {
  const service = getLiveMonitoringService()

  /**
   * Get monitoring configuration
   */
  createIpcHandler(IPC_CHANNELS.monitoringGetConfig, async () => {
    return service.getConfig()
  })

  /**
   * Update monitoring configuration
   */
  createIpcHandler(IPC_CHANNELS.monitoringSetConfig, async (config: unknown) => {
    const validConfig = validateInput(MonitoringConfigSchema, config, 'monitoring:setConfig')
    await service.setConfig(validConfig)
    return { success: true }
  })

  /**
   * Start live monitoring
   */
  createIpcHandler(IPC_CHANNELS.monitoringStart, async () => {
    console.log('[IPC monitoring:start] Live monitoring started')
    service.start()
    return { success: true }
  })

  /**
   * Stop live monitoring
   */
  createIpcHandler(IPC_CHANNELS.monitoringStop, async () => {
    console.log('[IPC monitoring:stop] Live monitoring stopped')
    service.stop()
    return { success: true }
  })

  /**
   * Check if monitoring is currently active
   */
  createIpcHandler(IPC_CHANNELS.monitoringIsActive, async () => {
    return service.isMonitoringActive()
  })

  /**
   * Get monitoring status (for debug panel)
   */
  createIpcHandler(IPC_CHANNELS.monitoringGetStatus, async () => {
    return service.getStatus()
  })

  /**
   * Force check a specific source immediately
   */
  createIpcHandler(IPC_CHANNELS.monitoringForceCheck, async (sourceId: unknown) => {
    const validSourceId = validateInput(SourceIdSchema, sourceId, 'monitoring:forceCheck')
    console.log('[IPC monitoring:forceCheck] Manual check for source:', validSourceId)
    return service.forceCheck(validSourceId)
  })

  console.log('[IPC] Monitoring handlers registered')
}
