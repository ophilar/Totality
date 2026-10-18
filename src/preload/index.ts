import { IPC_CHANNELS } from '../shared/ipcChannels'
import { contextBridge, ipcRenderer } from 'electron'
// Import shared types from main process (type-only, no runtime code)
import type { ConnectionTestResult } from '@main/types/ipc'
import type { TimelineRecipeSummary } from '@main/services/timelines/ITimelineRecipeProvider'
import type { ResolvedTimelineResult } from '@main/services/timelines/TimelineResolutionEngine'
import type { TimelineParserPlugin, TimelineParserPluginInput } from '@main/services/timelines/TimelineParserPlugin'
import type { TimelineFetchOptions, TimelineDefinition } from '@main/services/timelines/ITimelineRecipeProvider'
import type { PlexPlaylistSummary, PlexPlaylistSyncResult } from '@main/services/timelines/PlexPlaylistSyncService'
import type { TranscodingCapabilities } from '@main/services/TranscodingCapabilities'
import type { TranscodeOptions } from '@main/services/TranscodingService'
import type { MediaDuplicate, MediaSource as DatabaseMediaSource, WishlistFilters, WishlistItem } from '@main/types/database'
import type { ActivityLogEntry, QueueState, QueuedTask, TaskDefinition, TaskQueueHistory } from '@main/types/taskQueue'
import type { DuplicateResolutionOutcome } from '@shared/duplicateResolution'
import type { ActivityOperation } from '@main/ipc/utils/OperationRequestRegistry'
import type { PlaybackTargetProfile, PlaybackTargetDefinition } from '@main/types/playbackTarget'
import type { PlaybackCompatibilityResult } from '@main/services/PlaybackCompatibilityService'

