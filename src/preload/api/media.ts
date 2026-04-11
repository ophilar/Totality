import { ipcRenderer } from 'electron'

export const mediaApi = {
  // Quality Analysis
  qualityAnalyzeAll: () => ipcRenderer.invoke('quality:analyzeAll'),
  qualityGetDistribution: () => ipcRenderer.invoke('quality:getDistribution'),
  qualityGetRecommendedFormat: (mediaItemId: number) =>
    ipcRenderer.invoke('quality:getRecommendedFormat', mediaItemId),
  onQualityAnalysisProgress: (callback: (progress: unknown) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, progress: unknown) => callback(progress)
    ipcRenderer.on('quality:analysisProgress', handler)
    return () => ipcRenderer.removeListener('quality:analysisProgress', handler)
  },

  // Database - Media Items
  getMediaItems: (filters?: unknown) => ipcRenderer.invoke('db:getMediaItems', filters),
  countMediaItems: (filters?: unknown) => ipcRenderer.invoke('db:countMediaItems', filters),
  getTVShows: (filters?: unknown) => ipcRenderer.invoke('db:getTVShows', filters),
  countTVShows: (filters?: unknown) => ipcRenderer.invoke('db:countTVShows', filters),
  countTVEpisodes: (filters?: unknown) => ipcRenderer.invoke('db:countTVEpisodes', filters),
  getLetterOffset: (params: { table: 'movies' | 'tvshows' | 'artists' | 'albums'; letter: string; sourceId?: string; libraryId?: string }) =>
    ipcRenderer.invoke('db:getLetterOffset', params),
  getMediaItemById: (id: number) => ipcRenderer.invoke('db:getMediaItemById', id),
  upsertMediaItem: (item: unknown) => ipcRenderer.invoke('db:upsertMediaItem', item),
  deleteMediaItem: (id: number) => ipcRenderer.invoke('db:deleteMediaItem', id),
  getMediaItemVersions: (mediaItemId: number) => ipcRenderer.invoke('db:getMediaItemVersions', mediaItemId),

  // Database - Quality Scores
  getQualityScores: () => ipcRenderer.invoke('db:getQualityScores'),
  getQualityScoreByMediaId: (mediaItemId: number) =>
    ipcRenderer.invoke('db:getQualityScoreByMediaId', mediaItemId),
  upsertQualityScore: (score: unknown) => ipcRenderer.invoke('db:upsertQualityScore', score),

  // Database - Settings
  getSetting: (key: string) => ipcRenderer.invoke('db:getSetting', key),
  setSetting: (key: string, value: string) => ipcRenderer.invoke('db:setSetting', key, value),
  getAllSettings: () => ipcRenderer.invoke('db:getAllSettings'),

  // Library Protection
  dbSetLibraryProtected: (sourceId: string, libraryId: string, isProtected: boolean) => 
    ipcRenderer.invoke('db:setLibraryProtected', sourceId, libraryId, isProtected),
  dbVerifyPin: (pin: string) => ipcRenderer.invoke('db:verifyPin', pin),
  dbSetPin: (pin: string) => ipcRenderer.invoke('db:setPin', pin),
  dbHasPin: () => ipcRenderer.invoke('db:hasPin'),

  // NFS Mount Mappings (for Kodi)
  getNfsMappings: () => ipcRenderer.invoke('settings:getNfsMappings'),
  setNfsMappings: (mappings: Record<string, string>) => ipcRenderer.invoke('settings:setNfsMappings', mappings),
  testNfsMapping: (nfsPath: string, localPath: string) => ipcRenderer.invoke('settings:testNfsMapping', nfsPath, localPath),

  // Settings Change Events
  onSettingsChanged: (callback: (data: { key: string; hasValue: boolean }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: { key: string; hasValue: boolean }) => callback(data)
    ipcRenderer.on('settings:changed', handler)
    return () => ipcRenderer.removeListener('settings:changed', handler)
  },

  // Database - Data Management
  dbGetPath: () => ipcRenderer.invoke('db:getPath'),
  dbExport: () => ipcRenderer.invoke('db:export'),
  dbExportCSV: (options: {
    includeUpgrades: boolean
    includeMissingMovies: boolean
    includeMissingEpisodes: boolean
    includeMissingAlbums: boolean
  }) => ipcRenderer.invoke('db:exportCSV', options),
  dbImport: () => ipcRenderer.invoke('db:import'),
  dbReset: () => ipcRenderer.invoke('db:reset'),
  dbOpenFolder: () => ipcRenderer.invoke('db:openFolder'),

  // Series Completeness
  seriesAnalyzeAll: (sourceId?: string, libraryId?: string) => ipcRenderer.invoke('series:analyzeAll', sourceId, libraryId),
  seriesAnalyze: (seriesTitle: string) => ipcRenderer.invoke('series:analyze', seriesTitle),
  seriesGetAll: (sourceId?: string) => ipcRenderer.invoke('series:getAll', sourceId),
  seriesGetIncomplete: (sourceId?: string) => ipcRenderer.invoke('series:getIncomplete', sourceId),
  seriesGetStats: () => ipcRenderer.invoke('series:getStats'),
  seriesGetEpisodes: (seriesTitle: string, sourceId?: string) => ipcRenderer.invoke('series:getEpisodes', seriesTitle, sourceId),
  seriesDelete: (id: number) => ipcRenderer.invoke('series:delete', id),
  seriesGetSeasonDetails: (tmdbId: string, seasonNumber: number) =>
    ipcRenderer.invoke('series:getSeasonDetails', tmdbId, seasonNumber),
  seriesGetSeasonPoster: (tmdbId: string, seasonNumber: number) =>
    ipcRenderer.invoke('series:getSeasonPoster', tmdbId, seasonNumber),
  seriesGetEpisodeStill: (tmdbId: string, seasonNumber: number, episodeNumber: number) =>
    ipcRenderer.invoke('series:getEpisodeStill', tmdbId, seasonNumber, episodeNumber),
  seriesCancelAnalysis: () => ipcRenderer.invoke('series:cancelAnalysis'),
  onSeriesProgress: (callback: (progress: unknown) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, progress: unknown) => callback(progress)
    ipcRenderer.on('series:progress', handler)
    return () => ipcRenderer.removeListener('series:progress', handler)
  },

  // Series Match Fixing
  seriesSearchTMDB: (query: string) => ipcRenderer.invoke('series:searchTMDB', query),
  seriesFixMatch: (seriesTitle: string, sourceId: string, tmdbId: number) =>
    ipcRenderer.invoke('series:fixMatch', seriesTitle, sourceId, tmdbId),

  // Movie Match Fixing
  movieSearchTMDB: (query: string, year?: number) => ipcRenderer.invoke('movie:searchTMDB', query, year),
  movieFixMatch: (mediaItemId: number, tmdbId: number) =>
    ipcRenderer.invoke('movie:fixMatch', mediaItemId, tmdbId),

  // TMDB Metadata
  tmdbGetTVShowDetails: (tmdbId: string) => ipcRenderer.invoke('tmdb:getTVShowDetails', tmdbId),
  tmdbGetMovieDetails: (tmdbId: string) => ipcRenderer.invoke('tmdb:getMovieDetails', tmdbId),

  // Movie Collections
  collectionsAnalyzeAll: (sourceId?: string, libraryId?: string) => ipcRenderer.invoke('collections:analyzeAll', sourceId, libraryId),
  collectionsGetAll: (sourceId?: string) => ipcRenderer.invoke('collections:getAll', sourceId),
  collectionsGetIncomplete: (sourceId?: string) => ipcRenderer.invoke('collections:getIncomplete', sourceId),
  collectionsGetStats: () => ipcRenderer.invoke('collections:getStats'),
  collectionsDelete: (id: number) => ipcRenderer.invoke('collections:delete', id),
  collectionsCancelAnalysis: () => ipcRenderer.invoke('collections:cancelAnalysis'),
  onCollectionsProgress: (callback: (progress: unknown) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, progress: unknown) => callback(progress)
    ipcRenderer.on('collections:progress', handler)
    return () => ipcRenderer.removeListener('collections:progress', handler)
  },

  // Database - Statistics
  getLibraryStats: (sourceId?: string) => ipcRenderer.invoke('db:getLibraryStats', sourceId),
  getDashboardSummary: (sourceId?: string) => ipcRenderer.invoke('db:getDashboardSummary', sourceId),

  // Database - Global Search
  mediaSearch: (query: string) => ipcRenderer.invoke('media:search', query),

  // Database - Exclusions
  addExclusion: (exclusionType: string, referenceId?: number, referenceKey?: string, parentKey?: string, title?: string) =>
    ipcRenderer.invoke('db:addExclusion', exclusionType, referenceId, referenceKey, parentKey, title),
  removeExclusion: (id: number) => ipcRenderer.invoke('db:removeExclusion', id),
  getExclusions: (exclusionType?: string, parentKey?: string) =>
    ipcRenderer.invoke('db:getExclusions', exclusionType, parentKey),
}

