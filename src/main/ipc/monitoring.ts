import { IPC_CHANNELS } from '@main/constants/ipcChannels'
import { getLiveMonitoringService } from '@main/services/LiveMonitoringService'
import { MonitoringConfigSchema, SourceIdSchema } from '@main/validation/schemas'
import { getLoggingService } from '@main/services/LoggingService'
import { createIpcHandler, createValidatedIpcHandler } from '@main/ipc/utils/createHandler'

export function registerMonitoringHandlers(): void {
  const service = getLiveMonitoringService()

  createIpcHandler(IPC_CHANNELS.MONITORING.GET_CONFIG, async () => service.getConfig())

  createValidatedIpcHandler(IPC_CHANNELS.MONITORING.SET_CONFIG, MonitoringConfigSchema, async (config) => {
    await service.setConfig(config as any)
    return { success: true }
  })

  createIpcHandler(IPC_CHANNELS.MONITORING.START, async () => {
    await service.start()
    return { success: true }
  })

  createIpcHandler(IPC_CHANNELS.MONITORING.STOP, async () => {
    await service.stop()
    return { success: true }
  })

  createIpcHandler(IPC_CHANNELS.MONITORING.IS_ACTIVE, async () => service.isMonitoringActive())
  createIpcHandler(IPC_CHANNELS.MONITORING.GET_STATUS, async () => service.getStatus())

  createValidatedIpcHandler(IPC_CHANNELS.MONITORING.FORCE_CHECK, SourceIdSchema, async (sourceId) => {
    return await service.forceCheck(sourceId)
  })

  getLoggingService().info('[monitoring]', '[IPC] Monitoring handlers registered')
}