// Re-export for consumers of this module
export type { ConnectionTestResult } from '@main/types/ipc'

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
const electronAPI = {
  // App lifecycle
  appReady: () => ipcRenderer.send(IPC_CHANNELS.appReady),
  getAppVersion: () => ipcRenderer.invoke(IPC_CHANNELS.appGetVersion),
  openExternal: (url: string) => ipcRenderer.invoke(IPC_CHANNELS.appOpenExternal, url),

  // ============================================================================
  // MEDIA SOURCES (Multi-Provider Support)
  // ============================================================================

  // Source CRUD
  sourcesAdd: (config: {
    sourceType: string
    displayName: string
    connectionConfig: Record<string, unknown>
    isEnabled?: boolean
  }) => ipcRenderer.invoke(IPC_CHANNELS.sourcesAdd, config),
  sourcesUpdate: (sourceId: string, updates: {
    displayName?: string
    connectionConfig?: Record<string, unknown>
    isEnabled?: boolean
  }) => ipcRenderer.invoke(IPC_CHANNELS.sourcesUpdate, sourceId, updates),
  sourcesRemove: (sourceId: string) => ipcRenderer.invoke(IPC_CHANNELS.sourcesRemove, sourceId),
  sourcesList: (type?: string) => ipcRenderer.invoke(IPC_CHANNELS.sourcesList, type),
  sourcesGet: (sourceId: string) => ipcRenderer.invoke(IPC_CHANNELS.sourcesGet, sourceId),
  sourcesGetEnabled: () => ipcRenderer.invoke(IPC_CHANNELS.sourcesGetEnabled),
  sourcesToggle: (sourceId: string, enabled: boolean) =>
    ipcRenderer.invoke(IPC_CHANNELS.sourcesToggle, sourceId, enabled),

  // Connection Testing
  sourcesTestConnection: (sourceId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.sourcesTestConnection, sourceId),

  // Plex-specific Auth (new flow for multi-source)
  plexStartAuth: () => ipcRenderer.invoke(IPC_CHANNELS.plexStartAuth),
  plexCheckAuth: (pinId: number) => ipcRenderer.invoke(IPC_CHANNELS.plexCheckAuth, pinId),
  plexAuthenticateAndDiscover: (token: string, displayName: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.plexAuthenticateAndDiscover, token, displayName),
  plexSelectServerForSource: (sourceId: string, serverId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.plexSelectServer, sourceId, serverId),
  plexGetServersForSource: (sourceId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.plexGetServers, sourceId),

  // Library Operations
  sourcesGetLibraries: (sourceId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.sourcesGetLibraries, sourceId),
  sourcesGetLibrariesWithStatus: (sourceId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.sourcesGetLibrariesWithStatus, sourceId),
  sourcesToggleLibrary: (sourceId: string, libraryId: string, enabled: boolean) =>
    ipcRenderer.invoke(IPC_CHANNELS.sourcesToggleLibrary, sourceId, libraryId, enabled),
  sourcesSetLibraryUpgradeTier: (sourceId: string, libraryId: string, minTier: string | null) =>
    ipcRenderer.invoke(IPC_CHANNELS.sourcesSetLibraryUpgradeTier, sourceId, libraryId, minTier),
  sourcesSetLibrariesEnabled: (sourceId: string, libraries: Array<{
    id: string
    name: string
    type: string
    enabled: boolean
  }>) => ipcRenderer.invoke(IPC_CHANNELS.sourcesSetLibrariesEnabled, sourceId, libraries),
  sourcesGetEnabledLibraryIds: (sourceId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.sourcesGetEnabledLibraryIds, sourceId),
  sourcesScanLibrary: (sourceId: string, libraryId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.sourcesScanLibrary, sourceId, libraryId),
  sourcesScanAll: () => ipcRenderer.invoke(IPC_CHANNELS.sourcesScanAll),
  sourcesStopScan: () => ipcRenderer.invoke(IPC_CHANNELS.sourcesStopScan),

  // Incremental Scanning (only new/changed items since last scan)
  sourcesScanLibraryIncremental: (sourceId: string, libraryId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.sourcesScanLibraryIncremental, sourceId, libraryId),
  sourcesScanAllIncremental: () => ipcRenderer.invoke(IPC_CHANNELS.sourcesScanAllIncremental),

  // Single Item Scan (rescan a specific file)
  sourcesScanItem: (sourceId: string, libraryId: string | null, filePath: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.sourcesScanItem, sourceId, libraryId, filePath),

  // Statistics
  sourcesGetStats: () => ipcRenderer.invoke(IPC_CHANNELS.sourcesGetStats),
  sourcesGetSupportedProviders: () => ipcRenderer.invoke(IPC_CHANNELS.sourcesGetSupportedProviders),

  // Source Events
  onSourcesScanProgress: (callback: (progress: unknown) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, progress: unknown) => callback(progress)
    ipcRenderer.on(IPC_CHANNELS.sourcesScanProgress, handler)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.sourcesScanProgress, handler)
  },

  // Library Update Events - fired when media items are updated during scans/analysis
  onLibraryUpdated: (callback: (data: { type: 'media' | 'music'; count?: number }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: { type: 'media' | 'music'; count?: number }) => callback(data)
    ipcRenderer.on(IPC_CHANNELS.libraryUpdated, handler)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.libraryUpdated, handler)
  },

  // Auto-refresh Events - fired during incremental scan on app start
  onAutoRefreshStarted: (callback: () => void) => {
    const handler = () => callback()
    ipcRenderer.on(IPC_CHANNELS.scanAutoRefreshStarted, handler)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.scanAutoRefreshStarted, handler)
  },
  onAutoRefreshComplete: (callback: () => void) => {
    const handler = () => callback()
    ipcRenderer.on(IPC_CHANNELS.scanAutoRefreshComplete, handler)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.scanAutoRefreshComplete, handler)
  },

  // ============================================================================
  // KODI LOCAL DETECTION
  // ============================================================================

  // Detect local Kodi installation
  kodiDetectLocal: () => ipcRenderer.invoke(IPC_CHANNELS.kodiDetectLocal),
  kodiIsRunning: () => ipcRenderer.invoke(IPC_CHANNELS.kodiIsRunning),

  // Detect local MediaMonkey installation
  mediamonkeyDetectLocal: () => ipcRenderer.invoke(IPC_CHANNELS.mediamonkeyDetectLocal),
  mediamonkeySelectDatabase: () => ipcRenderer.invoke(IPC_CHANNELS.mediamonkeySelectDatabase),
  mediamonkeyIsRunning: () => ipcRenderer.invoke(IPC_CHANNELS.mediamonkeyIsRunning),

  // Mood sync
  moodCheckMediaMonkeyWrite: (sourceId: string) => ipcRenderer.invoke(IPC_CHANNELS.moodCheckMediaMonkeyWrite, sourceId),
  moodGetSources: (field?: 'mood' | 'genre') => ipcRenderer.invoke(IPC_CHANNELS.moodGetSources, field),
  moodGetComparison: (args: { sourceOfTruthId: string; field?: 'mood' | 'genre' }) => ipcRenderer.invoke(IPC_CHANNELS.moodGetComparison, args),
  moodSyncToTarget: (args: { sourceOfTruthId: string; targetSourceId: string; trackIds?: number[]; mode?: 'overwrite' | 'append'; field?: 'mood' | 'genre' }) =>
    ipcRenderer.invoke(IPC_CHANNELS.moodSyncToTarget, args),
  onMoodSyncProgress: (callback: (progress: { current: number; total: number; currentTrack: string; trackId?: number; status?: 'syncing' | 'done' | 'failed' }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, progress: { current: number; total: number; currentTrack: string; trackId?: number; status?: 'done' | 'syncing' }) => callback(progress)
    ipcRenderer.on(IPC_CHANNELS.moodSyncProgress, handler)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.moodSyncProgress, handler)
  },

  // Kodi Collections
  kodiImportCollections: (sourceId: string) => ipcRenderer.invoke(IPC_CHANNELS.kodiImportCollections, sourceId),
  kodiGetCollections: (sourceId: string) => ipcRenderer.invoke(IPC_CHANNELS.kodiGetCollections, sourceId),
  onKodiCollectionProgress: (callback: (progress: { current: number; total: number; currentItem: string }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, progress: { current: number; total: number; currentItem: string }) => callback(progress)
    ipcRenderer.on(IPC_CHANNELS.kodiCollectionProgress, handler)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.kodiCollectionProgress, handler)
  },

  // Kodi MySQL/MariaDB Connection
  kodiTestMySQLConnection: (config: {
    host: string
    port?: number
    username: string
    password: string
    databasePrefix?: string
    ssl?: boolean
    connectionTimeout?: number
  }) => ipcRenderer.invoke(IPC_CHANNELS.kodiTestMySQLConnection, config),

  kodiDetectMySQLDatabases: (config: {
    host: string
    port?: number
    username: string
    password: string
    databasePrefix?: string
  }) => ipcRenderer.invoke(IPC_CHANNELS.kodiDetectMySQLDatabases, config),

  kodiAuthenticateMySQL: (config: {
    host: string
    port?: number
    username: string
    password: string
    displayName: string
    videoDatabaseName?: string
    musicDatabaseName?: string
    databasePrefix?: string
    ssl?: boolean
  }) => ipcRenderer.invoke(IPC_CHANNELS.kodiAuthenticateMySQL, config),

  // ============================================================================
  // FFPROBE FILE ANALYSIS
  // ============================================================================

  // Check if FFprobe is available on the system
  ffprobeIsAvailable: () => ipcRenderer.invoke(IPC_CHANNELS.ffprobeIsAvailable),

  // Get FFprobe version string
  ffprobeGetVersion: () => ipcRenderer.invoke(IPC_CHANNELS.ffprobeGetVersion),

  // Analyze a media file with FFprobe
  ffprobeAnalyzeFile: (filePath: string) => ipcRenderer.invoke(IPC_CHANNELS.ffprobeAnalyzeFile, filePath),

  // Enable/disable FFprobe analysis for a source
  ffprobeSetEnabled: (sourceId: string, enabled: boolean) =>
    ipcRenderer.invoke(IPC_CHANNELS.ffprobeSetEnabled, sourceId, enabled),

  // Check if FFprobe analysis is enabled for a source
  ffprobeIsEnabled: (sourceId: string) => ipcRenderer.invoke(IPC_CHANNELS.ffprobeIsEnabled, sourceId),

  // Check if FFprobe is available for a specific source (with reason)
  ffprobeIsAvailableForSource: (sourceId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.ffprobeIsAvailableForSource, sourceId),

  // Check if FFprobe can be auto-installed on this platform
  ffprobeCanInstall: () => ipcRenderer.invoke(IPC_CHANNELS.ffprobeCanInstall),

  // Install FFprobe automatically
  ffprobeInstall: () => ipcRenderer.invoke(IPC_CHANNELS.ffprobeInstall),

  // Uninstall bundled FFprobe
  ffprobeUninstall: () => ipcRenderer.invoke(IPC_CHANNELS.ffprobeUninstall),

  // Check if current FFprobe is the bundled version
  ffprobeIsBundled: () => ipcRenderer.invoke(IPC_CHANNELS.ffprobeIsBundled),
  ffmpegIsAvailable: () => ipcRenderer.invoke(IPC_CHANNELS.ffmpegIsAvailable),

  // Check for FFprobe updates
  ffprobeCheckForUpdate: () => ipcRenderer.invoke(IPC_CHANNELS.ffprobeCheckForUpdate),

  // Listen for FFprobe install progress
  onFFprobeInstallProgress: (callback: (progress: { stage: string; percent: number }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, progress: { stage: string; percent: number }) => callback(progress)
    ipcRenderer.on(IPC_CHANNELS.ffprobeInstallProgress, handler)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.ffprobeInstallProgress, handler)
  },

  // ============================================================================
  // LOCAL FOLDER SOURCE
  // ============================================================================

  // Open folder picker dialog
  localSelectFolder: () => ipcRenderer.invoke(IPC_CHANNELS.localSelectFolder),

  // Detect subfolders and their media types
  localDetectSubfolders: (folderPath: string) => ipcRenderer.invoke(IPC_CHANNELS.localDetectSubfolders, folderPath),

  // Add a local folder as a media source
  localAddSource: (config: { folderPath: string; displayName: string; mediaType: 'movies' | 'tvshows' | 'music' | 'mixed' }) =>
    ipcRenderer.invoke(IPC_CHANNELS.localAddSource, config),

  // Add a local folder with custom library configurations
  localAddSourceWithLibraries: (config: {
    folderPath: string
    displayName: string
    libraries: Array<{
      name: string
      path: string
      mediaType: 'movies' | 'tvshows' | 'music'
      enabled: boolean
    }>
  }) => ipcRenderer.invoke(IPC_CHANNELS.localAddSourceWithLibraries, config),

  // ============================================================================
  // JELLYFIN (Discovery & Quick Connect)
  // ============================================================================

  // Server Discovery
  jellyfinDiscoverServers: () => ipcRenderer.invoke(IPC_CHANNELS.jellyfinDiscoverServers),
  jellyfinTestServerUrl: (url: string) => ipcRenderer.invoke(IPC_CHANNELS.jellyfinTestServerUrl, url),

  // API Key Authentication
  jellyfinAuthenticateApiKey: (serverUrl: string, apiKey: string, displayName: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.jellyfinAuthenticateApiKey, serverUrl, apiKey, displayName),

  // Quick Connect
  jellyfinIsQuickConnectEnabled: (serverUrl: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.jellyfinIsQuickConnectEnabled, serverUrl),
  jellyfinInitiateQuickConnect: (serverUrl: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.jellyfinInitiateQuickConnect, serverUrl),
  jellyfinCheckQuickConnectStatus: (serverUrl: string, secret: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.jellyfinCheckQuickConnectStatus, serverUrl, secret),
  jellyfinCompleteQuickConnect: (serverUrl: string, secret: string, displayName: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.jellyfinCompleteQuickConnect, serverUrl, secret, displayName),
  jellyfinAuthenticateCredentials: (
    serverUrl: string,
    username: string,
    password: string,
    displayName: string,
    isEmby: boolean = false
  ) =>
    ipcRenderer.invoke(IPC_CHANNELS.jellyfinAuthenticateCredentials, serverUrl, username, password, displayName, isEmby),

  // ============================================================================
  // EMBY (Discovery)
  // ============================================================================

  // Server Discovery
  embyDiscoverServers: () => ipcRenderer.invoke(IPC_CHANNELS.embyDiscoverServers),
  embyTestServerUrl: (url: string) => ipcRenderer.invoke(IPC_CHANNELS.embyTestServerUrl, url),

  // API Key Authentication
  embyAuthenticateApiKey: (serverUrl: string, apiKey: string, displayName: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.embyAuthenticateApiKey, serverUrl, apiKey, displayName),

  // Quality Analysis
  qualityAnalyzeAll: () => ipcRenderer.invoke(IPC_CHANNELS.qualityAnalyzeAll),
  qualityGetDistribution: () => ipcRenderer.invoke(IPC_CHANNELS.qualityGetDistribution),
  qualityGetRecommendedFormat: (mediaItemId: number) =>
    ipcRenderer.invoke(IPC_CHANNELS.qualityGetRecommendedFormat, mediaItemId),
  onQualityAnalysisProgress: (callback: (progress: unknown) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, progress: unknown) => callback(progress)
    ipcRenderer.on(IPC_CHANNELS.qualityAnalysisProgress, handler)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.qualityAnalysisProgress, handler)
  },

  // Database - Media Items
  getMediaItems: (filters?: unknown) => ipcRenderer.invoke(IPC_CHANNELS.dbGetMediaItems, filters),
  countMediaItems: (filters?: unknown) => ipcRenderer.invoke(IPC_CHANNELS.dbCountMediaItems, filters),
  getTVShows: (filters?: unknown) => ipcRenderer.invoke(IPC_CHANNELS.dbGetTVShows, filters),
  countTVShows: (filters?: unknown) => ipcRenderer.invoke(IPC_CHANNELS.dbCountTVShows, filters),
  countTVEpisodes: (filters?: unknown) => ipcRenderer.invoke(IPC_CHANNELS.dbCountTVEpisodes, filters),
  getLetterOffset: (params: { table: 'movies' | 'tvshows' | 'artists' | 'albums'; letter: string; sourceId?: string; libraryId?: string }) =>
    ipcRenderer.invoke(IPC_CHANNELS.dbGetLetterOffset, params),
  getMediaItemById: (id: number) => ipcRenderer.invoke(IPC_CHANNELS.dbGetMediaItemById, id),
  upsertMediaItem: (item: unknown) => ipcRenderer.invoke(IPC_CHANNELS.dbUpsertMediaItem, item),
  deleteMediaItem: (id: number) => ipcRenderer.invoke(IPC_CHANNELS.dbDeleteMediaItem, id),
  getMediaItemVersions: (mediaItemId: number) => ipcRenderer.invoke(IPC_CHANNELS.dbGetMediaItemVersions, mediaItemId),

  // Database - Quality Scores
  getQualityScores: () => ipcRenderer.invoke(IPC_CHANNELS.dbGetQualityScores),
  getQualityScoreByMediaId: (mediaItemId: number) =>
    ipcRenderer.invoke(IPC_CHANNELS.dbGetQualityScoreByMediaId, mediaItemId),
  upsertQualityScore: (score: unknown) => ipcRenderer.invoke(IPC_CHANNELS.dbUpsertQualityScore, score),

  // Database - Settings
  getSetting: (key: string) => ipcRenderer.invoke(IPC_CHANNELS.dbGetSetting, key),
  setSetting: (key: string, value: string) => ipcRenderer.invoke(IPC_CHANNELS.dbSetSetting, key, value),
  getAllSettings: () => ipcRenderer.invoke(IPC_CHANNELS.dbGetAllSettings),

  // NFS Mount Mappings (for Kodi)
  getNfsMappings: () => ipcRenderer.invoke(IPC_CHANNELS.settingsGetNfsMappings),
  setNfsMappings: (mappings: Record<string, string>) => ipcRenderer.invoke(IPC_CHANNELS.settingsSetNfsMappings, mappings),
  testNfsMapping: (nfsPath: string, localPath: string) => ipcRenderer.invoke(IPC_CHANNELS.settingsTestNfsMapping, nfsPath, localPath),

  // Settings Change Events
  onSettingsChanged: (callback: (data: { key: string; hasValue: boolean }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: { key: string; hasValue: boolean }) => callback(data)
    ipcRenderer.on(IPC_CHANNELS.settingsChanged, handler)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.settingsChanged, handler)
  },

  // Database - Data Management
  dbGetPath: () => ipcRenderer.invoke(IPC_CHANNELS.dbGetPath),
  dbOpenFolder: () => ipcRenderer.invoke(IPC_CHANNELS.dbOpenFolder),
  dbExport: () => ipcRenderer.invoke(IPC_CHANNELS.dbExport),
  dbExportCSV: (options: {
    includeUpgrades: boolean
    includeMissingMovies: boolean
    includeMissingEpisodes: boolean
    includeMissingAlbums: boolean
    includeMusicUpgrades: boolean
  }) => ipcRenderer.invoke(IPC_CHANNELS.dbExportCSV, options),
  dbImport: () => ipcRenderer.invoke(IPC_CHANNELS.dbImport),
  dbReset: () => ipcRenderer.invoke(IPC_CHANNELS.dbReset),
  dbResetLibraryData: () => ipcRenderer.invoke(IPC_CHANNELS.dbResetLibraryData),

  // Series Completeness
  seriesAnalyzeAll: (sourceId?: string, libraryId?: string) => ipcRenderer.invoke(IPC_CHANNELS.seriesAnalyzeAll, sourceId, libraryId),
  seriesAnalyze: (seriesIdentityKey: string, sourceId?: string, libraryId?: string) => ipcRenderer.invoke(IPC_CHANNELS.seriesAnalyze, seriesIdentityKey, sourceId, libraryId),
  seriesGetAll: (sourceId?: string) => ipcRenderer.invoke(IPC_CHANNELS.seriesGetAll, sourceId),
  seriesGetIncomplete: (sourceId?: string) => ipcRenderer.invoke(IPC_CHANNELS.seriesGetIncomplete, sourceId),
  seriesGetStats: () => ipcRenderer.invoke(IPC_CHANNELS.seriesGetStats),
  seriesGetEpisodes: (seriesIdentityKey: string, sourceId?: string, libraryId?: string) => ipcRenderer.invoke(IPC_CHANNELS.seriesGetEpisodes, seriesIdentityKey, sourceId, undefined, libraryId),
  seriesDelete: (id: number) => ipcRenderer.invoke(IPC_CHANNELS.seriesDelete, id),
  tmdbGetMovieDetails: (tmdbId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.tmdbGetMovieDetails, tmdbId) as Promise<{ overview: string | null; releaseDate: string | null; runtime: number | null } | null>,
  tmdbGetTVShowDetails: (tmdbId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.tmdbGetTVShowDetails, tmdbId) as Promise<{ overview: string | null } | null>,
  seriesGetSeasonDetails: (tmdbId: string, seasonNumber: number) =>
    ipcRenderer.invoke(IPC_CHANNELS.seriesGetSeasonDetails, tmdbId, seasonNumber) as Promise<{ overview: string | null; episodeCount: number; airDate: string | null; name: string | null } | null>,
  seriesGetSeasonPoster: (tmdbId: string, seasonNumber: number) =>
    ipcRenderer.invoke(IPC_CHANNELS.seriesGetSeasonPoster, tmdbId, seasonNumber),
  seriesGetEpisodeStill: (tmdbId: string, seasonNumber: number, episodeNumber: number) =>
    ipcRenderer.invoke(IPC_CHANNELS.seriesGetEpisodeStill, tmdbId, seasonNumber, episodeNumber),
  seriesCancelAnalysis: () => ipcRenderer.invoke(IPC_CHANNELS.seriesCancelAnalysis),
  onSeriesProgress: (callback: (progress: unknown) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, progress: unknown) => callback(progress)
    ipcRenderer.on(IPC_CHANNELS.seriesProgress, handler)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.seriesProgress, handler)
  },

  // Series Match Fixing
  seriesSearchTMDB: (query: string) => ipcRenderer.invoke(IPC_CHANNELS.seriesSearchTMDB, query),
  seriesFixMatch: (seriesIdentityKey: string, sourceId: string, libraryId: string | undefined, tmdbId: number) =>
    ipcRenderer.invoke(IPC_CHANNELS.seriesFixMatch, seriesIdentityKey, sourceId, libraryId, tmdbId),

  // Movie Match Fixing
  movieSearchTMDB: (query: string, year?: number) => ipcRenderer.invoke(IPC_CHANNELS.movieSearchTMDB, query, year),
  movieFixMatch: (mediaItemId: number, tmdbId: number) =>
    ipcRenderer.invoke(IPC_CHANNELS.movieFixMatch, mediaItemId, tmdbId),

  // Movie Collections
  collectionsAnalyzeAll: (sourceId?: string, libraryId?: string) => ipcRenderer.invoke(IPC_CHANNELS.collectionsAnalyzeAll, sourceId, libraryId),
  collectionsGetAll: (sourceId?: string) => ipcRenderer.invoke(IPC_CHANNELS.collectionsGetAll, sourceId),
  collectionsGetIncomplete: (sourceId?: string) => ipcRenderer.invoke(IPC_CHANNELS.collectionsGetIncomplete, sourceId),
  collectionsGetStats: () => ipcRenderer.invoke(IPC_CHANNELS.collectionsGetStats),
  collectionsDelete: (id: number) => ipcRenderer.invoke(IPC_CHANNELS.collectionsDelete, id),
  collectionsCancelAnalysis: () => ipcRenderer.invoke(IPC_CHANNELS.collectionsCancelAnalysis),
  onCollectionsProgress: (callback: (progress: unknown) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, progress: unknown) => callback(progress)
    ipcRenderer.on(IPC_CHANNELS.collectionsProgress, handler)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.collectionsProgress, handler)
  },

  // ============================================================================
  // MUSIC LIBRARY
  // ============================================================================

  // Music Library Scanning
  musicScanLibrary: (sourceId: string, libraryId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.musicScanLibrary, sourceId, libraryId),
  onMusicScanProgress: (callback: (progress: unknown) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, progress: unknown) => callback(progress)
    ipcRenderer.on(IPC_CHANNELS.musicScanProgress, handler)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.musicScanProgress, handler)
  },

  // Music Data Retrieval
  musicGetArtists: (filters?: unknown) => ipcRenderer.invoke(IPC_CHANNELS.musicGetArtists, filters),
  musicGetArtistById: (id: number) => ipcRenderer.invoke(IPC_CHANNELS.musicGetArtistById, id),
  musicGetAlbums: (filters?: unknown) => ipcRenderer.invoke(IPC_CHANNELS.musicGetAlbums, filters),
  musicGetAlbumsByArtist: (artistId: number) => ipcRenderer.invoke(IPC_CHANNELS.musicGetAlbumsByArtist, artistId),
  musicGetAlbumById: (id: number) => ipcRenderer.invoke(IPC_CHANNELS.musicGetAlbumById, id),
  musicGetTracks: (filters?: unknown) => ipcRenderer.invoke(IPC_CHANNELS.musicGetTracks, filters),
  musicGetTrackById: (id: number) => ipcRenderer.invoke(IPC_CHANNELS.musicGetTrackById, id),
  musicGetTracksByAlbum: (albumId: number) => ipcRenderer.invoke(IPC_CHANNELS.musicGetTracksByAlbum, albumId),
  musicGetStats: (sourceId?: string) => ipcRenderer.invoke(IPC_CHANNELS.musicGetStats, sourceId),
  musicCountArtists: (filters?: unknown) => ipcRenderer.invoke(IPC_CHANNELS.musicCountArtists, filters),
  musicCountAlbums: (filters?: unknown) => ipcRenderer.invoke(IPC_CHANNELS.musicCountAlbums, filters),
  musicCountTracks: (filters?: unknown) => ipcRenderer.invoke(IPC_CHANNELS.musicCountTracks, filters),

  // Music Quality Analysis
  musicGetAlbumQuality: (albumId: number) => ipcRenderer.invoke(IPC_CHANNELS.musicGetAlbumQuality, albumId),
  musicGetAlbumsNeedingUpgrade: (limit?: number, sourceId?: string) => ipcRenderer.invoke(IPC_CHANNELS.musicGetAlbumsNeedingUpgrade, limit, sourceId),
  musicAnalyzeAllQuality: (sourceId?: string) => ipcRenderer.invoke(IPC_CHANNELS.musicAnalyzeAllQuality, sourceId),
  onMusicQualityProgress: (callback: (progress: unknown) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, progress: unknown) => callback(progress)
    ipcRenderer.on(IPC_CHANNELS.musicQualityProgress, handler)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.musicQualityProgress, handler)
  },

  // MusicBrainz Completeness - Unified Analysis (artists + albums)
  musicAnalyzeAll: (sourceId?: string) => ipcRenderer.invoke(IPC_CHANNELS.musicAnalyzeAll, sourceId),
  musicCancelAnalysis: () => ipcRenderer.invoke(IPC_CHANNELS.musicCancelAnalysis),
  onMusicAnalysisProgress: (callback: (progress: unknown) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, progress: unknown) => callback(progress)
    ipcRenderer.on(IPC_CHANNELS.musicAnalysisProgress, handler)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.musicAnalysisProgress, handler)
  },
  musicSearchMusicBrainzArtist: (name: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.musicSearchMusicBrainzArtist, name),
  musicAnalyzeArtistCompleteness: (artistId: number) =>
    ipcRenderer.invoke(IPC_CHANNELS.musicAnalyzeArtistCompleteness, artistId),
  musicGetArtistCompleteness: (artistName: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.musicGetArtistCompleteness, artistName),
  musicGetAllArtistCompleteness: (sourceId?: string) => ipcRenderer.invoke(IPC_CHANNELS.musicGetAllArtistCompleteness, sourceId),

  // Music - Album Track Completeness
  musicAnalyzeAlbumTrackCompleteness: (albumId: number) =>
    ipcRenderer.invoke(IPC_CHANNELS.musicAnalyzeAlbumTrackCompleteness, albumId),
  musicGetAlbumCompleteness: (albumId: number) =>
    ipcRenderer.invoke(IPC_CHANNELS.musicGetAlbumCompleteness, albumId),
  musicGetAllAlbumCompleteness: () => ipcRenderer.invoke(IPC_CHANNELS.musicGetAllAlbumCompleteness),
  musicGetIncompleteAlbums: () => ipcRenderer.invoke(IPC_CHANNELS.musicGetIncompleteAlbums),

  // Music - Match Fixing
  musicFixArtistMatch: (artistId: number, musicbrainzId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.musicFixArtistMatch, artistId, musicbrainzId),
  musicSearchMusicBrainzRelease: (artistName: string, albumTitle: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.musicSearchMusicBrainzRelease, artistName, albumTitle),
  musicFixAlbumMatch: (albumId: number, musicbrainzReleaseGroupId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.musicFixAlbumMatch, albumId, musicbrainzReleaseGroupId),

  // Music - Cancellation
  musicCancelScan: (sourceId: string) => ipcRenderer.invoke(IPC_CHANNELS.musicCancelScan, sourceId),

  // Database - Statistics
  getLibraryStats: (sourceId?: string) => ipcRenderer.invoke(IPC_CHANNELS.dbGetLibraryStats, sourceId),
  getStorageAnalytics: () => ipcRenderer.invoke(IPC_CHANNELS.dbGetStorageAnalytics),
  // Person filmography completeness
  personGetCompleteness: (personType?: string) => ipcRenderer.invoke(IPC_CHANNELS.personGetCompleteness, personType),
  personSearchTMDB: (query: string) => ipcRenderer.invoke(IPC_CHANNELS.personSearchTMDB, query),
  personAnalyze: (personName: string, personType: string) => ipcRenderer.invoke(IPC_CHANNELS.personAnalyze, personName, personType),
  personDelete: (id: number) => ipcRenderer.invoke(IPC_CHANNELS.personDelete, id),
  // Watchlist sync
  syncPlexWatchlist: () => ipcRenderer.invoke(IPC_CHANNELS.syncPlexWatchlist),
  syncTrakt: (username: string) => ipcRenderer.invoke(IPC_CHANNELS.syncTrakt, username),
  fetchPlexWatchlist: () => ipcRenderer.invoke(IPC_CHANNELS.syncFetchPlex) as Promise<Array<{ title: string; media_type: string; year?: number; tmdb_id?: string; poster_url?: string }>>,
  fetchTraktWatchlist: (username: string) => ipcRenderer.invoke(IPC_CHANNELS.syncFetchTrakt, username) as Promise<Array<{ title: string; media_type: string; year?: number; tmdb_id?: string; poster_url?: string }>>,
  // Release alerts
  releaseAlertsCheck: () => ipcRenderer.invoke(IPC_CHANNELS.releaseAlertsCheck),
  getDuplicateMedia: () => ipcRenderer.invoke(IPC_CHANNELS.dbGetDuplicateMedia),
  getLibraryHealthScores: () => ipcRenderer.invoke(IPC_CHANNELS.dbGetLibraryHealthScores),
  getRecentlyUpgraded: (days?: number) => ipcRenderer.invoke(IPC_CHANNELS.dbGetRecentlyUpgraded, days),
  getRecentlyAdded: (days?: number, limit?: number) => ipcRenderer.invoke(IPC_CHANNELS.dbGetRecentlyAdded, days, limit),

  // Database - Global Search
  mediaSearch: (query: string) => ipcRenderer.invoke(IPC_CHANNELS.mediaSearch, query),

  // Database - Exclusions
  addExclusion: (exclusionType: string, referenceId?: number, referenceKey?: string, parentKey?: string, title?: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.dbAddExclusion, exclusionType, referenceId, referenceKey, parentKey, title),
  removeExclusion: (id: number) => ipcRenderer.invoke(IPC_CHANNELS.dbRemoveExclusion, id),
  getExclusions: (exclusionType?: string, parentKey?: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.dbGetExclusions, exclusionType, parentKey),

  // ============================================================================
  // WISHLIST / SHOPPING LIST
  // ============================================================================

  // Wishlist CRUD
  wishlistAdd: (item: unknown) => ipcRenderer.invoke(IPC_CHANNELS.wishlistAdd, item),
  wishlistUpdate: (id: number, updates: unknown) => ipcRenderer.invoke(IPC_CHANNELS.wishlistUpdate, id, updates),
  wishlistRemove: (id: number) => ipcRenderer.invoke(IPC_CHANNELS.wishlistRemove, id),
  wishlistGetAll: (filters?: unknown) => ipcRenderer.invoke(IPC_CHANNELS.wishlistGetAll, filters),
  wishlistGetById: (id: number) => ipcRenderer.invoke(IPC_CHANNELS.wishlistGetById, id),
  wishlistGetCount: () => ipcRenderer.invoke(IPC_CHANNELS.wishlistGetCount),
  wishlistCheckExists: (tmdbId?: string, musicbrainzId?: string, mediaItemId?: number) =>
    ipcRenderer.invoke(IPC_CHANNELS.wishlistCheckExists, tmdbId, musicbrainzId, mediaItemId),
  wishlistAddBulk: (items: unknown[]) => ipcRenderer.invoke(IPC_CHANNELS.wishlistAddBulk, items),
  wishlistGetCountsByReason: () => ipcRenderer.invoke(IPC_CHANNELS.wishlistGetCountsByReason),

  // Store Search
  wishlistGetStoreLinks: (item: unknown) => ipcRenderer.invoke(IPC_CHANNELS.wishlistGetStoreLinks, item),
  wishlistOpenStoreLink: (url: string) => ipcRenderer.invoke(IPC_CHANNELS.wishlistOpenStoreLink, url),
  wishlistSetRegion: (region: string) => ipcRenderer.invoke(IPC_CHANNELS.wishlistSetRegion, region),
  wishlistGetRegion: () => ipcRenderer.invoke(IPC_CHANNELS.wishlistGetRegion),
  wishlistExportCsv: () => ipcRenderer.invoke(IPC_CHANNELS.wishlistExportCsv),

  // Notifications (legacy simple notification)
  onNotification: (callback: (message: string) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, message: string) => callback(message)
    ipcRenderer.on(IPC_CHANNELS.notification, handler)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.notification, handler)
  },

  // ============================================================================
  // LIVE MONITORING
  // ============================================================================

  // Monitoring Control
  monitoringGetConfig: () => ipcRenderer.invoke(IPC_CHANNELS.monitoringGetConfig),
  monitoringSetConfig: (config: {
    enabled?: boolean
    startOnLaunch?: boolean
    pauseDuringManualScan?: boolean
    pollingIntervals?: Record<string, number>
  }) => ipcRenderer.invoke(IPC_CHANNELS.monitoringSetConfig, config),
  monitoringStart: () => ipcRenderer.invoke(IPC_CHANNELS.monitoringStart),
  monitoringStop: () => ipcRenderer.invoke(IPC_CHANNELS.monitoringStop),
  monitoringIsActive: () => ipcRenderer.invoke(IPC_CHANNELS.monitoringIsActive),
  monitoringForceCheck: (sourceId: string) => ipcRenderer.invoke(IPC_CHANNELS.monitoringForceCheck, sourceId),

  // Monitoring Events
  onMonitoringStatusChanged: (callback: (status: { isActive: boolean; lastCheck?: string }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, status: { isActive: boolean; lastCheck?: string }) => callback(status)
    ipcRenderer.on(IPC_CHANNELS.monitoringStatusChanged, handler)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.monitoringStatusChanged, handler)
  },
  onMonitoringSourceChecked: (callback: (data: { sourceId: string; hasChanges: boolean }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: { sourceId: string; hasChanges: boolean }) => callback(data)
    ipcRenderer.on(IPC_CHANNELS.monitoringSourceChecked, handler)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.monitoringSourceChecked, handler)
  },
  onMonitoringStatus: (callback: (status: { isActive: boolean }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, status: { isActive: boolean }) => callback(status)
    ipcRenderer.on(IPC_CHANNELS.monitoringStatus, handler)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.monitoringStatus, handler)
  },
  onMonitoringEvent: (callback: (event: { type: string; message: string }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: { type: string; message: string }) => callback(data)
    ipcRenderer.on(IPC_CHANNELS.monitoringEvent, handler)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.monitoringEvent, handler)
  },
  getMonitoringStatus: () => ipcRenderer.invoke(IPC_CHANNELS.monitoringGetStatus),

  // ============================================================================
  // NOTIFICATIONS
  // ============================================================================

  notificationsGetAll: (options?: { limit?: number, offset?: number, type?: string, unreadOnly?: boolean }) =>
    ipcRenderer.invoke(IPC_CHANNELS.notificationsGetAll, options),
  notificationsGetCount: () => ipcRenderer.invoke(IPC_CHANNELS.notificationsGetCount),
  notificationsMarkRead: (ids: number[]) => ipcRenderer.invoke(IPC_CHANNELS.notificationsMarkRead, ids),
  notificationsMarkAllRead: () => ipcRenderer.invoke(IPC_CHANNELS.notificationsMarkAllRead),
  notificationsDelete: (ids: number[]) => ipcRenderer.invoke(IPC_CHANNELS.notificationsDelete, ids),
  notificationsClear: () => ipcRenderer.invoke(IPC_CHANNELS.notificationsClear),
  onNotificationsNew: (callback: () => void) => {
    const handler = () => callback()
    ipcRenderer.on(IPC_CHANNELS.notificationsNew, handler)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.notificationsNew, handler)
  },

  // ============================================================================
  // TASK QUEUE
  // ============================================================================

  // Queue State
  taskQueueGetState: (): Promise<QueueState> => ipcRenderer.invoke(IPC_CHANNELS.taskQueueGetState),

  // Task Management
  taskQueueAddTask: (definition: TaskDefinition) => ipcRenderer.invoke(IPC_CHANNELS.taskQueueAddTask, definition),
  taskQueueRemoveTask: (taskId: string) => ipcRenderer.invoke(IPC_CHANNELS.taskQueueRemoveTask, taskId),
  taskQueueReorderQueue: (taskIds: string[]) => ipcRenderer.invoke(IPC_CHANNELS.taskQueueReorderQueue, taskIds),
  taskQueueClearQueue: () => ipcRenderer.invoke(IPC_CHANNELS.taskQueueClearQueue),

  // Queue Control
  taskQueuePause: () => ipcRenderer.invoke(IPC_CHANNELS.taskQueuePause),
  taskQueueResume: () => ipcRenderer.invoke(IPC_CHANNELS.taskQueueResume),
  taskQueueCancelCurrent: () => ipcRenderer.invoke(IPC_CHANNELS.taskQueueCancelCurrent),

  // History
  taskQueueGetTaskHistory: (): Promise<ActivityLogEntry[]> => ipcRenderer.invoke(IPC_CHANNELS.taskQueueGetTaskHistory),
  taskQueueGetMonitoringHistory: (): Promise<ActivityLogEntry[]> => ipcRenderer.invoke(IPC_CHANNELS.taskQueueGetMonitoringHistory),
  taskQueueClearTaskHistory: () => ipcRenderer.invoke(IPC_CHANNELS.taskQueueClearTaskHistory),
  taskQueueClearMonitoringHistory: () => ipcRenderer.invoke(IPC_CHANNELS.taskQueueClearMonitoringHistory),

  // Task Queue Events
  onTaskQueueUpdated: (callback: (state: QueueState) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, state: QueueState) => callback(state)
    ipcRenderer.on(IPC_CHANNELS.taskQueueUpdated, handler)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.taskQueueUpdated, handler)
  },
  onTaskQueueTaskComplete: (callback: (task: QueuedTask) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, task: QueuedTask) => callback(task)
    ipcRenderer.on(IPC_CHANNELS.taskQueueTaskComplete, handler)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.taskQueueTaskComplete, handler)
  },
  onScanCompleted: (callback: (data: {
    sourceId?: string
    libraryId?: string
    libraryName: string
    itemsAdded: number
    itemsUpdated: number
    itemsScanned: number
    isFirstScan: boolean
  }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: {
      sourceId?: string
      libraryId?: string
      libraryName: string
      itemsAdded: number
      itemsUpdated: number
      itemsScanned: number
      isFirstScan: boolean
    }) => callback(data)
    ipcRenderer.on(IPC_CHANNELS.scanCompleted, handler)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.scanCompleted, handler)
  },
  onTaskQueueHistoryUpdated: (callback: (history: TaskQueueHistory) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, history: TaskQueueHistory) => callback(history)
    ipcRenderer.on(IPC_CHANNELS.taskQueueHistoryUpdated, handler)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.taskQueueHistoryUpdated, handler)
  },
  onWishlistAutoCompleted: (callback: (items: Array<{ id: number; title: string; reason: string; media_type: string }>) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, items: Array<{ id: number; title: string; reason: string; media_type: string }>) => callback(items)
    ipcRenderer.on(IPC_CHANNELS.wishlistAutoCompleted, handler)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.wishlistAutoCompleted, handler)
  },
  onWishlistChanged: (callback: () => void) => {
    const handler = () => callback()
    ipcRenderer.on(IPC_CHANNELS.wishlistChanged, handler)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.wishlistChanged, handler)
  },

  // General
  onMessage: (callback: (message: string) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, message: string) => callback(message)
    ipcRenderer.on(IPC_CHANNELS.mainProcessMessage, handler)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.mainProcessMessage, handler)
  },

  // ============================================================================
  // AUTO UPDATE
  // ============================================================================
  autoUpdateGetState: () => ipcRenderer.invoke(IPC_CHANNELS.autoUpdateGetState),
  autoUpdateCheckForUpdates: () => ipcRenderer.invoke(IPC_CHANNELS.autoUpdateCheckForUpdates),
  autoUpdateDownloadUpdate: () => ipcRenderer.invoke(IPC_CHANNELS.autoUpdateDownloadUpdate),
  autoUpdateInstallUpdate: () => ipcRenderer.invoke(IPC_CHANNELS.autoUpdateInstallUpdate),
  onAutoUpdateStateChanged: (callback: (state: {
    status: 'idle' | 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error'
    version?: string
    releaseNotes?: string
    downloadProgress?: { percent: number; bytesPerSecond: number; transferred: number; total: number }
    error?: string
    lastChecked?: string
  }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, state: {
      status: 'idle' | 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error'
      version?: string
      releaseNotes?: string
      downloadProgress?: { percent: number; bytesPerSecond: number; transferred: number; total: number }
      error?: string
      lastChecked?: string
    }) => callback(state)
    ipcRenderer.on(IPC_CHANNELS.autoUpdateStateChanged, handler)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.autoUpdateStateChanged, handler)
  },

  // ============================================================================
  // AI (GEMINI)
  // ============================================================================
  aiIsConfigured: () => ipcRenderer.invoke(IPC_CHANNELS.aiIsConfigured),
  aiGetRateLimitInfo: () => ipcRenderer.invoke(IPC_CHANNELS.aiGetRateLimitInfo),
  aiTestApiKey: (apiKey: string) => ipcRenderer.invoke(IPC_CHANNELS.aiTestApiKey, apiKey),
  aiSendMessage: (params: {
    messages: Array<{ role: 'user' | 'assistant'; content: string }>
    system?: string
    maxTokens?: number
  }) => ipcRenderer.invoke(IPC_CHANNELS.aiSendMessage, params),
  aiStreamMessage: (params: {
    messages: Array<{ role: 'user' | 'assistant'; content: string }>
    system?: string
    maxTokens?: number
    requestId: string
  }) => ipcRenderer.invoke(IPC_CHANNELS.aiStreamMessage, params),
  onAiStreamDelta: (callback: (data: { requestId: string; delta: string }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: { requestId: string; delta: string }) => callback(data)
    ipcRenderer.on(IPC_CHANNELS.aiStreamDelta, handler)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.aiStreamDelta, handler)
  },
  onAiStreamComplete: (callback: (data: { requestId: string; usage?: { input_tokens: number; output_tokens: number } }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: { requestId: string; usage?: { input_tokens: number; output_tokens: number } }) => callback(data)
    ipcRenderer.on(IPC_CHANNELS.aiStreamComplete, handler)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.aiStreamComplete, handler)
  },
  aiChatMessage: (params: {
    messages: Array<{ role: 'user' | 'assistant'; content: string }>
    requestId: string
    viewContext?: {
      currentView: 'dashboard' | 'library'
      libraryTab?: 'movies' | 'tv' | 'music'
      selectedItem?: { title: string; type?: string; id?: number }
      activeSourceId?: string
      activeFilters?: string
    }
  }) => ipcRenderer.invoke(IPC_CHANNELS.aiChatMessage, params),
  onAiToolUse: (callback: (data: { requestId: string; toolName: string; input: Record<string, unknown> }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: { requestId: string; toolName: string; input: Record<string, unknown> }) => callback(data)
    ipcRenderer.on(IPC_CHANNELS.aiToolUse, handler)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.aiToolUse, handler)
  },
  onAiChatStreamDelta: (callback: (data: { requestId: string; delta: string }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: { requestId: string; delta: string }) => callback(data)
    ipcRenderer.on(IPC_CHANNELS.aiChatStreamDelta, handler)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.aiChatStreamDelta, handler)
  },
  onAiChatStreamComplete: (callback: (data: { requestId: string }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: { requestId: string }) => callback(data)
    ipcRenderer.on(IPC_CHANNELS.aiChatStreamComplete, handler)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.aiChatStreamComplete, handler)
  },

  // AI Analysis Reports
  aiQualityReport: (params: { requestId: string }) =>
    ipcRenderer.invoke(IPC_CHANNELS.aiQualityReport, params),
  aiUpgradePriorities: (params: { requestId: string }) =>
    ipcRenderer.invoke(IPC_CHANNELS.aiUpgradePriorities, params),
  aiCompletenessInsights: (params: { requestId: string }) =>
    ipcRenderer.invoke(IPC_CHANNELS.aiCompletenessInsights, params),
  onAiAnalysisStreamDelta: (callback: (data: { requestId: string; delta: string }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: { requestId: string; delta: string }) => callback(data)
    ipcRenderer.on(IPC_CHANNELS.aiAnalysisStreamDelta, handler)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.aiAnalysisStreamDelta, handler)
  },
  onAiAnalysisStreamComplete: (callback: (data: { requestId: string }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: { requestId: string }) => callback(data)
    ipcRenderer.on(IPC_CHANNELS.aiAnalysisStreamComplete, handler)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.aiAnalysisStreamComplete, handler)
  },
  aiWishlistAdvice: (params: { requestId: string }) =>
    ipcRenderer.invoke(IPC_CHANNELS.aiWishlistAdvice, params),
  aiStorageOptimization: (params: { requestId: string }) =>
    ipcRenderer.invoke(IPC_CHANNELS.aiStorageOptimization, params),
  aiMusicQualityReport: (params: { requestId: string }) =>
    ipcRenderer.invoke(IPC_CHANNELS.aiMusicQualityReport, params),
  aiExplainQuality: (params: {
    title: string
    resolution?: string
    videoCodec?: string
    videoBitrate?: number
    audioCodec?: string
    audioChannels?: number
    hdrFormat?: string
    qualityTier?: string
    tierQuality?: string
    tierScore?: number
  }) => ipcRenderer.invoke(IPC_CHANNELS.aiExplainQuality, params),

  // ============================================================================
  // LOGGING
  // ============================================================================
  getLogs: (limit?: number) => ipcRenderer.invoke(IPC_CHANNELS.logsGetAll, limit),
  clearLogs: () => ipcRenderer.invoke(IPC_CHANNELS.logsClear),
  exportLogs: () => ipcRenderer.invoke(IPC_CHANNELS.logsExport),
  setVerboseLogging: (enabled: boolean) => ipcRenderer.invoke(IPC_CHANNELS.logsSetVerbose, enabled),
  isVerboseLogging: () => ipcRenderer.invoke(IPC_CHANNELS.logsIsVerbose),
  getFileLoggingSettings: () => ipcRenderer.invoke(IPC_CHANNELS.logsGetFileLoggingSettings),
  setFileLoggingSettings: (settings: { enabled?: boolean; minLevel?: string; retentionDays?: number }) =>
    ipcRenderer.invoke(IPC_CHANNELS.logsSetFileLoggingSettings, settings),
  openLogFolder: () => ipcRenderer.invoke(IPC_CHANNELS.logsOpenLogFolder),
  onNewLog: (callback: (entry: { id: string; timestamp: string; level: 'verbose' | 'debug' | 'info' | 'warn' | 'error'; source: string; message: string; details?: string }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, entry: { id: string; timestamp: string; level: 'verbose' | 'debug' | 'info' | 'warn' | 'error'; source: string; message: string; details?: string }) => callback(entry)
    ipcRenderer.on(IPC_CHANNELS.logsNew, handler)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.logsNew, handler)
  },
  timelinesListRecipes: () => ipcRenderer.invoke(IPC_CHANNELS.timelinesListRecipes),
  timelinesListParserPlugins: () => ipcRenderer.invoke(IPC_CHANNELS.timelinesListParserPlugins),
  timelinesSaveParserPlugin: (plugin: unknown) => ipcRenderer.invoke(IPC_CHANNELS.timelinesSaveParserPlugin, plugin),
  timelinesRemoveParserPlugin: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.timelinesRemoveParserPlugin, id),
  timelinesGetRecipe: (recipeId: string, options?: { refresh?: boolean }) => ipcRenderer.invoke(IPC_CHANNELS.timelinesGetRecipe, recipeId, options),
  timelinesResolveTimeline: (recipeId: string, sourceId: string | undefined, options: { refresh?: boolean; snapshotId?: string } | undefined, requestId: string, showInActivity: boolean) => ipcRenderer.invoke(IPC_CHANNELS.timelinesResolveTimeline, recipeId, sourceId, options, requestId, showInActivity),
  timelinesSyncPlexPlaylist: (payload: { sourceId: string; recipeId: string; playlistTitle: string; snapshotId: string; playlistRatingKey?: string; allowStale?: boolean }, requestId: string) => ipcRenderer.invoke(IPC_CHANNELS.timelinesSyncPlexPlaylist, payload, requestId),
  timelinesGetPlexPlaylists: (sourceId: string) => ipcRenderer.invoke(IPC_CHANNELS.timelinesGetPlexPlaylists, sourceId),
  transcodingGetCapabilities: (refresh = false) => ipcRenderer.invoke(IPC_CHANNELS.transcodingGetCapabilities, refresh),
  transcodingPreflightRemux: (mediaItemId: number) => ipcRenderer.invoke(IPC_CHANNELS.transcodingPreflightRemux, mediaItemId),
  transcodingTranscode: (mediaItemId: number, options: TranscodeOptions, requestId: string) => ipcRenderer.invoke(IPC_CHANNELS.transcodingTranscode, mediaItemId, options, requestId),
  transcodingCancel: (mediaItemId?: number) => ipcRenderer.invoke(IPC_CHANNELS.transcodingCancel, mediaItemId),
  onTranscodingProgress: (callback: (data: { requestId: string; mediaItemId: number; progress: number }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: { requestId: string; mediaItemId: number; progress: number }) => callback(data)
    ipcRenderer.on(IPC_CHANNELS.transcodingProgress, handler)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.transcodingProgress, handler)
  },
  // Duplicates
  duplicatesGetPending: (sourceId?: string) => ipcRenderer.invoke(IPC_CHANNELS.duplicatesGetPending, sourceId),
  duplicatesScan: (sourceId: string | undefined, requestId: string) => ipcRenderer.invoke(IPC_CHANNELS.duplicatesScan, sourceId, requestId),
  duplicatesGetRecommendation: (mediaItemIds: number[]) => ipcRenderer.invoke(IPC_CHANNELS.duplicatesGetRecommendation, mediaItemIds),
  duplicatesResolve: (duplicateId: number, keepItemId: number, deleteOthers: boolean) => ipcRenderer.invoke(IPC_CHANNELS.duplicatesResolve, duplicateId, keepItemId, deleteOthers),

  // ============================================================================
  // WEB ACCESS
  // ============================================================================
  webAccessGetStatus: () => ipcRenderer.invoke(IPC_CHANNELS.webAccessGetStatus),
  webAccessStart: () => ipcRenderer.invoke(IPC_CHANNELS.webAccessStart),
  webAccessStop: () => ipcRenderer.invoke(IPC_CHANNELS.webAccessStop),

  // Operations
  dbCancelOperation: (requestId: string) => ipcRenderer.invoke(IPC_CHANNELS.dbCancelOperation, requestId),
  operationsGetActivity: () => ipcRenderer.invoke(IPC_CHANNELS.operationsGetActivity),
  operationsGetResult: (requestId: string) => ipcRenderer.invoke(IPC_CHANNELS.operationsGetResult, requestId),
  operationsDismiss: (requestId: string) => ipcRenderer.invoke(IPC_CHANNELS.operationsDismiss, requestId),
  onOperationsUpdated: (callback: (snapshot: { revision: number; operations: ActivityOperation[] }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, snapshot: { revision: number; operations: ActivityOperation[] }) => callback(snapshot)
    ipcRenderer.on(IPC_CHANNELS.operationsUpdated, handler)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.operationsUpdated, handler)
  },

  // Playback Target Profiles & Compatibility
  listPlaybackTargetProfiles: () => ipcRenderer.invoke(IPC_CHANNELS.dbPlaybackTargetProfilesList),
  createPlaybackTargetProfile: (input: { name: string; definition: PlaybackTargetDefinition }) => ipcRenderer.invoke(IPC_CHANNELS.dbPlaybackTargetProfilesCreate, input),
  updatePlaybackTargetProfile: (input: { id: string; name: string; definition: PlaybackTargetDefinition }) => ipcRenderer.invoke(IPC_CHANNELS.dbPlaybackTargetProfilesUpdate, input),
  duplicatePlaybackTargetProfile: (sourceId: string, name: string) => ipcRenderer.invoke(IPC_CHANNELS.dbPlaybackTargetProfilesDuplicate, { sourceId, name }),
  deletePlaybackTargetProfile: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.dbPlaybackTargetProfilesDelete, id),
  evaluatePlaybackCompatibility: (input: { mediaItemId: number; profileId: string }) => ipcRenderer.invoke(IPC_CHANNELS.dbPlaybackCompatibilityEvaluate, input),

  // Optimization
  optimizationGetPending: () => ipcRenderer.invoke(IPC_CHANNELS.optimizationGetPending),
  optimizationGetDecision: (mediaItemId: number) => ipcRenderer.invoke(IPC_CHANNELS.optimizationGetDecision, mediaItemId),

  // TV Show Optimization & Preflight
  seriesGetEpisodesByIdentity: (seriesTitle: string, sourceId: string, seriesIdentityKey: string, libraryId: string) => ipcRenderer.invoke(IPC_CHANNELS.seriesGetEpisodesByIdentity, seriesTitle, sourceId, seriesIdentityKey, libraryId),
  seriesGetAudioLanguagesByIdentity: (seriesTitle: string, sourceId: string, seriesIdentityKey: string, libraryId: string) => ipcRenderer.invoke(IPC_CHANNELS.seriesGetAudioLanguagesByIdentity, seriesTitle, sourceId, seriesIdentityKey, libraryId),
  seriesAnalyzeByIdentity: (seriesIdentityKey: string, sourceId?: string, libraryId?: string) => ipcRenderer.invoke(IPC_CHANNELS.seriesAnalyzeByIdentity, seriesIdentityKey, sourceId, libraryId),
  preflightShow: (request: unknown) => ipcRenderer.invoke(IPC_CHANNELS.transcodingPreflightShow, request),
  queueShow: (preflightId: string) => ipcRenderer.invoke(IPC_CHANNELS.transcodingQueueShow, preflightId),
  approveShow: (preflightId: string) => ipcRenderer.invoke(IPC_CHANNELS.transcodingApproveShow, preflightId),
  discardShow: (preflightId: string) => ipcRenderer.invoke(IPC_CHANNELS.transcodingDiscardShow, preflightId),
  openShowSample: (preflightId: string, mediaItemId: number, index: number) => ipcRenderer.invoke(IPC_CHANNELS.transcodingOpenShowSample, preflightId, mediaItemId, index),
  listShowQuarantine: (seriesTitle: string, sourceId: string, seriesIdentityKey: string, libraryId: string) => ipcRenderer.invoke(IPC_CHANNELS.transcodingListShowQuarantine, seriesTitle, sourceId, seriesIdentityKey, libraryId),
  purgeShowQuarantine: (seriesTitle: string, sourceId: string, seriesIdentityKey: string, libraryId: string) => ipcRenderer.invoke(IPC_CHANNELS.transcodingPurgeShowQuarantine, seriesTitle, sourceId, seriesIdentityKey, libraryId),

  // Single-Item Optimization & Transcoding Aliases
  getMediaItem: (id: number) => ipcRenderer.invoke(IPC_CHANNELS.dbGetMediaItemById, id),
  getCapabilities: () => ipcRenderer.invoke(IPC_CHANNELS.transcodingGetCapabilities),
  refreshCapabilities: () => ipcRenderer.invoke(IPC_CHANNELS.transcodingRefreshCapabilities),
  checkAvailability: () => ipcRenderer.invoke(IPC_CHANNELS.transcodingCheckAvailability),
  setSelectedGpu: (gpuId: string | null) => ipcRenderer.invoke(IPC_CHANNELS.transcodingSetSelectedGpu, gpuId),
  getParameters: (mediaItemId: number, options?: unknown) => ipcRenderer.invoke(IPC_CHANNELS.transcodingGetParameters, mediaItemId, options),
  cancel: (mediaItemId?: number) => ipcRenderer.invoke(IPC_CHANNELS.transcodingCancel, mediaItemId),
  onProgress: (callback: (data: any) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, progress: any) => callback(progress)
    ipcRenderer.on(IPC_CHANNELS.transcodingProgress, handler)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.transcodingProgress, handler)
  },
}