export interface MediaAPI {
  // Quality Analysis
  qualityAnalyzeAll: () => Promise<number>
  qualityGetDistribution: () => Promise<{
    byTier: {
      [tier: string]: { low: number; medium: number; high: number }
    }
    byQuality: {
      low: number
      medium: number
      high: number
    }
  }>
  qualityGetRecommendedFormat: (mediaItemId: number) => Promise<string>
  onQualityAnalysisProgress: (callback: (progress: unknown) => void) => () => void

  // Database - Media Items
  getMediaItems: (filters?: unknown) => Promise<any[]>
  countMediaItems: (filters?: unknown) => Promise<number>
  getTVShows: (filters?: unknown) => Promise<unknown[]>
  countTVShows: (filters?: unknown) => Promise<number>
  countTVEpisodes: (filters?: unknown) => Promise<number>
  getLetterOffset: (params: { table: 'movies' | 'tvshows' | 'artists' | 'albums'; letter: string; sourceId?: string; libraryId?: string }) => Promise<number>
  getMediaItemById: (id: number) => Promise<unknown | null>
  upsertMediaItem: (item: unknown) => Promise<number>
  deleteMediaItem: (id: number) => Promise<boolean>
  getMediaItemVersions: (mediaItemId: number) => Promise<unknown[]>

