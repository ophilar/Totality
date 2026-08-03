import { z } from 'zod'
import { IPC_CHANNELS } from '@main/constants/ipcChannels'
import { createValidatedIpcHandler } from '@main/ipc/utils/createHandler'
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
  createValidatedIpcHandler(IPC_CHANNELS.ARR.WAIT_COMMAND, z.tuple([configSchema, z.number().int().positive(), z.object({ pollIntervalMs: z.number().int().positive().max(10000).optional(), timeoutMs: z.number().int().positive().max(180000).optional() }).optional()]), async (config, commandId, options) => service('sonarr', config).waitForCommand(commandId, options))
}