contextBridge.exposeInMainWorld('electronAPI', electronAPI)

// Type definitions for multi-source support
export type MediaSourceResponse = DatabaseMediaSource

// ConnectionTestResult - imported from shared types above

export interface ServerInstanceResponse {
  id: string
  name: string
  address: string
  port: number
  version?: string
  isLocal?: boolean
  isOwned?: boolean
  protocol?: string
}

export interface MediaLibraryResponse {
  id: string
  name: string
  type: 'movie' | 'show' | 'music' | 'unknown'
  collectionType?: string
  itemCount?: number
  scannedAt?: string
}

export interface ScanResultResponse {
  success: boolean
  itemsScanned: number
  itemsAdded: number
  itemsUpdated: number
  itemsRemoved: number
  errors: string[]
  durationMs: number
}

export interface DiscoveredServerResponse {
  id: string
  name: string
  address: string
  endpointAddress?: string
  localAddress?: string
}

// Type definitions for window object
interface ExistingElectronAPI {
  // App lifecycle
  appReady: () => void
  getAppVersion: () => Promise<string>
  openExternal: (url: string) => Promise<void>

  // ============================================================================
  // MEDIA SOURCES (Multi-Provider Support)
  // ============================================================================

  // Source CRUD
  sourcesAdd: (config: {
    sourceType: string
    displayName: string
    connectionConfig: Record<string, unknown>
    isEnabled?: boolean
  }) => Promise<MediaSourceResponse>
  sourcesUpdate: (sourceId: string, updates: {
    displayName?: string
    connectionConfig?: Record<string, unknown>
    isEnabled?: boolean
  }) => Promise<void>
  sourcesRemove: (sourceId: string) => Promise<void>
  sourcesList: (type?: string) => Promise<MediaSourceResponse[]>
  sourcesGet: (sourceId: string) => Promise<MediaSourceResponse | null>
  sourcesGetEnabled: () => Promise<MediaSourceResponse[]>
  sourcesToggle: (sourceId: string, enabled: boolean) => Promise<void>