  // Database - Quality Scores
  getQualityScores: () => Promise<unknown[]>
  getQualityScoreByMediaId: (mediaItemId: number) => Promise<unknown | null>
  upsertQualityScore: (score: unknown) => Promise<number>

  // Database - Settings
  getSetting: (key: string) => Promise<string | null>
  setSetting: (key: string, value: string) => Promise<boolean>
  getAllSettings: () => Promise<Record<string, string>>

  // Library Protection
  dbSetLibraryProtected: (sourceId: string, libraryId: string, isProtected: boolean) => Promise<boolean>
  dbVerifyPin: (pin: string) => Promise<boolean>
  dbSetPin: (pin: string) => Promise<boolean>
  dbHasPin: () => Promise<boolean>

  // NFS Mount Mappings (for Kodi)
  getNfsMappings: () => Promise<Record<string, string>>
  setNfsMappings: (mappings: Record<string, string>) => Promise<boolean>
  testNfsMapping: (nfsPath: string, localPath: string) => Promise<{
    success: boolean
    error?: string
    folderCount?: number
    fileCount?: number
    message?: string
  }>

  // Settings Change Events
  onSettingsChanged: (callback: (data: { key: string; hasValue: boolean }) => void) => () => void

  // Database - Data Management
  dbGetPath: () => Promise<string>
  dbExport: () => Promise<{ success: boolean; path?: string; cancelled?: boolean }>
  dbExportCSV: (options: {
    includeUpgrades: boolean
    includeMissingMovies: boolean
    includeMissingEpisodes: boolean
    includeMissingAlbums: boolean
  }) => Promise<{ success: boolean; path?: string; cancelled?: boolean }>
  dbImport: () => Promise<{ success: boolean; imported?: number; errors?: string[]; cancelled?: boolean }>
  dbReset: () => Promise<{ success: boolean }>
  dbOpenFolder: () => Promise<{ success: boolean }>

