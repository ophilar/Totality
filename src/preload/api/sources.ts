import { ipcRenderer } from 'electron'
import { 
  ConnectionTestResult, 
  DiscoveredServerResponse, 
  MediaLibraryResponse, 
  MediaSourceResponse, 
  ScanResultResponse, 
  ServerInstanceResponse,
  LibraryType
} from './types'

export const sourcesApi = {
  // ============================================================================
  // MEDIA SOURCES (Multi-Provider Support)
  // ============================================================================

  // Source CRUD
  sourcesAdd: (config: {
    sourceType: string
    displayName: string
    connectionConfig: Record<string, unknown>
    isEnabled?: boolean
  }) => ipcRenderer.invoke('sources:add', config),
  sourcesUpdate: (sourceId: string, updates: {
    displayName?: string
    connectionConfig?: Record<string, unknown>
    isEnabled?: boolean
  }) => ipcRenderer.invoke('sources:update', sourceId, updates),
  sourcesRemove: (sourceId: string) => ipcRenderer.invoke('sources:remove', sourceId),
  sourcesList: (type?: string) => ipcRenderer.invoke('sources:list', type),
  sourcesGet: (sourceId: string) => ipcRenderer.invoke('sources:get', sourceId),
  sourcesGetEnabled: () => ipcRenderer.invoke('sources:getEnabled'),
  sourcesToggle: (sourceId: string, enabled: boolean) =>
    ipcRenderer.invoke('sources:toggle', sourceId, enabled),

  // Connection Testing
  sourcesTestConnection: (sourceId: string) =>
    ipcRenderer.invoke('sources:testConnection', sourceId),

  // Plex-specific Auth (new flow for multi-source)
  plexStartAuth: () => ipcRenderer.invoke('plex:startAuth'),
  plexCheckAuth: (pinId: number) => ipcRenderer.invoke('plex:checkAuth', pinId),
  plexAuthenticateAndDiscover: (token: string, displayName: string) =>
    ipcRenderer.invoke('plex:authenticateAndDiscover', token, displayName),
  plexSelectServerForSource: (sourceId: string, serverId: string) =>
    ipcRenderer.invoke('plex:selectServer', sourceId, serverId),
  plexGetServersForSource: (sourceId: string) =>
    ipcRenderer.invoke('plex:getServers', sourceId),

  // Library Operations
  sourcesGetLibraries: (sourceId: string) =>
    ipcRenderer.invoke('sources:getLibraries', sourceId),
  sourcesGetLibrariesWithStatus: (sourceId: string) =>
    ipcRenderer.invoke('sources:getLibrariesWithStatus', sourceId),
  sourcesToggleLibrary: (sourceId: string, libraryId: string, enabled: boolean) =>
    ipcRenderer.invoke('sources:toggleLibrary', sourceId, libraryId, enabled),
  sourcesSetLibrariesEnabled: (sourceId: string, libraries: Array<{
    id: string
    name: string
    type: string
    enabled: boolean
  }>) => ipcRenderer.invoke('sources:setLibrariesEnabled', sourceId, libraries),
  sourcesGetEnabledLibraryIds: (sourceId: string) =>
    ipcRenderer.invoke('sources:getEnabledLibraryIds', sourceId),
  sourcesScanLibrary: (sourceId: string, libraryId: string) =>
    ipcRenderer.invoke('sources:scanLibrary', sourceId, libraryId),
  sourcesScanAll: () => ipcRenderer.invoke('sources:scanAll'),
  sourcesStopScan: () => ipcRenderer.invoke('sources:stopScan'),

  // Incremental Scanning (only new/changed items since last scan)
  sourcesScanLibraryIncremental: (sourceId: string, libraryId: string) =>
    ipcRenderer.invoke('sources:scanLibraryIncremental', sourceId, libraryId),
  sourcesScanAllIncremental: () => ipcRenderer.invoke('sources:scanAllIncremental'),

  // Single Item Scan (rescan a specific file)
  sourcesScanItem: (sourceId: string, libraryId: string | null, filePath: string) =>
    ipcRenderer.invoke('sources:scanItem', sourceId, libraryId, filePath),

  // Statistics
  sourcesGetStats: () => ipcRenderer.invoke('sources:getStats'),
  sourcesGetSupportedProviders: () => ipcRenderer.invoke('sources:getSupportedProviders'),

  // Source Events
  onSourcesScanProgress: (callback: (progress: unknown) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, progress: unknown) => callback(progress)
    ipcRenderer.on('sources:scanProgress', handler)
    return () => ipcRenderer.removeListener('sources:scanProgress', handler)
  },

  // Library Update Events - fired when media items are updated during scans/analysis
  onLibraryUpdated: (callback: (data: { type: 'media' | 'music'; count?: number }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: { type: 'media' | 'music'; count?: number }) => callback(data)
    ipcRenderer.on('library:updated', handler)
    return () => ipcRenderer.removeListener('library:updated', handler)
  },

  // Auto-refresh Events - fired during incremental scan on app start
  onAutoRefreshStarted: (callback: () => void) => {
    const handler = () => callback()
    ipcRenderer.on('scan:autoRefreshStarted', handler)
    return () => ipcRenderer.removeListener('scan:autoRefreshStarted', handler)
  },
  onAutoRefreshComplete: (callback: () => void) => {
    const handler = () => callback()
    ipcRenderer.on('scan:autoRefreshComplete', handler)
    return () => ipcRenderer.removeListener('scan:autoRefreshComplete', handler)
  },

  // ============================================================================
  // KODI LOCAL DETECTION
  // ============================================================================

  // Detect local Kodi installation
  kodiDetectLocal: () => ipcRenderer.invoke('kodi:detectLocal'),
  kodiIsRunning: () => ipcRenderer.invoke('kodi:isRunning'),

  // Kodi Collections
  kodiImportCollections: (sourceId: string) => ipcRenderer.invoke('kodi:importCollections', sourceId),
  kodiGetCollections: (sourceId: string) => ipcRenderer.invoke('kodi:getCollections', sourceId),
  onKodiCollectionProgress: (callback: (progress: { current: number; total: number; currentItem: string }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, progress: { current: number; total: number; currentItem: string }) => callback(progress)
    ipcRenderer.on('kodi:collectionProgress', handler)
    return () => ipcRenderer.removeListener('kodi:collectionProgress', handler)
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
  }) => ipcRenderer.invoke('kodi:testMySQLConnection', config),

  kodiDetectMySQLDatabases: (config: {
    host: string
    port?: number
    username: string
    password: string
    databasePrefix?: string
  }) => ipcRenderer.invoke('kodi:detectMySQLDatabases', config),

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
  }) => ipcRenderer.invoke('kodi:authenticateMySQL', config),

  // ============================================================================
  // FFPROBE FILE ANALYSIS
  // ============================================================================

  // Check if FFprobe is available on the system
  ffprobeIsAvailable: () => ipcRenderer.invoke('ffprobe:isAvailable'),

  // Get FFprobe version string
  ffprobeGetVersion: () => ipcRenderer.invoke('ffprobe:getVersion'),

  // Analyze a media file with FFprobe
  ffprobeAnalyzeFile: (filePath: string) => ipcRenderer.invoke('ffprobe:analyzeFile', filePath),

  // Enable/disable FFprobe analysis for a source
  ffprobeSetEnabled: (sourceId: string, enabled: boolean) =>
    ipcRenderer.invoke('ffprobe:setEnabled', sourceId, enabled),

  // Check if FFprobe analysis is enabled for a source
  ffprobeIsEnabled: (sourceId: string) => ipcRenderer.invoke('ffprobe:isEnabled', sourceId),

  // Check if FFprobe is available for a specific source (with reason)
  ffprobeIsAvailableForSource: (sourceId: string) =>
    ipcRenderer.invoke('ffprobe:isAvailableForSource', sourceId),

  // Check if FFprobe can be auto-installed on this platform
  ffprobeCanInstall: () => ipcRenderer.invoke('ffprobe:canInstall'),

  // Install FFprobe automatically
  ffprobeInstall: () => ipcRenderer.invoke('ffprobe:install'),

  // Uninstall bundled FFprobe
  ffprobeUninstall: () => ipcRenderer.invoke('ffprobe:uninstall'),

  // Check if current FFprobe is the bundled version
  ffprobeIsBundled: () => ipcRenderer.invoke('ffprobe:isBundled'),

  // Check for FFprobe updates
  ffprobeCheckForUpdate: () => ipcRenderer.invoke('ffprobe:checkForUpdate'),

  // Listen for FFprobe install progress
  onFFprobeInstallProgress: (callback: (progress: { stage: string; percent: number }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, progress: { stage: string; percent: number }) => callback(progress)
    ipcRenderer.on('ffprobe:installProgress', handler)
    return () => ipcRenderer.removeListener('ffprobe:installProgress', handler)
  },

  // ============================================================================
  // LOCAL FOLDER SOURCE
  // ============================================================================

  // Open folder picker dialog
  localSelectFolder: () => ipcRenderer.invoke('local:selectFolder'),

  // Detect subfolders and their media types
  localDetectSubfolders: (folderPath: string) => ipcRenderer.invoke('local:detectSubfolders', folderPath),

  // File and Folder picking
  localSelectFile: (options?: unknown) => ipcRenderer.invoke('local:selectFile', options),

  // Add a local folder as a media source
  localAddSource: (config: { folderPath: string; displayName: string; mediaType: LibraryType }) =>
    ipcRenderer.invoke('local:addSource', config),

  // MediaMonkey 5 source management
  mediamonkeyTestConnection: (config: { databasePath: string }) =>
    ipcRenderer.invoke('mediamonkey:testConnection', config),
  mediamonkeyAddSource: (config: { databasePath: string; displayName: string; isEnabled: boolean }) =>
    ipcRenderer.invoke('mediamonkey:addSource', config),

  // Add a local folder with custom library configurations
  localAddSourceWithLibraries: (config: {
    folderPath: string
    displayName: string
    libraries: Array<{
      name: string
      path: string
      mediaType: LibraryType
      enabled: boolean
    }>
  }) => ipcRenderer.invoke('local:addSourceWithLibraries', config),

  // ============================================================================
  // JELLYFIN (Discovery & Quick Connect)
  // ============================================================================

  // Server Discovery
  jellyfinDiscoverServers: () => ipcRenderer.invoke('jellyfin:discoverServers'),
  jellyfinTestServerUrl: (url: string) => ipcRenderer.invoke('jellyfin:testServerUrl', url),

  // API Key Authentication
  jellyfinAuthenticateApiKey: (serverUrl: string, apiKey: string, displayName: string) =>
    ipcRenderer.invoke('jellyfin:authenticateApiKey', serverUrl, apiKey, displayName),

  // Quick Connect
  jellyfinIsQuickConnectEnabled: (serverUrl: string) =>
    ipcRenderer.invoke('jellyfin:isQuickConnectEnabled', serverUrl),
  jellyfinInitiateQuickConnect: (serverUrl: string) =>
    ipcRenderer.invoke('jellyfin:initiateQuickConnect', serverUrl),
  jellyfinCheckQuickConnectStatus: (serverUrl: string, secret: string) =>
    ipcRenderer.invoke('jellyfin:checkQuickConnectStatus', serverUrl, secret),
  jellyfinCompleteQuickConnect: (serverUrl: string, secret: string, displayName: string) =>
    ipcRenderer.invoke('jellyfin:completeQuickConnect', serverUrl, secret, displayName),
  jellyfinAuthenticateCredentials: (
    serverUrl: string,
    username: string,
    password: string,
    displayName: string,
    isEmby: boolean = false
  ) =>
    ipcRenderer.invoke('jellyfin:authenticateCredentials', serverUrl, username, password, displayName, isEmby),

  // ============================================================================
  // EMBY (Discovery)
  // ============================================================================

  // Server Discovery
  embyDiscoverServers: () => ipcRenderer.invoke('emby:discoverServers'),
  embyTestServerUrl: (url: string) => ipcRenderer.invoke('emby:testServerUrl', url),

  // API Key Authentication
  embyAuthenticateApiKey: (serverUrl: string, apiKey: string, displayName: string) =>
    ipcRenderer.invoke('emby:authenticateApiKey', serverUrl, apiKey, displayName),
}