  // Connection Testing
  sourcesTestConnection: (sourceId: string) => Promise<ConnectionTestResult>

  // Plex-specific Auth (new flow for multi-source)
  plexStartAuth: () => Promise<{ pinId: number; code: string; authUrl: string }>
  plexCheckAuth: (pinId: number) => Promise<string | null>
  plexAuthenticateAndDiscover: (token: string, displayName: string) => Promise<{
    source: MediaSourceResponse
    servers: ServerInstanceResponse[]
  }>
  plexSelectServerForSource: (sourceId: string, serverId: string) => Promise<{
    success: boolean
    libraries?: MediaLibraryResponse[]
  }>
  plexGetServersForSource: (sourceId: string) => Promise<ServerInstanceResponse[]>

  // Library Operations
  sourcesGetLibraries: (sourceId: string) => Promise<MediaLibraryResponse[]>
  sourcesGetLibrariesWithStatus: (sourceId: string) => Promise<Array<MediaLibraryResponse & {
    isEnabled: boolean
    lastScanAt: string | null
    itemsScanned: number
    upgradeMinTier: string | null
  }>>
  sourcesToggleLibrary: (sourceId: string, libraryId: string, enabled: boolean) => Promise<{ success: boolean }>
  sourcesSetLibraryUpgradeTier: (sourceId: string, libraryId: string, minTier: string | null) => Promise<{ success: boolean }>
  sourcesSetLibrariesEnabled: (sourceId: string, libraries: Array<{
    id: string
    name: string
    type: string
    enabled: boolean
  }>) => Promise<{ success: boolean }>
  sourcesGetEnabledLibraryIds: (sourceId: string) => Promise<string[]>
  sourcesScanLibrary: (sourceId: string, libraryId: string) => Promise<ScanResultResponse>
  sourcesScanAll: () => Promise<Array<{ key: string } & ScanResultResponse>>
  sourcesStopScan: () => Promise<{ success: boolean; error?: string }>

