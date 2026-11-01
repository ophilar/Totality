import { IPC_CHANNELS } from './ipcChannels'
/**
 * IPC Channel Map
 *
 * Maps ElectronAPI method names to their IPC channel strings.
 * Used by the WebSocket transport proxy to resolve method calls to channels.
 * Channel strings are defined in the shared IPC channel registry.
 */

/** Request-response channels (ipcRenderer.invoke) */
export const RPC_CHANNEL_MAP: Record<string, string> = {
  // App lifecycle
  appReady: IPC_CHANNELS.appReady, // Note: this is ipcRenderer.send, not invoke
  getAppVersion: IPC_CHANNELS.appGetVersion,
  openExternal: IPC_CHANNELS.appOpenExternal,

  // Media Sources
  sourcesAdd: IPC_CHANNELS.sourcesAdd,
  sourcesUpdate: IPC_CHANNELS.sourcesUpdate,
  sourcesRemove: IPC_CHANNELS.sourcesRemove,
  sourcesList: IPC_CHANNELS.sourcesList,
  sourcesGet: IPC_CHANNELS.sourcesGet,
  sourcesGetEnabled: IPC_CHANNELS.sourcesGetEnabled,
  sourcesToggle: IPC_CHANNELS.sourcesToggle,
  sourcesTestConnection: IPC_CHANNELS.sourcesTestConnection,
  sourcesGetLibraries: IPC_CHANNELS.sourcesGetLibraries,
  sourcesGetLibrariesWithStatus: IPC_CHANNELS.sourcesGetLibrariesWithStatus,
  sourcesToggleLibrary: IPC_CHANNELS.sourcesToggleLibrary,
  sourcesSetLibraryUpgradeTier: IPC_CHANNELS.sourcesSetLibraryUpgradeTier,
  sourcesSetLibrariesEnabled: IPC_CHANNELS.sourcesSetLibrariesEnabled,
  sourcesGetEnabledLibraryIds: IPC_CHANNELS.sourcesGetEnabledLibraryIds,
  sourcesScanLibrary: IPC_CHANNELS.sourcesScanLibrary,
  sourcesScanAll: IPC_CHANNELS.sourcesScanAll,
  sourcesStopScan: IPC_CHANNELS.sourcesStopScan,
  sourcesScanLibraryIncremental: IPC_CHANNELS.sourcesScanLibraryIncremental,
  sourcesScanAllIncremental: IPC_CHANNELS.sourcesScanAllIncremental,
  sourcesScanItem: IPC_CHANNELS.sourcesScanItem,
  sourcesGetStats: IPC_CHANNELS.sourcesGetStats,
  sourcesGetSupportedProviders: IPC_CHANNELS.sourcesGetSupportedProviders,

  // Plex Auth
  plexStartAuth: IPC_CHANNELS.plexStartAuth,
  plexCheckAuth: IPC_CHANNELS.plexCheckAuth,
  plexAuthenticateAndDiscover: IPC_CHANNELS.plexAuthenticateAndDiscover,
  plexSelectServerForSource: IPC_CHANNELS.plexSelectServer,
  plexGetServersForSource: IPC_CHANNELS.plexGetServers,

  // Kodi
  kodiDetectLocal: IPC_CHANNELS.kodiDetectLocal,
  kodiIsRunning: IPC_CHANNELS.kodiIsRunning,
  kodiImportCollections: IPC_CHANNELS.kodiImportCollections,
  kodiGetCollections: IPC_CHANNELS.kodiGetCollections,
  kodiTestMySQLConnection: IPC_CHANNELS.kodiTestMySQLConnection,
  kodiDetectMySQLDatabases: IPC_CHANNELS.kodiDetectMySQLDatabases,
  kodiAuthenticateMySQL: IPC_CHANNELS.kodiAuthenticateMySQL,

  // MediaMonkey
  mediamonkeyDetectLocal: IPC_CHANNELS.mediamonkeyDetectLocal,
  mediamonkeySelectDatabase: IPC_CHANNELS.mediamonkeySelectDatabase,
  mediamonkeyIsRunning: IPC_CHANNELS.mediamonkeyIsRunning,

  // Mood sync
  moodCheckMediaMonkeyWrite: IPC_CHANNELS.moodCheckMediaMonkeyWrite,
  moodGetSources: IPC_CHANNELS.moodGetSources,
  moodGetComparison: IPC_CHANNELS.moodGetComparison,
  moodSyncToTarget: IPC_CHANNELS.moodSyncToTarget,

  // FFprobe
  ffprobeIsAvailable: IPC_CHANNELS.ffprobeIsAvailable,
  ffprobeGetVersion: IPC_CHANNELS.ffprobeGetVersion,
  ffprobeAnalyzeFile: IPC_CHANNELS.ffprobeAnalyzeFile,
  ffprobeSetEnabled: IPC_CHANNELS.ffprobeSetEnabled,
  ffprobeIsEnabled: IPC_CHANNELS.ffprobeIsEnabled,
  ffprobeIsAvailableForSource: IPC_CHANNELS.ffprobeIsAvailableForSource,
  ffprobeCanInstall: IPC_CHANNELS.ffprobeCanInstall,
  ffprobeInstall: IPC_CHANNELS.ffprobeInstall,
  ffprobeUninstall: IPC_CHANNELS.ffprobeUninstall,
  ffprobeIsBundled: IPC_CHANNELS.ffprobeIsBundled,
  ffmpegIsAvailable: IPC_CHANNELS.ffmpegIsAvailable,
  ffprobeCheckForUpdate: IPC_CHANNELS.ffprobeCheckForUpdate,

  // Local Folder
  localSelectFolder: IPC_CHANNELS.localSelectFolder,
  localDetectSubfolders: IPC_CHANNELS.localDetectSubfolders,
  localAddSource: IPC_CHANNELS.localAddSource,
  localAddSourceWithLibraries: IPC_CHANNELS.localAddSourceWithLibraries,

  // Jellyfin
  jellyfinDiscoverServers: IPC_CHANNELS.jellyfinDiscoverServers,
  jellyfinTestServerUrl: IPC_CHANNELS.jellyfinTestServerUrl,
  jellyfinAuthenticateApiKey: IPC_CHANNELS.jellyfinAuthenticateApiKey,
  jellyfinIsQuickConnectEnabled: IPC_CHANNELS.jellyfinIsQuickConnectEnabled,
  jellyfinInitiateQuickConnect: IPC_CHANNELS.jellyfinInitiateQuickConnect,
  jellyfinCheckQuickConnectStatus: IPC_CHANNELS.jellyfinCheckQuickConnectStatus,
  jellyfinCompleteQuickConnect: IPC_CHANNELS.jellyfinCompleteQuickConnect,
  jellyfinAuthenticateCredentials: IPC_CHANNELS.jellyfinAuthenticateCredentials,

  // Emby
  embyDiscoverServers: IPC_CHANNELS.embyDiscoverServers,
  embyTestServerUrl: IPC_CHANNELS.embyTestServerUrl,
  embyAuthenticateApiKey: IPC_CHANNELS.embyAuthenticateApiKey,

  // Quality
  qualityAnalyzeAll: IPC_CHANNELS.qualityAnalyzeAll,
  qualityGetDistribution: IPC_CHANNELS.qualityGetDistribution,
  qualityGetRecommendedFormat: IPC_CHANNELS.qualityGetRecommendedFormat,

  // Timelines
  timelinesGetPlexPlaylists: IPC_CHANNELS.timelinesGetPlexPlaylists,
  timelinesGetRecipe: IPC_CHANNELS.timelinesGetRecipe,
  timelinesListParserPlugins: IPC_CHANNELS.timelinesListParserPlugins,
  timelinesListRecipes: IPC_CHANNELS.timelinesListRecipes,
  timelinesRemoveParserPlugin: IPC_CHANNELS.timelinesRemoveParserPlugin,
  timelinesResolveTimeline: IPC_CHANNELS.timelinesResolveTimeline,
  timelinesSaveParserPlugin: IPC_CHANNELS.timelinesSaveParserPlugin,
  timelinesSyncPlexPlaylist: IPC_CHANNELS.timelinesSyncPlexPlaylist,

  // Database - Media Items
  getMediaItems: IPC_CHANNELS.dbGetMediaItems,
  getMediaItemsSlim: IPC_CHANNELS.dbGetMediaItemsSlim,
  countMediaItems: IPC_CHANNELS.dbCountMediaItems,
  getOptimizationMetrics: IPC_CHANNELS.dbGetOptimizationMetrics,
  getTVShows: IPC_CHANNELS.dbGetTVShows,
  countTVShows: IPC_CHANNELS.dbCountTVShows,
  countTVEpisodes: IPC_CHANNELS.dbCountTVEpisodes,
  getLetterOffset: IPC_CHANNELS.dbGetLetterOffset,
  getMediaItemById: IPC_CHANNELS.dbGetMediaItemById,
  upsertMediaItem: IPC_CHANNELS.dbUpsertMediaItem,
  deleteMediaItem: IPC_CHANNELS.dbDeleteMediaItem,
  getMediaItemVersions: IPC_CHANNELS.dbGetMediaItemVersions,

  // Database - Quality Scores
  getQualityScores: IPC_CHANNELS.dbGetQualityScores,
  getQualityScoreByMediaId: IPC_CHANNELS.dbGetQualityScoreByMediaId,
  upsertQualityScore: IPC_CHANNELS.dbUpsertQualityScore,

  // Database - Settings
  getSetting: IPC_CHANNELS.dbGetSetting,
  setSetting: IPC_CHANNELS.dbSetSetting,
  getAllSettings: IPC_CHANNELS.dbGetAllSettings,

  // NFS Mappings
  getNfsMappings: IPC_CHANNELS.settingsGetNfsMappings,
  setNfsMappings: IPC_CHANNELS.settingsSetNfsMappings,
  testNfsMapping: IPC_CHANNELS.settingsTestNfsMapping,

  // Database - Data Management
  dbGetPath: IPC_CHANNELS.dbGetPath,
  dbOpenFolder: IPC_CHANNELS.dbOpenFolder,
  dbExport: IPC_CHANNELS.dbExport,
  dbExportCSV: IPC_CHANNELS.dbExportCSV,
  dbImport: IPC_CHANNELS.dbImport,
  dbReset: IPC_CHANNELS.dbReset,
  dbResetLibraryData: IPC_CHANNELS.dbResetLibraryData,

  // Series Completeness
  seriesAnalyzeAll: IPC_CHANNELS.seriesAnalyzeAll,
  seriesAnalyze: IPC_CHANNELS.seriesAnalyze,
  seriesGetAll: IPC_CHANNELS.seriesGetAll,
  seriesGetIncomplete: IPC_CHANNELS.seriesGetIncomplete,
  seriesGetStats: IPC_CHANNELS.seriesGetStats,
  seriesGetEpisodes: IPC_CHANNELS.seriesGetEpisodes,
  seriesDelete: IPC_CHANNELS.seriesDelete,
  tmdbGetMovieDetails: IPC_CHANNELS.tmdbGetMovieDetails,
  tmdbGetTVShowDetails: IPC_CHANNELS.tmdbGetTVShowDetails,
  seriesGetSeasonDetails: IPC_CHANNELS.seriesGetSeasonDetails,
  seriesGetSeasonPoster: IPC_CHANNELS.seriesGetSeasonPoster,
  seriesGetEpisodeStill: IPC_CHANNELS.seriesGetEpisodeStill,
  seriesCancelAnalysis: IPC_CHANNELS.seriesCancelAnalysis,
  seriesSearchTMDB: IPC_CHANNELS.seriesSearchTMDB,
  seriesFixMatch: IPC_CHANNELS.seriesFixMatch,

  // Movie Match
  movieSearchTMDB: IPC_CHANNELS.movieSearchTMDB,
  movieFixMatch: IPC_CHANNELS.movieFixMatch,

  // Collections
  collectionsAnalyzeAll: IPC_CHANNELS.collectionsAnalyzeAll,
  collectionsGetAll: IPC_CHANNELS.collectionsGetAll,
  collectionsGetIncomplete: IPC_CHANNELS.collectionsGetIncomplete,
  collectionsGetStats: IPC_CHANNELS.collectionsGetStats,
  collectionsDelete: IPC_CHANNELS.collectionsDelete,
  collectionsCancelAnalysis: IPC_CHANNELS.collectionsCancelAnalysis,

  // Music
  musicScanLibrary: IPC_CHANNELS.musicScanLibrary,
  musicGetArtists: IPC_CHANNELS.musicGetArtists,
  musicGetArtistById: IPC_CHANNELS.musicGetArtistById,
  musicGetAlbums: IPC_CHANNELS.musicGetAlbums,
  musicGetAlbumsByArtist: IPC_CHANNELS.musicGetAlbumsByArtist,
  musicGetAlbumById: IPC_CHANNELS.musicGetAlbumById,
  musicGetTracks: IPC_CHANNELS.musicGetTracks,
  musicGetTracksByAlbum: IPC_CHANNELS.musicGetTracksByAlbum,
  musicGetStats: IPC_CHANNELS.musicGetStats,
  musicCountArtists: IPC_CHANNELS.musicCountArtists,
  musicCountAlbums: IPC_CHANNELS.musicCountAlbums,
  musicCountTracks: IPC_CHANNELS.musicCountTracks,
  musicGetAlbumQuality: IPC_CHANNELS.musicGetAlbumQuality,
  musicGetAlbumsNeedingUpgrade: IPC_CHANNELS.musicGetAlbumsNeedingUpgrade,
  musicAnalyzeAllQuality: IPC_CHANNELS.musicAnalyzeAllQuality,
  musicAnalyzeAll: IPC_CHANNELS.musicAnalyzeAll,
  musicCancelAnalysis: IPC_CHANNELS.musicCancelAnalysis,
  musicSearchMusicBrainzArtist: IPC_CHANNELS.musicSearchMusicBrainzArtist,
  musicAnalyzeArtistCompleteness: IPC_CHANNELS.musicAnalyzeArtistCompleteness,
  musicGetArtistCompleteness: IPC_CHANNELS.musicGetArtistCompleteness,
  musicGetAllArtistCompleteness: IPC_CHANNELS.musicGetAllArtistCompleteness,
  musicAnalyzeAlbumTrackCompleteness: IPC_CHANNELS.musicAnalyzeAlbumTrackCompleteness,
  musicGetAlbumCompleteness: IPC_CHANNELS.musicGetAlbumCompleteness,
  musicGetAllAlbumCompleteness: IPC_CHANNELS.musicGetAllAlbumCompleteness,
  musicGetIncompleteAlbums: IPC_CHANNELS.musicGetIncompleteAlbums,
  musicFixArtistMatch: IPC_CHANNELS.musicFixArtistMatch,
  musicSearchMusicBrainzRelease: IPC_CHANNELS.musicSearchMusicBrainzRelease,
  musicFixAlbumMatch: IPC_CHANNELS.musicFixAlbumMatch,
  musicCancelScan: IPC_CHANNELS.musicCancelScan,

  // Statistics
  getLibraryStats: IPC_CHANNELS.dbGetLibraryStats,
  getStorageAnalytics: IPC_CHANNELS.dbGetStorageAnalytics,
  getDuplicateMedia: IPC_CHANNELS.dbGetDuplicateMedia,
  getLibraryHealthScores: IPC_CHANNELS.dbGetLibraryHealthScores,
  getRecentlyUpgraded: IPC_CHANNELS.dbGetRecentlyUpgraded,
  getRecentlyAdded: IPC_CHANNELS.dbGetRecentlyAdded,

  // Person completeness
  personGetCompleteness: IPC_CHANNELS.personGetCompleteness,
  personSearchTMDB: IPC_CHANNELS.personSearchTMDB,
  personAnalyze: IPC_CHANNELS.personAnalyze,
  personDelete: IPC_CHANNELS.personDelete,

  // Watchlist sync
  syncPlexWatchlist: IPC_CHANNELS.syncPlexWatchlist,
  syncTrakt: IPC_CHANNELS.syncTrakt,
  fetchPlexWatchlist: IPC_CHANNELS.syncFetchPlex,
  fetchTraktWatchlist: IPC_CHANNELS.syncFetchTrakt,

  // Release alerts
  releaseAlertsCheck: IPC_CHANNELS.releaseAlertsCheck,

  // Search
  mediaSearch: IPC_CHANNELS.mediaSearch,

  // Exclusions
  addExclusion: IPC_CHANNELS.dbAddExclusion,
  removeExclusion: IPC_CHANNELS.dbRemoveExclusion,
  getExclusions: IPC_CHANNELS.dbGetExclusions,

  // Wishlist
  wishlistAdd: IPC_CHANNELS.wishlistAdd,
  wishlistUpdate: IPC_CHANNELS.wishlistUpdate,
  wishlistRemove: IPC_CHANNELS.wishlistRemove,
  wishlistGetAll: IPC_CHANNELS.wishlistGetAll,
  wishlistGetById: IPC_CHANNELS.wishlistGetById,
  wishlistGetCount: IPC_CHANNELS.wishlistGetCount,
  wishlistCheckExists: IPC_CHANNELS.wishlistCheckExists,
  wishlistAddBulk: IPC_CHANNELS.wishlistAddBulk,
  wishlistGetCountsByReason: IPC_CHANNELS.wishlistGetCountsByReason,
  wishlistGetStoreLinks: IPC_CHANNELS.wishlistGetStoreLinks,
  wishlistOpenStoreLink: IPC_CHANNELS.wishlistOpenStoreLink,
  wishlistSetRegion: IPC_CHANNELS.wishlistSetRegion,
  wishlistGetRegion: IPC_CHANNELS.wishlistGetRegion,
  wishlistExportCsv: IPC_CHANNELS.wishlistExportCsv,

  // Monitoring
  monitoringGetConfig: IPC_CHANNELS.monitoringGetConfig,
  monitoringSetConfig: IPC_CHANNELS.monitoringSetConfig,
  monitoringStart: IPC_CHANNELS.monitoringStart,
  monitoringStop: IPC_CHANNELS.monitoringStop,
  monitoringIsActive: IPC_CHANNELS.monitoringIsActive,
  monitoringForceCheck: IPC_CHANNELS.monitoringForceCheck,
  getMonitoringStatus: IPC_CHANNELS.monitoringGetStatus,

  // Notifications
  notificationsGetAll: IPC_CHANNELS.notificationsGetAll,
  notificationsGetCount: IPC_CHANNELS.notificationsGetCount,
  notificationsMarkRead: IPC_CHANNELS.notificationsMarkRead,
  notificationsMarkAllRead: IPC_CHANNELS.notificationsMarkAllRead,
  notificationsDelete: IPC_CHANNELS.notificationsDelete,
  notificationsClear: IPC_CHANNELS.notificationsClear,

  // Background activity
  dbCancelOperation: IPC_CHANNELS.dbCancelOperation,
  operationsDismiss: IPC_CHANNELS.operationsDismiss,
  operationsGetActivity: IPC_CHANNELS.operationsGetActivity,
  operationsGetResult: IPC_CHANNELS.operationsGetResult,
  operationsSetPaused: IPC_CHANNELS.operationsSetPaused,

  // Task Queue
  taskQueueGetState: IPC_CHANNELS.taskQueueGetState,
  taskQueueAddTask: IPC_CHANNELS.taskQueueAddTask,
  taskQueueRemoveTask: IPC_CHANNELS.taskQueueRemoveTask,
  taskQueueReorderQueue: IPC_CHANNELS.taskQueueReorderQueue,
  taskQueueClearQueue: IPC_CHANNELS.taskQueueClearQueue,
  taskQueuePause: IPC_CHANNELS.taskQueuePause,
  taskQueueResume: IPC_CHANNELS.taskQueueResume,
  taskQueueCancelCurrent: IPC_CHANNELS.taskQueueCancelCurrent,
  taskQueueGetTaskHistory: IPC_CHANNELS.taskQueueGetTaskHistory,
  taskQueueGetMonitoringHistory: IPC_CHANNELS.taskQueueGetMonitoringHistory,
  taskQueueClearTaskHistory: IPC_CHANNELS.taskQueueClearTaskHistory,
  taskQueueClearMonitoringHistory: IPC_CHANNELS.taskQueueClearMonitoringHistory,

  // Auto Update
  autoUpdateGetState: IPC_CHANNELS.autoUpdateGetState,
  autoUpdateCheckForUpdates: IPC_CHANNELS.autoUpdateCheckForUpdates,
  autoUpdateDownloadUpdate: IPC_CHANNELS.autoUpdateDownloadUpdate,
  autoUpdateInstallUpdate: IPC_CHANNELS.autoUpdateInstallUpdate,

  // AI
  aiIsConfigured: IPC_CHANNELS.aiIsConfigured,
  aiGetRateLimitInfo: IPC_CHANNELS.aiGetRateLimitInfo,
  aiTestApiKey: IPC_CHANNELS.aiTestApiKey,
  aiSendMessage: IPC_CHANNELS.aiSendMessage,
  aiStreamMessage: IPC_CHANNELS.aiStreamMessage,
  aiChatMessage: IPC_CHANNELS.aiChatMessage,
  aiQualityReport: IPC_CHANNELS.aiQualityReport,
  aiUpgradePriorities: IPC_CHANNELS.aiUpgradePriorities,
  aiCompletenessInsights: IPC_CHANNELS.aiCompletenessInsights,
  aiWishlistAdvice: IPC_CHANNELS.aiWishlistAdvice,
  aiStorageOptimization: IPC_CHANNELS.aiStorageOptimization,
  aiMusicQualityReport: IPC_CHANNELS.aiMusicQualityReport,
  aiExplainQuality: IPC_CHANNELS.aiExplainQuality,

  // Logging
  getLogs: IPC_CHANNELS.logsGetAll,
  clearLogs: IPC_CHANNELS.logsClear,
  exportLogs: IPC_CHANNELS.logsExport,
  setVerboseLogging: IPC_CHANNELS.logsSetVerbose,
  isVerboseLogging: IPC_CHANNELS.logsIsVerbose,
  getFileLoggingSettings: IPC_CHANNELS.logsGetFileLoggingSettings,
  setFileLoggingSettings: IPC_CHANNELS.logsSetFileLoggingSettings,
  openLogFolder: IPC_CHANNELS.logsOpenLogFolder,

  // Web Access
  webAccessGetStatus: IPC_CHANNELS.webAccessGetStatus,
  webAccessStart: IPC_CHANNELS.webAccessStart,
  webAccessStop: IPC_CHANNELS.webAccessStop,
}

