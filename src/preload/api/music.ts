import { ipcRenderer } from 'electron'

export const musicApi = {
  // ============================================================================
  // MUSIC LIBRARY
  // ============================================================================

  // Music Library Scanning
  musicScanLibrary: (sourceId: string, libraryId: string) =>
    ipcRenderer.invoke('music:scanLibrary', sourceId, libraryId),
  onMusicScanProgress: (callback: (progress: unknown) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, progress: unknown) => callback(progress)
    ipcRenderer.on('music:scanProgress', handler)
    return () => ipcRenderer.removeListener('music:scanProgress', handler)
  },

  // Music Data Retrieval
  musicGetArtists: (filters?: unknown) => ipcRenderer.invoke('music:getArtists', filters),
  musicArtistList: (filters?: unknown) => ipcRenderer.invoke('music:artists:list', filters),
  musicArtistCount: (filters?: unknown) => ipcRenderer.invoke('music:artists:count', filters),
  musicGetArtistById: (id: number) => ipcRenderer.invoke('music:getArtistById', id),
  musicGetAlbums: (filters?: unknown) => ipcRenderer.invoke('music:getAlbums', filters),
  musicAlbumList: (filters?: unknown) => ipcRenderer.invoke('music:albums:list', filters),
  musicAlbumCount: (filters?: unknown) => ipcRenderer.invoke('music:albums:count', filters),
  musicGetAlbumsByArtist: (artistId: number) => ipcRenderer.invoke('music:getAlbumsByArtist', artistId),
  musicGetAlbumById: (id: number) => ipcRenderer.invoke('music:getAlbumById', id),
  musicGetTracks: (filters?: unknown) => ipcRenderer.invoke('music:getTracks', filters),
  musicTrackList: (filters?: unknown) => ipcRenderer.invoke('music:tracks:list', filters),
  musicTrackCount: (filters?: unknown) => ipcRenderer.invoke('music:tracks:count', filters),
  musicGetTracksByAlbum: (albumId: number) => ipcRenderer.invoke('music:getTracksByAlbum', albumId),
  musicGetStats: (sourceId?: string) => ipcRenderer.invoke('music:getStats', sourceId),
  musicCountArtists: (filters?: unknown) => ipcRenderer.invoke('music:countArtists', filters),
  musicCountAlbums: (filters?: unknown) => ipcRenderer.invoke('music:countAlbums', filters),
  musicCountTracks: (filters?: unknown) => ipcRenderer.invoke('music:countTracks', filters),

  // Music Quality Analysis
  musicGetAlbumQuality: (albumId: number) => ipcRenderer.invoke('music:getAlbumQuality', albumId),
  musicGetAlbumsNeedingUpgrade: (limit?: number, sourceId?: string) => ipcRenderer.invoke('music:getAlbumsNeedingUpgrade', limit, sourceId),
  musicAnalyzeAllQuality: (sourceId?: string) => ipcRenderer.invoke('music:analyzeAllQuality', sourceId),
  onMusicQualityProgress: (callback: (progress: unknown) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, progress: unknown) => callback(progress)
    ipcRenderer.on('music:qualityProgress', handler)
    return () => ipcRenderer.removeListener('music:qualityProgress', handler)
  },

  // MusicBrainz Completeness - Unified Analysis (artists + albums)
  musicAnalyzeAll: (sourceId?: string) => ipcRenderer.invoke('music:analyzeAll', sourceId),
  musicCancelAnalysis: () => ipcRenderer.invoke('music:cancelAnalysis'),
  onMusicAnalysisProgress: (callback: (progress: unknown) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, progress: unknown) => callback(progress)
    ipcRenderer.on('music:analysisProgress', handler)
    return () => ipcRenderer.removeListener('music:analysisProgress', handler)
  },
  musicSearchMusicBrainzArtist: (name: string) =>
    ipcRenderer.invoke('music:searchMusicBrainzArtist', name),
  musicAnalyzeArtistCompleteness: (artistId: number) =>
    ipcRenderer.invoke('music:analyzeArtistCompleteness', artistId),
  musicGetArtistCompleteness: (artistName: string) =>
    ipcRenderer.invoke('music:getArtistCompleteness', artistName),
  musicGetAllArtistCompleteness: (sourceId?: string) => ipcRenderer.invoke('music:getAllArtistCompleteness', sourceId),

  // Music - Album Track Completeness
  musicAnalyzeAlbumTrackCompleteness: (albumId: number) =>
    ipcRenderer.invoke('music:analyzeAlbumTrackCompleteness', albumId),
  musicGetAlbumCompleteness: (albumId: number) =>
    ipcRenderer.invoke('music:getAlbumCompleteness', albumId),
  musicGetAllAlbumCompleteness: () => ipcRenderer.invoke('music:getAllAlbumCompleteness'),
  musicGetIncompleteAlbums: () => ipcRenderer.invoke('music:getIncompleteAlbums'),

  // Music - Match Fixing
  musicFixArtistMatch: (artistId: number, musicbrainzId: string) =>
    ipcRenderer.invoke('music:fixArtistMatch', artistId, musicbrainzId),
  musicSearchMusicBrainzRelease: (artistName: string, albumTitle: string) =>
    ipcRenderer.invoke('music:searchMusicBrainzRelease', artistName, albumTitle),
  musicFixAlbumMatch: (albumId: number, musicbrainzReleaseGroupId: string) =>
    ipcRenderer.invoke('music:fixAlbumMatch', albumId, musicbrainzReleaseGroupId),

  // Music - Cancellation
  musicCancelScan: (sourceId: string) => ipcRenderer.invoke('music:cancelScan', sourceId),
}

export interface MusicAPI {
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
  musicArtistList: (filters?: unknown) => Promise<unknown[]>
  musicArtistCount: (filters?: unknown) => Promise<number>
  musicGetArtistById: (id: number) => Promise<unknown | null>
  musicGetAlbums: (filters?: unknown) => Promise<unknown[]>
  musicAlbumList: (filters?: unknown) => Promise<unknown[]>
  musicAlbumCount: (filters?: unknown) => Promise<number>
  musicGetAlbumsByArtist: (artistId: number) => Promise<unknown[]>
  musicGetAlbumById: (id: number) => Promise<unknown | null>
  musicGetTracks: (filters?: unknown) => Promise<unknown[]>
  musicTrackList: (filters?: unknown) => Promise<unknown[]>
  musicTrackCount: (filters?: unknown) => Promise<number>
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
}
