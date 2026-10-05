import { z } from 'zod'
import { IPC_CHANNELS } from '@main/constants/ipcChannels'
import { createValidatedIpcHandler, createValidatedIpcHandlerWithEvent } from '@main/ipc/utils/createHandler'
import { operationRequestRegistry } from '@main/ipc/utils/OperationRequestRegistry'
import { ArrIntegrationService } from '@main/services/ArrIntegrationService'

const configSchema = z.object({ baseUrl: z.string().url(), apiKey: z.string().min(1), timeoutMs: z.number().int().positive().max(60000).optional() })
const kindSchema = z.enum(['sonarr', 'radarr'])
const service = (_kind: 'sonarr' | 'radarr', config: z.infer<typeof configSchema>) => new ArrIntegrationService(config)

export function registerArrHandlers() {
  createValidatedIpcHandler(IPC_CHANNELS.ARR.TEST_CONNECTION, z.tuple([kindSchema, configSchema]), async (kind, config) => service(kind, config).testConnection())
  createValidatedIpcHandler(IPC_CHANNELS.ARR.SEARCH_MOVIE, z.tuple([configSchema, z.number().int().positive()]), async (config, movieId) => service('radarr', config).searchMovie(movieId))
  createValidatedIpcHandler(IPC_CHANNELS.ARR.SEARCH_SERIES, z.tuple([configSchema, z.number().int().positive(), z.number().int().nonnegative().optional(), z.array(z.number().int().positive()).optional()]), async (config, seriesId, seasonNumber, episodeIds) => service('sonarr', config).searchSeries(seriesId, seasonNumber, episodeIds))
  createValidatedIpcHandler(IPC_CHANNELS.ARR.LOOKUP_MOVIE, z.tuple([configSchema, z.number().int().positive()]), async (config, tmdbId) => service('radarr', config).lookupMovieByTmdbId(tmdbId))
  createValidatedIpcHandler(IPC_CHANNELS.ARR.LOOKUP_SERIES, z.tuple([configSchema, z.number().int().positive()]), async (config, tvdbId) => service('sonarr', config).lookupSeriesByTvdbId(tvdbId))
  createValidatedIpcHandler(IPC_CHANNELS.ARR.FIND_MANAGED_MOVIE, z.tuple([configSchema, z.number().int().positive()]), async (config, tmdbId) => service('radarr', config).findManagedMovieByTmdbId(tmdbId))
  createValidatedIpcHandler(IPC_CHANNELS.ARR.FIND_MANAGED_SERIES, z.tuple([configSchema, z.number().int().positive()]), async (config, tvdbId) => service('sonarr', config).findManagedSeriesByTvdbId(tvdbId))
  createValidatedIpcHandler(IPC_CHANNELS.ARR.GET_COMMAND, z.tuple([configSchema, z.number().int().positive()]), async (config, commandId) => service('sonarr', config).getCommand(commandId))
  createValidatedIpcHandlerWithEvent(IPC_CHANNELS.ARR.WAIT_COMMAND, z.tuple([configSchema, z.number().int().positive(), z.object({ pollIntervalMs: z.number().int().positive().max(10000).optional(), timeoutMs: z.number().int().positive().max(180000).optional() }).optional(), z.string().min(1).max(100)]), async (event, config, commandId, options, requestId) => {
    const operation = operationRequestRegistry.register(event.sender, requestId, {
      kind: 'sonarr-wait',
      label: 'Sonarr search',
      context: `Command ${commandId} · accepted remotely; stopping this wait does not cancel the search.`,
    })
    try {
      operation.update({ phase: 'Waiting for Sonarr; the accepted command continues remotely.' })
      const result = await service('sonarr', config).waitForCommand(commandId, options, operation.signal)
      operation.complete('completed', `Sonarr command finished with status ${String(result.status)}.`, result)
      return result
    } catch (error) {
      if (operation.signal.aborted) {
        operation.complete('cancelled', 'Stopped waiting. The Sonarr command continues remotely.')
        return { cancelled: true as const, commandId }
      }
      operation.complete('failed', error instanceof Error ? error.message : 'Sonarr command wait failed.')
      throw error
    } finally {
      operation.dispose()
    }
  })
  createValidatedIpcHandler(IPC_CHANNELS.ARR.GET_LANGUAGE_PROFILES, z.tuple([configSchema]), async (config) => service('sonarr', config).getLanguageProfiles())
  createValidatedIpcHandler(IPC_CHANNELS.ARR.GET_MANAGED_STATE, z.tuple([configSchema, z.number().int().positive()]), async (config, seriesId) => service('sonarr', config).getManagedSeriesState(seriesId))
}