export interface SourcesAPI {
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
  }>>
  sourcesToggleLibrary: (sourceId: string, libraryId: string, enabled: boolean) => Promise<{ success: boolean }>
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

  // File and Folder picking
  localSelectFolder: () => Promise<{ cancelled: boolean; folderPath?: string; error?: string }>
  localSelectFile: (options?: unknown) => Promise<{ cancelled: boolean; filePath?: string; error?: string }>

  // Detect subfolders and their media types
  localDetectSubfolders: (folderPath: string) => Promise<{
    subfolders: Array<{
      name: string
      path: string
      suggestedType: LibraryType
    }>
    error?: string
  }>

  // Add a local folder as a media source
  localAddSource: (config: {
    folderPath: string
    displayName: string
    mediaType: LibraryType
  }) => Promise<MediaSourceResponse>

  // MediaMonkey 5 source management
  mediamonkeyTestConnection: (config: { databasePath: string }) => Promise<ConnectionTestResult>
  mediamonkeyAddSource: (config: { databasePath: string; displayName: string; isEnabled: boolean }) => Promise<MediaSourceResponse>

  // Add a local folder with custom library configurations
  localAddSourceWithLibraries: (config: {
    folderPath: string
    displayName: string
    libraries: Array<{
      name: string
      path: string
      mediaType: LibraryType
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
}