  // Series Completeness
  seriesAnalyzeAll: (sourceId?: string, libraryId?: string) => Promise<{ completed: boolean; analyzed: number }>
  seriesAnalyze: (seriesTitle: string) => Promise<unknown | null>
  seriesGetAll: (sourceId?: string) => Promise<unknown[]>
  seriesGetIncomplete: (sourceId?: string) => Promise<unknown[]>
  seriesGetStats: () => Promise<{
    totalSeries: number
    completeSeries: number
    incompleteSeries: number
    totalMissingEpisodes: number
    averageCompleteness: number
  }>
  seriesGetEpisodes: (seriesTitle: string, sourceId?: string) => Promise<unknown[]>
  seriesDelete: (id: number) => Promise<boolean>
  seriesGetSeasonDetails: (tmdbId: string, seasonNumber: number) => Promise<{
    overview: string | null
    episodeCount: number
    airDate: string | null
    name: string | null
  } | null>
  seriesGetSeasonPoster: (tmdbId: string, seasonNumber: number) => Promise<string | null>
  seriesGetEpisodeStill: (tmdbId: string, seasonNumber: number, episodeNumber: number) => Promise<string | null>
  seriesCancelAnalysis: () => Promise<{ success: boolean }>
  onSeriesProgress: (callback: (progress: unknown) => void) => () => void

  // Series Match Fixing
  seriesSearchTMDB: (query: string) => Promise<Array<{
    id: number
    name: string
    first_air_date: string
    overview: string
    poster_url: string | null
    vote_average: number
  }>>
  seriesFixMatch: (seriesTitle: string, sourceId: string, tmdbId: number) => Promise<{
    success: boolean
    updatedEpisodes: number
    completeness: unknown
  }>

  // Movie Match Fixing
  movieSearchTMDB: (query: string, year?: number) => Promise<Array<{
    id: number
    title: string
    release_date: string
    overview: string
    poster_url: string | null
    vote_average: number
  }>>
  movieFixMatch: (mediaItemId: number, tmdbId: number) => Promise<{
    success: boolean
    tmdbId: number
    posterUrl?: string
    title: string
  }>

  // TMDB Metadata
  tmdbGetTVShowDetails: (tmdbId: string) => Promise<{ overview: string | null } | null>
  tmdbGetMovieDetails: (tmdbId: string) => Promise<{
    overview: string | null
    releaseDate: string | null
    runtime: number | null
  } | null>

  // Movie Collections
  collectionsAnalyzeAll: (sourceId?: string, libraryId?: string) => Promise<{ success: boolean; completed: boolean; analyzed: number }>
  collectionsGetAll: (sourceId?: string) => Promise<unknown[]>
  collectionsGetIncomplete: (sourceId?: string) => Promise<unknown[]>
  collectionsGetStats: () => Promise<{
    total: number
    complete: number
    incomplete: number
    totalMissing: number
    avgCompleteness: number
  }>
  collectionsDelete: (id: number) => Promise<boolean>
  collectionsCancelAnalysis: () => Promise<{ success: boolean }>
  onCollectionsProgress: (callback: (progress: unknown) => void) => () => void

  // Database - Statistics
  getLibraryStats: (sourceId?: string) => Promise<{
    totalItems: number
    totalMovies: number
    totalEpisodes: number
    totalShows: number
    lowQualityCount: number
    needsUpgradeCount: number
    averageQualityScore: number
    movieNeedsUpgradeCount: number
    movieAverageQualityScore: number
    tvNeedsUpgradeCount: number
    tvAverageQualityScore: number
  }>
  getDashboardSummary: (sourceId?: string) => Promise<any>

  // Database - Global Search
  mediaSearch: (query: string) => Promise<{
    movies: Array<{ id: number; title: string; year?: number; poster_url?: string }>
    tvShows: Array<{ id: number; title: string; poster_url?: string }>
    episodes: Array<{ id: number; title: string; series_title: string; season_number: number; episode_number: number; poster_url?: string }>
    artists: Array<{ id: number; name: string; thumb_url?: string }>
    albums: Array<{ id: number; title: string; artist_name: string; year?: number; thumb_url?: string }>
    tracks: Array<{ id: number; title: string; album_id?: number; album_title?: string; artist_name?: string }>
  }>

  // Exclusions
  addExclusion: (exclusionType: string, referenceId?: number, referenceKey?: string, parentKey?: string, title?: string) => Promise<number>
  removeExclusion: (id: number) => Promise<void>
  getExclusions: (exclusionType?: string, parentKey?: string) => Promise<Array<{
    id: number; exclusion_type: string; reference_id: number | null; reference_key: string | null
    parent_key: string | null; title: string | null; created_at: string
  }>>
}