/** Event channels (ipcRenderer.on) — maps listener method name to channel */
export const EVENT_CHANNEL_MAP: Record<string, string> = {
  onSourcesScanProgress: IPC_CHANNELS.sourcesScanProgress,
  onLibraryUpdated: IPC_CHANNELS.libraryUpdated,
  onAutoRefreshStarted: IPC_CHANNELS.scanAutoRefreshStarted,
  onAutoRefreshComplete: IPC_CHANNELS.scanAutoRefreshComplete,
  onMoodSyncProgress: IPC_CHANNELS.moodSyncProgress,
  onKodiCollectionProgress: IPC_CHANNELS.kodiCollectionProgress,
  onFFprobeInstallProgress: IPC_CHANNELS.ffprobeInstallProgress,
  onQualityAnalysisProgress: IPC_CHANNELS.qualityAnalysisProgress,
  onSettingsChanged: IPC_CHANNELS.settingsChanged,
  onSeriesProgress: IPC_CHANNELS.seriesProgress,
  onCollectionsProgress: IPC_CHANNELS.collectionsProgress,
  onMusicScanProgress: IPC_CHANNELS.musicScanProgress,
  onMusicQualityProgress: IPC_CHANNELS.musicQualityProgress,
  onMusicAnalysisProgress: IPC_CHANNELS.musicAnalysisProgress,
  onMonitoringStatusChanged: IPC_CHANNELS.monitoringStatusChanged,
  onMonitoringSourceChecked: IPC_CHANNELS.monitoringSourceChecked,
  onMonitoringStatus: IPC_CHANNELS.monitoringStatus,
  onMonitoringEvent: IPC_CHANNELS.monitoringEvent,
  onNotification: IPC_CHANNELS.notification,
  onNotificationsNew: IPC_CHANNELS.notificationsNew,
  onOperationsUpdated: IPC_CHANNELS.operationsUpdated,
  onTaskQueueUpdated: IPC_CHANNELS.taskQueueUpdated,
  onTaskQueueTaskComplete: IPC_CHANNELS.taskQueueTaskComplete,
  onScanCompleted: IPC_CHANNELS.scanCompleted,
  onTaskQueueHistoryUpdated: IPC_CHANNELS.taskQueueHistoryUpdated,
  onWishlistAutoCompleted: IPC_CHANNELS.wishlistAutoCompleted,
  onWishlistChanged: IPC_CHANNELS.wishlistChanged,
  onMessage: IPC_CHANNELS.mainProcessMessage,
  onAutoUpdateStateChanged: IPC_CHANNELS.autoUpdateStateChanged,
  onAiStreamDelta: IPC_CHANNELS.aiStreamDelta,
  onAiStreamComplete: IPC_CHANNELS.aiStreamComplete,
  onAiToolUse: IPC_CHANNELS.aiToolUse,
  onAiChatStreamDelta: IPC_CHANNELS.aiChatStreamDelta,
  onAiChatStreamComplete: IPC_CHANNELS.aiChatStreamComplete,
  onAiAnalysisStreamDelta: IPC_CHANNELS.aiAnalysisStreamDelta,
  onAiAnalysisStreamComplete: IPC_CHANNELS.aiAnalysisStreamComplete,
  onNewLog: IPC_CHANNELS.logsNew,
}