  // Incremental Scanning
  sourcesScanLibraryIncremental: (sourceId: string, libraryId: string) => Promise<ScanResultResponse>
  sourcesScanAllIncremental: () => Promise<Array<{ key: string } & ScanResultResponse>>

  // Single Item Scan
  sourcesScanItem: (sourceId: string, libraryId: string | null, filePath: string) => Promise<ScanResultResponse>

  // Statistics
  sourcesGetStats: () => Promise<{
    totalSources: number
    enabledSources: number
    totalItems: number
    bySource: Array<{
      sourceId: string
      displayName: string
      sourceType: string
      itemCount: number
      lastScanAt?: string
    }>
  }>
  sourcesGetSupportedProviders: () => Promise<string[]>

  // Source Events
  onSourcesScanProgress: (callback: (progress: unknown) => void) => () => void

  // Library Update Events
  onLibraryUpdated: (callback: (data: { type: 'media' | 'music'; count?: number }) => void) => () => void

  // Auto-refresh Events
  onAutoRefreshStarted: (callback: () => void) => () => void
  onAutoRefreshComplete: (callback: () => void) => () => void

  // ============================================================================
  // KODI LOCAL DETECTION
  // ============================================================================

  // Detect local Kodi installation
  kodiDetectLocal: () => Promise<{
    path: string
    databasePath: string
    databaseVersion: number
    musicDatabasePath: string | null
    musicDatabaseVersion: number | null
    kodiRunning: boolean
  } | null>
  kodiIsRunning: () => Promise<boolean>