/** Channels that must NOT be exposed to web clients */
export const WEB_DENIED_CHANNELS = new Set<string>([
  // File system / shell operations
  IPC_CHANNELS.appOpenExternal,
  IPC_CHANNELS.dbOpenFolder,
  IPC_CHANNELS.dbExport,
  IPC_CHANNELS.dbExportCSV,
  IPC_CHANNELS.dbImport,
  IPC_CHANNELS.dbGetPath,
  IPC_CHANNELS.sourcesScanItem,
  IPC_CHANNELS.localSelectFolder,
  IPC_CHANNELS.logsExport,
  IPC_CHANNELS.logsOpenLogFolder,
  IPC_CHANNELS.wishlistOpenStoreLink,
  IPC_CHANNELS.wishlistExportCsv,
  IPC_CHANNELS.mediamonkeySelectDatabase,
  // Auto-update (desktop only)
  IPC_CHANNELS.autoUpdateGetState,
  IPC_CHANNELS.autoUpdateCheckForUpdates,
  IPC_CHANNELS.autoUpdateDownloadUpdate,
  IPC_CHANNELS.autoUpdateInstallUpdate,
  // Destructive operations
  IPC_CHANNELS.dbReset,
  IPC_CHANNELS.dbResetLibraryData,
  // db:getAllSettings — handled separately via response filtering (strips sensitive values)
  // Sources with raw credentials (handled separately via response filtering)
  IPC_CHANNELS.sourcesGet,             // Single source with decrypted connection_config
  // Web access control (prevent web clients from modifying their own auth)
  IPC_CHANNELS.webAccessGetStatus,
  IPC_CHANNELS.webAccessStart,
  IPC_CHANNELS.webAccessStop,
])

/** Settings keys that web clients must NOT read via db:getSetting */
export const WEB_SENSITIVE_SETTINGS = new Set([
  'plex_token',
  'tmdb_api_key',
  'gemini_api_key',
  'musicbrainz_api_token',
  'web_access_pin',
  'web_access_enabled',
  'web_access_port',
  'web_access_session_timeout',
])