  // MediaMonkey Detection
  mediamonkeyDetectLocal: () => Promise<{
    installations: Array<{
      version: 4 | 5
      databasePath: string
      exists: boolean
    }>
    isRunning: boolean
  } | null>
  mediamonkeySelectDatabase: () => Promise<string | null>
  mediamonkeyIsRunning: () => Promise<boolean>

  // Mood sync
  moodCheckMediaMonkeyWrite: (sourceId: string) => Promise<{
    canWrite: boolean
    isRunning?: boolean
    databasePath?: string
    reason?: string
  }>
  moodGetSources: (field?: 'mood' | 'genre') => Promise<Array<{
    sourceId: string
    sourceName: string
    sourceType: string
    tracksWithMoods: number
    totalTracks: number
  }>>
  moodGetComparison: (args: { sourceOfTruthId: string; field?: 'mood' | 'genre' }) => Promise<Array<{
    trackTitle: string
    artist: string
    album: string
    sourceOfTruthMoods: string[]
    sourceOfTruthTrackId: number
    targets: Array<{
      sourceId: string
      sourceName: string
      sourceType: string
      moods: string[]
      trackId: number
      trackProviderId: string
      libraryId?: string
      hasMismatch: boolean
    }>
  }>>
  moodSyncToTarget: (args: { sourceOfTruthId: string; targetSourceId: string; trackIds?: number[]; mode?: 'overwrite' | 'append'; field?: 'mood' | 'genre' }) =>
    Promise<{ synced: number; failed: number; cacheFailed: number; skipped: number; errors: string[] }>
  onMoodSyncProgress: (callback: (progress: { current: number; total: number; currentTrack: string; trackId?: number; status?: 'syncing' | 'done' | 'failed' }) => void) => () => void

  // Kodi Collections
  kodiImportCollections: (sourceId: string) => Promise<{ imported: number; skipped: number }>
  kodiGetCollections: (sourceId: string) => Promise<Array<{
    idSet: number
    name: string
    overview: string | null
    movieCount: number
    posterUrl: string | null
    fanartUrl: string | null
  }>>
  onKodiCollectionProgress: (callback: (progress: { current: number; total: number; currentItem: string }) => void) => () => void

  // Kodi MySQL/MariaDB Connection
  kodiTestMySQLConnection: (config: {
    host: string
    port?: number
    username: string
    password: string
    databasePrefix?: string
    ssl?: boolean
    connectionTimeout?: number
  }) => Promise<{
    success: boolean
    error?: string
    serverVersion?: string
    videoDatabaseName?: string
    videoDatabaseVersion?: number
    musicDatabaseName?: string
    musicDatabaseVersion?: number
    latencyMs?: number
  }>
  kodiDetectMySQLDatabases: (config: {
    host: string
    port?: number
    username: string
    password: string
    databasePrefix?: string
  }) => Promise<{
    videoDatabase: string | null
    videoVersion: number | null
    musicDatabase: string | null
    musicVersion: number | null
  }>
  kodiAuthenticateMySQL: (config: {
    host: string
    port?: number
    username: string
    password: string
    displayName: string
    videoDatabaseName?: string
    musicDatabaseName?: string
    databasePrefix?: string
    ssl?: boolean
  }) => Promise<{
    success: boolean
    source?: MediaSourceResponse
    serverName?: string
    serverVersion?: string
    error?: string
  }>

  // ============================================================================
  // FFPROBE FILE ANALYSIS
  // ============================================================================

  // Check if FFprobe is available on the system
  ffprobeIsAvailable: () => Promise<boolean>

  // Get FFprobe version string
  ffprobeGetVersion: () => Promise<string | null>

  // Analyze a media file with FFprobe
  ffprobeAnalyzeFile: (filePath: string) => Promise<{
    success: boolean
    error?: string
    filePath: string
    container?: string
    duration?: number
    fileSize?: number
    overallBitrate?: number
    video?: {
      index: number
      codec: string
      profile?: string
      level?: number
      width: number
      height: number
      bitrate?: number
      frameRate?: number
      bitDepth?: number
      pixelFormat?: string
      colorSpace?: string
      colorTransfer?: string
      colorPrimaries?: string
      hdrFormat?: string
    }
    audioTracks: Array<{
      index: number
      codec: string
      profile?: string
      channels: number
      channelLayout?: string
      bitrate?: number
      sampleRate?: number
      bitDepth?: number
      language?: string
      title?: string
      isDefault: boolean
      hasObjectAudio: boolean
    }>
    subtitleTracks: Array<{
      index: number
      codec: string
      language?: string
      title?: string
      isDefault: boolean
      isForced: boolean
    }>
  }>

  // Enable/disable FFprobe analysis for a source
  ffprobeSetEnabled: (sourceId: string, enabled: boolean) => Promise<{ success: boolean; enabled: boolean }>

  // Check if FFprobe analysis is enabled for a source
  ffprobeIsEnabled: (sourceId: string) => Promise<boolean>

  // Check if FFprobe is available for a specific source (with reason)
  ffprobeIsAvailableForSource: (sourceId: string) => Promise<{
    available: boolean
    version?: string | null
    reason?: string | null
  }>

  // Check if FFprobe can be auto-installed on this platform
  ffprobeCanInstall: () => Promise<boolean>

  // Install FFprobe automatically
  ffprobeInstall: () => Promise<{
    success: boolean
    error?: string
    path?: string
  }>

  // Uninstall bundled FFprobe
  ffprobeUninstall: () => Promise<{ success: boolean; error?: string }>

  // Check if current FFprobe is the bundled version
  ffprobeIsBundled: () => Promise<boolean>
  ffmpegIsAvailable: () => Promise<boolean>

  // Check for FFprobe updates
  ffprobeCheckForUpdate: () => Promise<{
    currentVersion: string | null
    latestVersion: string | null
    updateAvailable: boolean
    error?: string
  }>

  // Listen for FFprobe install progress
  onFFprobeInstallProgress: (callback: (progress: { stage: string; percent: number }) => void) => () => void

  // ============================================================================
  // LOCAL FOLDER SOURCE
  // ============================================================================

  // Open folder picker dialog
  localSelectFolder: () => Promise<{ cancelled: boolean; folderPath?: string; error?: string }>

  // Detect subfolders and their media types
  localDetectSubfolders: (folderPath: string) => Promise<{
    subfolders: Array<{
      name: string
      path: string
      suggestedType: 'movies' | 'tvshows' | 'music' | 'unknown'
    }>
    error?: string
  }>

  // Add a local folder as a media source
  localAddSource: (config: {
    folderPath: string
    displayName: string
    mediaType: 'movies' | 'tvshows' | 'music' | 'mixed'
  }) => Promise<MediaSourceResponse>

  // Add a local folder with custom library configurations
  localAddSourceWithLibraries: (config: {
    folderPath: string
    displayName: string
    libraries: Array<{
      name: string
      path: string
      mediaType: 'movies' | 'tvshows' | 'music'
      enabled: boolean
    }>
  }) => Promise<MediaSourceResponse>

  // ============================================================================
  // JELLYFIN (Discovery & Quick Connect)
  // ============================================================================

  // Server Discovery
  jellyfinDiscoverServers: () => Promise<DiscoveredServerResponse[]>
  jellyfinTestServerUrl: (url: string) => Promise<{
    success: boolean
    serverName?: string
    serverId?: string
    version?: string
    error?: string
  }>

  // API Key Authentication
  jellyfinAuthenticateApiKey: (serverUrl: string, apiKey: string, displayName: string) => Promise<{
    success: boolean
    source?: MediaSourceResponse
    serverName?: string
    error?: string
  }>

  // Quick Connect
  jellyfinIsQuickConnectEnabled: (serverUrl: string) => Promise<boolean>
  jellyfinInitiateQuickConnect: (serverUrl: string) => Promise<{
    secret: string
    code: string
  } | null>
  jellyfinCheckQuickConnectStatus: (serverUrl: string, secret: string) => Promise<{
    authenticated: boolean
    error?: string
  }>
  jellyfinCompleteQuickConnect: (serverUrl: string, secret: string, displayName: string) => Promise<{
    success: boolean
    source: MediaSourceResponse
    userName?: string
  }>
  jellyfinAuthenticateCredentials: (
    serverUrl: string,
    username: string,
    password: string,
    displayName: string,
    isEmby?: boolean
  ) => Promise<{
    success: boolean
    source?: MediaSourceResponse
    userName?: string
    error?: string
  }>

  // ============================================================================
  // EMBY (Discovery)
  // ============================================================================

  // Server Discovery
  embyDiscoverServers: () => Promise<DiscoveredServerResponse[]>
  embyTestServerUrl: (url: string) => Promise<{
    success: boolean
    serverName?: string
    serverId?: string
    version?: string
    error?: string
  }>

  // API Key Authentication
  embyAuthenticateApiKey: (serverUrl: string, apiKey: string, displayName: string) => Promise<{
    success: boolean
    source?: MediaSourceResponse
    serverName?: string
    error?: string
  }>

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
  getMediaItems: (filters?: unknown) => Promise<unknown[]>
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
  dbOpenFolder: () => Promise<{ success: boolean }>
  dbExport: () => Promise<{ success: boolean; path?: string; cancelled?: boolean }>
  dbExportCSV: (options: {
    includeUpgrades: boolean
    includeMissingMovies: boolean
    includeMissingEpisodes: boolean
    includeMissingAlbums: boolean
    includeMusicUpgrades: boolean
  }) => Promise<{ success: boolean; path?: string; cancelled?: boolean }>
  dbImport: () => Promise<{ success: boolean; imported?: number; errors?: string[]; cancelled?: boolean }>
  dbReset: () => Promise<{ success: boolean }>
  dbResetLibraryData: () => Promise<{ success: boolean }>

  // Series Completeness
  seriesAnalyzeAll: (sourceId?: string, libraryId?: string) => Promise<{ completed: boolean; analyzed: number }>
  seriesAnalyze: (seriesIdentityKey: string, sourceId?: string, libraryId?: string) => Promise<unknown | null>
  seriesGetAll: (sourceId?: string) => Promise<unknown[]>
  seriesGetIncomplete: (sourceId?: string) => Promise<unknown[]>
  seriesGetStats: () => Promise<{
    totalSeries: number
    completeSeries: number
    incompleteSeries: number
    totalMissingEpisodes: number
    averageCompleteness: number
  }>
  seriesGetEpisodes: (seriesIdentityKey: string, sourceId?: string, libraryId?: string) => Promise<unknown[]>
  seriesDelete: (id: number) => Promise<boolean>
  tmdbGetMovieDetails: (tmdbId: string) => Promise<{ overview: string | null; releaseDate: string | null; runtime: number | null } | null>
  tmdbGetTVShowDetails: (tmdbId: string) => Promise<{ overview: string | null } | null>
  seriesGetSeasonDetails: (tmdbId: string, seasonNumber: number) => Promise<{ overview: string | null; episodeCount: number; airDate: string | null; name: string | null } | null>
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
  seriesFixMatch: (seriesIdentityKey: string, sourceId: string, libraryId: string | undefined, tmdbId: number) => Promise<{
    success: boolean
    updatedEpisodes: number
    completeness: unknown
    newTitle: string
    newIdentityKey: string
  }>

  // Movie Match Fixing
  movieSearchTMDB: (query: string, year?: number) => Promise<Array<{
    id: number
    title: string
    release_date: string
    physical_release_date: string | null
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

  // ============================================================================
  // MUSIC LIBRARY
  // ============================================================================
  // Music Library Scanning
  musicScanLibrary: (sourceId: string, libraryId: string) => Promise<{
    success: boolean
    itemsScanned: number
    itemsAdded: number
    itemsUpdated: number
    itemsRemoved: number
    errors: string[]
    durationMs: number
  }>
  onMusicScanProgress: (callback: (progress: unknown) => void) => () => void

  // Music Data Retrieval
  musicGetArtists: (filters?: unknown) => Promise<unknown[]>
  musicGetArtistById: (id: number) => Promise<unknown | null>
  musicGetAlbums: (filters?: unknown) => Promise<unknown[]>
  musicGetAlbumsByArtist: (artistId: number) => Promise<unknown[]>
  musicGetAlbumById: (id: number) => Promise<unknown | null>
  musicGetTracks: (filters?: unknown) => Promise<unknown[]>
  musicGetTracksByAlbum: (albumId: number) => Promise<unknown[]>
  musicGetStats: (sourceId?: string) => Promise<{
    totalArtists: number
    totalAlbums: number
    totalTracks: number
    losslessAlbums: number
    hiResAlbums: number
    avgBitrate: number
  }>
  musicCountArtists: (filters?: unknown) => Promise<number>
  musicCountAlbums: (filters?: unknown) => Promise<number>
  musicCountTracks: (filters?: unknown) => Promise<number>

  // Music Quality Analysis
  musicGetAlbumQuality: (albumId: number) => Promise<unknown | null>
  musicGetAlbumsNeedingUpgrade: (limit?: number, sourceId?: string) => Promise<unknown[]>
  musicAnalyzeAllQuality: (sourceId?: string) => Promise<{ success: boolean; analyzed: number }>
  onMusicQualityProgress: (callback: (progress: unknown) => void) => () => void

  // MusicBrainz Completeness - Unified Analysis
  musicAnalyzeAll: (sourceId?: string) => Promise<{ success: boolean }>
  musicCancelAnalysis: () => Promise<{ success: boolean }>
  onMusicAnalysisProgress: (callback: (progress: unknown) => void) => () => void

  // MusicBrainz Completeness
  musicSearchMusicBrainzArtist: (name: string) => Promise<unknown[]>
  musicAnalyzeArtistCompleteness: (artistId: number) => Promise<unknown>
  musicGetArtistCompleteness: (artistName: string) => Promise<unknown | null>
  musicGetAllArtistCompleteness: (sourceId?: string) => Promise<unknown[]>

  // Album Track Completeness
  musicAnalyzeAlbumTrackCompleteness: (albumId: number) => Promise<unknown | null>
  musicGetAlbumCompleteness: (albumId: number) => Promise<unknown | null>
  musicGetAllAlbumCompleteness: () => Promise<unknown[]>
  musicGetIncompleteAlbums: () => Promise<unknown[]>

  // Music - Match Fixing
  musicFixArtistMatch: (artistId: number, musicbrainzId: string) => Promise<{
    success: boolean
    completeness: unknown
  }>
  musicSearchMusicBrainzRelease: (artistName: string, albumTitle: string) => Promise<unknown[]>
  musicFixAlbumMatch: (albumId: number, musicbrainzReleaseGroupId: string) => Promise<{
    success: boolean
    completeness: unknown
  }>

  // Music - Cancellation
  musicCancelScan: (sourceId: string) => Promise<{ success: boolean }>

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

  // Person filmography completeness
  personGetCompleteness: (personType?: string) => Promise<Array<{
    id: number; person_type: string; person_name: string; tmdb_person_id: number
    total_movies: number; owned_movies: number; missing_movies: string; owned_movie_ids: string
    completeness_percentage: number; profile_url: string | null
  }>>
  personSearchTMDB: (query: string) => Promise<Array<{ id: number; name: string; profile_url: string | null; known_for: string; roles: string[] }>>
  personAnalyze: (personName: string, personType: string) => Promise<{
    name: string; totalMovies: number; ownedMovies: number; missingCount: number; percentage: number
  }>
  personDelete: (id: number) => Promise<void>
  // Watchlist sync
  syncPlexWatchlist: () => Promise<{ added: number; total: number }>
  syncTrakt: (username: string) => Promise<{ added: number; total: number }>
  fetchPlexWatchlist: () => Promise<Array<{ title: string; media_type: string; year?: number; tmdb_id?: string; poster_url?: string }>>
  fetchTraktWatchlist: (username: string) => Promise<Array<{ title: string; media_type: string; year?: number; tmdb_id?: string; poster_url?: string }>>
  // Release alerts
  releaseAlertsCheck: () => Promise<number>

  getStorageAnalytics: () => Promise<{
    totalSize: number; totalItems: number
    byCodec: Array<{ codec: string; count: number; size: number }>
    byTier: Array<{ tier: string; count: number; size: number }>
    codecMigration: { h264Count: number; modernCount: number; totalCount: number }
    versionStats: {
      itemsWithVersions: number; totalVersions: number
      redundantSize: number; redundantCount: number
    }
  }>
  getDuplicateMedia: () => Promise<Array<{
    tmdb_id: string
    title: string
    year: number | null
    type: string
    copies: Array<{
      id: number; source_id: string; source_type: string; library_id: string
      file_path: string | null; quality_tier: string | null
      overall_score: number | null; resolution: string | null
      video_codec: string | null; file_size: number | null
    }>
  }>>
  getLibraryHealthScores: () => Promise<Array<{
    source_id: string; library_id: string; library_name: string
    library_type: string; avg_score: number; item_count: number
  }>>
  getRecentlyUpgraded: (days?: number) => Promise<Array<{
    id: number; title: string; year: number | null; type: string
    poster_url: string | null; quality_tier: string
    previous_quality_tier: string; upgraded_at: string
    series_title: string | null; season_number: number | null; episode_number: number | null
  }>>
  getRecentlyAdded: (days?: number, limit?: number) => Promise<Array<{
    id: number; title: string; year: number | null; type: string
    source_id: string; source_type: string; poster_url: string | null
    created_at: string; quality_tier: string | null
    series_title: string | null; season_number: number | null; episode_number: number | null
  }>>

  // Database - Global Search
  mediaSearch: (query: string) => Promise<{
    movies: Array<{ id: number; title: string; year?: number; poster_url?: string }>
    tvShows: Array<{ id: number; title: string; poster_url?: string }>
    episodes: Array<{ id: number; title: string; series_title: string; season_number: number; episode_number: number; poster_url?: string }>
    artists: Array<{ id: number; name: string; thumb_url?: string }>
    albums: Array<{ id: number; title: string; artist_name: string; year?: number; thumb_url?: string }>
    tracks: Array<{ id: number; title: string; album_id?: number; album_title?: string; artist_name?: string; album_thumb_url?: string }>
  }>

  // Exclusions
  addExclusion: (exclusionType: string, referenceId?: number, referenceKey?: string, parentKey?: string, title?: string) => Promise<number>
  removeExclusion: (id: number) => Promise<void>
  getExclusions: (exclusionType?: string, parentKey?: string) => Promise<Array<{
    id: number; exclusion_type: string; reference_id: number | null; reference_key: string | null
    parent_key: string | null; title: string | null; created_at: string
  }>>

  // ============================================================================
  // WISHLIST / SHOPPING LIST
  // ============================================================================

  // Wishlist CRUD
  wishlistAdd: (item: Omit<WishlistItem, 'id' | 'added_at' | 'updated_at'>) => Promise<number>
  wishlistUpdate: (id: number, updates: Partial<WishlistItem>) => Promise<{ success: boolean }>
  wishlistRemove: (id: number) => Promise<{ success: boolean }>
  wishlistGetAll: (filters?: WishlistFilters) => Promise<Array<{
    id: number
    media_type: 'movie' | 'episode' | 'season' | 'album' | 'track'
    title: string
    subtitle?: string
    year?: number
    reason: 'missing' | 'upgrade'
    tmdb_id?: string
    imdb_id?: string
    musicbrainz_id?: string
    series_title?: string
    season_number?: number
    episode_number?: number
    collection_name?: string
    artist_name?: string
    album_title?: string
    poster_url?: string
    priority: 1 | 2 | 3 | 4 | 5
    notes?: string
    current_quality_tier?: string
    current_quality_level?: string
    current_resolution?: string
    current_video_codec?: string
    current_audio_codec?: string
    media_item_id?: number
    added_at: string
    updated_at: string
  }>>
  wishlistGetById: (id: number) => Promise<{
    id: number
    media_type: 'movie' | 'episode' | 'season' | 'album' | 'track'
    title: string
    subtitle?: string
    year?: number
    reason: 'missing' | 'upgrade'
    tmdb_id?: string
    imdb_id?: string
    musicbrainz_id?: string
    series_title?: string
    season_number?: number
    episode_number?: number
    collection_name?: string
    artist_name?: string
    album_title?: string
    poster_url?: string
    priority: 1 | 2 | 3 | 4 | 5
    notes?: string
    current_quality_tier?: string
    current_quality_level?: string
    current_resolution?: string
    current_video_codec?: string
    current_audio_codec?: string
    media_item_id?: number
    added_at: string
    updated_at: string
  } | null>
  wishlistGetCount: () => Promise<number>
  wishlistGetCountsByReason: () => Promise<{ missing: number; upgrade: number; active: number; completed: number; total: number }>
  wishlistCheckExists: (tmdbId?: string, musicbrainzId?: string, mediaItemId?: number) => Promise<boolean>
  wishlistAddBulk: (items: Array<Omit<WishlistItem, 'id' | 'added_at' | 'updated_at'>>) => Promise<{ success: boolean; added: number }>

  // Store Search
  wishlistGetStoreLinks: (item: Pick<WishlistItem, 'media_type' | 'title' | 'year' | 'series_title' | 'season_number' | 'artist_name' | 'album_title'>) => Promise<Array<{
    name: string
    url: string
    icon: string
    category: 'aggregator' | 'digital' | 'physical'
  }>>
  wishlistOpenStoreLink: (url: string) => Promise<{ success: boolean }>
  wishlistSetRegion: (region: 'us' | 'uk' | 'de' | 'fr' | 'ca' | 'au') => Promise<{ success: boolean }>
  wishlistGetRegion: () => Promise<'us' | 'uk' | 'de' | 'fr' | 'ca' | 'au'>
  wishlistExportCsv: () => Promise<{ success: boolean; path?: string; count?: number; cancelled?: boolean }>

  // Notifications (legacy)
  onNotification: (callback: (message: string) => void) => () => void

  // ============================================================================
  // LIVE MONITORING
  // ============================================================================

  // Monitoring Control
  monitoringGetConfig: () => Promise<{
    enabled: boolean
    startOnLaunch: boolean
    pauseDuringManualScan: boolean
    pollingIntervals: Record<string, number>
  }>
  monitoringSetConfig: (config: {
    enabled?: boolean
    startOnLaunch?: boolean
    pauseDuringManualScan?: boolean
    pollingIntervals?: Record<string, number>
  }) => Promise<{ success: boolean }>
  monitoringStart: () => Promise<{ success: boolean }>
  monitoringStop: () => Promise<{ success: boolean }>
  monitoringIsActive: () => Promise<boolean>
  monitoringForceCheck: (sourceId: string) => Promise<Array<{
    sourceId: string
    sourceName: string
    sourceType: string
    libraryId: string
    libraryName: string
    changeType: 'added' | 'updated' | 'removed'
    itemCount: number
    items: Array<{
      id: string
      title: string
      type: 'movie' | 'episode' | 'album' | 'track' | 'artist'
      year?: number
      posterUrl?: string
      seriesTitle?: string
      artistName?: string
    }>
    detectedAt: string
  }>>

  // Monitoring Events
  onMonitoringStatusChanged: (callback: (status: { isActive: boolean; lastCheck?: string }) => void) => () => void
  onMonitoringSourceChecked: (callback: (data: { sourceId: string; hasChanges: boolean }) => void) => () => void
  onMonitoringStatus: (callback: (status: { isActive: boolean }) => void) => () => void
  onMonitoringEvent: (callback: (event: { type: string; message: string }) => void) => () => void
  getMonitoringStatus: () => Promise<{ isActive: boolean }>

  // ============================================================================
  // NOTIFICATIONS
  // ============================================================================

  notificationsGetAll: (options?: { limit?: number, offset?: number, type?: string, unreadOnly?: boolean }) => Promise<Array<{
    id: number
    type: string
    title: string
    message: string
    sourceId?: string
    sourceName?: string
    itemCount?: number
    isRead: boolean
    createdAt: string
    readAt?: string
  }>>
  notificationsGetCount: () => Promise<{ total: number, unread: number }>
  notificationsMarkRead: (ids: number[]) => Promise<void>
  notificationsMarkAllRead: () => Promise<void>
  notificationsDelete: (ids: number[]) => Promise<void>
  notificationsClear: () => Promise<void>
  onNotificationsNew: (callback: () => void) => () => void

  // ============================================================================
  // TASK QUEUE
  // ============================================================================

  // Queue State
  taskQueueGetState: () => Promise<QueueState>

  // Task Management
  taskQueueAddTask: (definition: {
    type: 'library-scan' | 'source-scan' | 'series-completeness' | 'collection-completeness' | 'music-completeness' | 'music-scan'
    label: string
    sourceId?: string
    libraryId?: string
    artistId?: number
  }) => Promise<{ success: boolean; taskId: string }>
  taskQueueRemoveTask: (taskId: string) => Promise<{ success: boolean }>
  taskQueueReorderQueue: (taskIds: string[]) => Promise<{ success: boolean }>
  taskQueueClearQueue: () => Promise<{ success: boolean }>

  // Queue Control
  taskQueuePause: () => Promise<{ success: boolean }>
  taskQueueResume: () => Promise<{ success: boolean }>
  taskQueueCancelCurrent: () => Promise<{ success: boolean }>

  // History
  taskQueueGetTaskHistory: () => Promise<ActivityLogEntry[]>
  taskQueueGetMonitoringHistory: () => Promise<ActivityLogEntry[]>
  taskQueueClearTaskHistory: () => Promise<{ success: boolean }>
  taskQueueClearMonitoringHistory: () => Promise<{ success: boolean }>

  // Task Queue Events
  onTaskQueueUpdated: (callback: (state: QueueState) => void) => () => void
  onTaskQueueTaskComplete: (callback: (task: QueuedTask) => void) => () => void
  onScanCompleted: (callback: (data: {
    sourceId?: string
    libraryId?: string
    libraryName: string
    itemsAdded: number
    itemsUpdated: number
    itemsScanned: number
    isFirstScan: boolean
  }) => void) => () => void
  onTaskQueueHistoryUpdated: (callback: (history: TaskQueueHistory) => void) => () => void
  onWishlistAutoCompleted: (callback: (items: Array<{ id: number; title: string; reason: string; media_type: string }>) => void) => () => void
  onWishlistChanged: (callback: () => void) => () => void

  // General
  onMessage: (callback: (message: string) => void) => () => void

  // ============================================================================
  // AUTO UPDATE
  // ============================================================================
  autoUpdateGetState: () => Promise<{
    status: 'idle' | 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error'
    version?: string
    releaseNotes?: string
    downloadProgress?: { percent: number; bytesPerSecond: number; transferred: number; total: number }
    error?: string
    lastChecked?: string
  }>
  autoUpdateCheckForUpdates: () => Promise<{ success: boolean }>
  autoUpdateDownloadUpdate: () => Promise<{ success: boolean }>
  autoUpdateInstallUpdate: () => Promise<{ success: boolean }>
  onAutoUpdateStateChanged: (callback: (state: {
    status: 'idle' | 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error'
    version?: string
    releaseNotes?: string
    downloadProgress?: { percent: number; bytesPerSecond: number; transferred: number; total: number }
    error?: string
    lastChecked?: string
  }) => void) => () => void

  // ============================================================================
  // AI (GEMINI)
  // ============================================================================
  aiIsConfigured: () => Promise<boolean>
  aiGetRateLimitInfo: () => Promise<{ limited: boolean; retryAfterSeconds: number }>
  aiTestApiKey: (apiKey: string) => Promise<{ success: boolean; error?: string }>
  aiSendMessage: (params: {
    messages: Array<{ role: 'user' | 'assistant'; content: string }>
    system?: string
    maxTokens?: number
  }) => Promise<{ text: string; usage: { input_tokens: number; output_tokens: number } }>
  aiStreamMessage: (params: {
    messages: Array<{ role: 'user' | 'assistant'; content: string }>
    system?: string
    maxTokens?: number
    requestId: string
  }) => Promise<{ text: string; usage: { input_tokens: number; output_tokens: number } }>
  onAiStreamDelta: (callback: (data: { requestId: string; delta: string }) => void) => () => void
  onAiStreamComplete: (callback: (data: { requestId: string; usage?: { input_tokens: number; output_tokens: number } }) => void) => () => void
  aiChatMessage: (params: {
    messages: Array<{ role: 'user' | 'assistant'; content: string }>
    requestId: string
    viewContext?: {
      currentView: 'dashboard' | 'library'
      libraryTab?: 'movies' | 'tv' | 'music'
      selectedItem?: { title: string; type?: string; id?: number }
      activeSourceId?: string
      activeFilters?: string
    }
  }) => Promise<{ text: string; usage: { input_tokens: number; output_tokens: number }; requestId: string; actionableItems?: Array<{ title: string; year?: number; tmdb_id?: string; media_type: 'movie' | 'tv' }>; rateLimited?: boolean; retryAfterSeconds?: number }>
  onAiToolUse: (callback: (data: { requestId: string; toolName: string; input: Record<string, unknown> }) => void) => () => void
  onAiChatStreamDelta: (callback: (data: { requestId: string; delta: string }) => void) => () => void
  onAiChatStreamComplete: (callback: (data: { requestId: string }) => void) => () => void
  aiQualityReport: (params: { requestId: string }) => Promise<{ text: string; requestId: string }>
  aiUpgradePriorities: (params: { requestId: string }) => Promise<{ text: string; requestId: string }>
  aiCompletenessInsights: (params: { requestId: string }) => Promise<{ text: string; requestId: string }>
  onAiAnalysisStreamDelta: (callback: (data: { requestId: string; delta: string }) => void) => () => void
  onAiAnalysisStreamComplete: (callback: (data: { requestId: string }) => void) => () => void
  aiWishlistAdvice: (params: { requestId: string }) => Promise<{ text: string; requestId: string }>
  aiExplainQuality: (params: {
    title: string
    resolution?: string
    videoCodec?: string
    videoBitrate?: number
    audioCodec?: string
    audioChannels?: number
    hdrFormat?: string
    qualityTier?: string
    tierQuality?: string
    tierScore?: number
  }) => Promise<{ text: string }>

  // ============================================================================
  // LOGGING
  // ============================================================================
  getLogs: (limit?: number) => Promise<Array<{ id: string; timestamp: string; level: 'verbose' | 'debug' | 'info' | 'warn' | 'error'; source: string; message: string; details?: string }>>
  clearLogs: () => Promise<void>
  exportLogs: () => Promise<{
    success: boolean
    filePath?: string
    error?: string
    canceled?: boolean
  }>
  setVerboseLogging: (enabled: boolean) => Promise<{ success: boolean }>
  isVerboseLogging: () => Promise<boolean>
  getFileLoggingSettings: () => Promise<{ enabled: boolean; minLevel: string; retentionDays: number }>
  setFileLoggingSettings: (settings: { enabled?: boolean; minLevel?: string; retentionDays?: number }) => Promise<{ success: boolean }>
  openLogFolder: () => Promise<{ success: boolean }>
  onNewLog?: (callback: (entry: { id: string; timestamp: string; level: 'verbose' | 'debug' | 'info' | 'warn' | 'error'; source: string; message: string; details?: string }) => void) => () => void
  // Web Access
  webAccessGetStatus: () => Promise<{
    enabled: boolean
    port: number
    running: boolean
    connectedClients: number
    localUrl: string | null
  }>
  webAccessStart: () => Promise<{ success: boolean; message?: string }>
  webAccessStop: () => Promise<{ success: boolean }>

  // Timelines & Transcoding
  timelinesListRecipes: () => Promise<TimelineRecipeSummary[]>
  timelinesListParserPlugins: () => Promise<TimelineParserPlugin[]>
  timelinesSaveParserPlugin: (plugin: TimelineParserPluginInput) => Promise<TimelineParserPlugin[]>
  timelinesRemoveParserPlugin: (id: string) => Promise<TimelineParserPlugin[]>
  timelinesGetRecipe: (recipeId: string, options?: TimelineFetchOptions) => Promise<TimelineDefinition>
  timelinesResolveTimeline: (recipeId: string, sourceId: string | undefined, options: TimelineFetchOptions | undefined, requestId: string, showInActivity: boolean) => Promise<ResolvedTimelineResult | { cancelled: true }>
  timelinesSyncPlexPlaylist: (payload: { sourceId: string; recipeId: string; playlistTitle: string; snapshotId: string; playlistRatingKey?: string; allowStale?: boolean }, requestId: string) => Promise<PlexPlaylistSyncResult | { cancelled: true }>
  timelinesGetPlexPlaylists: (sourceId: string) => Promise<PlexPlaylistSummary[]>
  timelinesCancel: (requestId: string) => Promise<void>
  transcodingGetCapabilities: (refresh?: boolean) => Promise<TranscodingCapabilities>
  transcodingPreflightRemux: (mediaItemId: number) => Promise<unknown>
  transcodingTranscode: (mediaItemId: number, options: TranscodeOptions, requestId: string) => Promise<{ outputPath: string; outputSize: number }>
  transcodingCancel: (mediaItemId?: number) => Promise<boolean>
  onTranscodingProgress: (callback: (data: { requestId: string; mediaItemId: number; progress: number }) => void) => () => void
  duplicatesGetPending: (sourceId?: string) => Promise<MediaDuplicate[]>
  duplicatesScan: (sourceId: string | undefined, requestId: string) => Promise<number | { cancelled: true }>
  duplicatesGetRecommendation: (mediaItemIds: number[]) => Promise<any>
  duplicatesResolve: (duplicateId: number, keepItemId: number, deleteOthers: boolean) => Promise<DuplicateResolutionOutcome>
  dbCancelOperation: (requestId: string) => Promise<{ status: string }>
  operationsGetActivity: () => Promise<{ revision: number; operations: ActivityOperation[] }>
  operationsGetResult: (requestId: string) => Promise<unknown>
  operationsDismiss: (requestId: string) => Promise<void>
  onOperationsUpdated?: (callback: (snapshot: { revision: number; operations: ActivityOperation[] }) => void) => () => void
  listPlaybackTargetProfiles: () => Promise<PlaybackTargetProfile[]>
  createPlaybackTargetProfile: (input: { name: string; definition: PlaybackTargetDefinition }) => Promise<PlaybackTargetProfile>
  updatePlaybackTargetProfile: (input: { id: string; name: string; definition: PlaybackTargetDefinition }) => Promise<PlaybackTargetProfile>
  duplicatePlaybackTargetProfile: (sourceId: string, name: string) => Promise<PlaybackTargetProfile>
  deletePlaybackTargetProfile: (id: string) => Promise<boolean>
  evaluatePlaybackCompatibility: (input: { mediaItemId: number; profileId: string }) => Promise<PlaybackCompatibilityResult>
  optimizationGetPending: () => Promise<any>
  optimizationGetDecision: (mediaItemId: number) => Promise<any>
  seriesGetEpisodesByIdentity: (seriesTitle: string, sourceId: string, seriesIdentityKey: string, libraryId: string) => Promise<any[]>
  seriesGetAudioLanguagesByIdentity: (seriesTitle: string, sourceId: string, seriesIdentityKey: string, libraryId: string) => Promise<string[]>
  seriesAnalyzeByIdentity: (seriesIdentityKey: string, sourceId?: string, libraryId?: string) => Promise<any>
  preflightShow: (request: any) => Promise<any>
  queueShow: (preflightId: string) => Promise<any>
  approveShow: (preflightId: string) => Promise<any>
  discardShow: (preflightId: string) => Promise<any>
  openShowSample: (preflightId: string, mediaItemId: number, index: number) => Promise<void>
  listShowQuarantine: (seriesTitle: string, sourceId: string, seriesIdentityKey: string, libraryId: string) => Promise<any[]>
  purgeShowQuarantine: (seriesTitle: string, sourceId: string, seriesIdentityKey: string, libraryId: string) => Promise<{ purged: number }>
  getMediaItem: (id: number) => Promise<any>
  getCapabilities: () => Promise<any>
  refreshCapabilities: () => Promise<any>
  checkAvailability: () => Promise<any>
  setSelectedGpu: (gpuId: string | null) => Promise<void>
  getParameters: (mediaItemId: number, options?: any) => Promise<any>
  cancel: (mediaItemId?: number) => Promise<boolean>
  onProgress: (callback: (data: any) => void) => () => void
}

export type ElectronAPI = Omit<typeof electronAPI, keyof ExistingElectronAPI> & ExistingElectronAPI



declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}
