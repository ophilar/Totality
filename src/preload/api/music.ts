import { IPC_CHANNELS } from '@main/constants/ipcChannels'
import { ipcRenderer } from 'electron'

export const musicApi = {
  // ============================================================================
  // MUSIC LIBRARY
  // ============================================================================

  // Music Library Scanning
  musicScanLibrary: (sourceId: string, libraryId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.MUSIC.SCAN_LIBRARY, sourceId, libraryId),
  onMusicScanProgress: (callback: (progress: unknown) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, progress: unknown) => callback(progress)
    ipcRenderer.on('music:scanProgress', handler)
    return () => ipcRenderer.removeListener('music:scanProgress', handler)
  },

  // Music Data Retrieval
  musicGetArtists: (filters?: unknown) => ipcRenderer.invoke('music:getArtists', filters),
  musicArtistList: (filters?: unknown) => ipcRenderer.invoke('music:artists:list', filters),
  musicArtistCount: (filters?: unknown) => ipcRenderer.invoke('music:artists:count', filters),
  musicGetArtist: (id: number) => ipcRenderer.invoke(IPC_CHANNELS.MUSIC.GET_ARTIST_BY_ID, id),
  musicGetAlbums: (filters?: unknown) => ipcRenderer.invoke('music:getAlbums', filters),
  musicAlbumList: (filters?: unknown) => ipcRenderer.invoke('music:albums:list', filters),
  musicAlbumCount: (filters?: unknown) => ipcRenderer.invoke('music:albums:count', filters),
  musicGetAlbumsByArtist: (artistId: number) => ipcRenderer.invoke('music:getAlbumsByArtist', artistId),
  musicGetAlbum: (id: number) => ipcRenderer.invoke(IPC_CHANNELS.MUSIC.GET_ALBUM_BY_ID, id),
  musicGetTracks: (filters?: unknown) => ipcRenderer.invoke('music:getTracks', filters),
  musicTrackList: (filters?: unknown) => ipcRenderer.invoke('music:tracks:list', filters),
  musicTrackCount: (filters?: unknown) => ipcRenderer.invoke('music:tracks:count', filters),
  musicGetTracksByAlbum: (albumId: number) => ipcRenderer.invoke(IPC_CHANNELS.MUSIC.GET_TRACKS_BY_ALBUM, albumId),
  musicGetStats: (sourceId?: string) => ipcRenderer.invoke(IPC_CHANNELS.MUSIC.GET_STATS, sourceId),
  musicCountArtists: (filters?: unknown) => ipcRenderer.invoke('music:countArtists', filters),
  musicCountAlbums: (filters?: unknown) => ipcRenderer.invoke('music:countAlbums', filters),
  musicCountTracks: (filters?: unknown) => ipcRenderer.invoke('music:countTracks', filters),

  // Music Quality Analysis
  musicGetAlbumQuality: (albumId: number) => ipcRenderer.invoke(IPC_CHANNELS.MUSIC.GET_ALBUM_QUALITY, albumId),
  musicGetAlbumsNeedingUpgrade: (limit?: number, sourceId?: string) => ipcRenderer.invoke(IPC_CHANNELS.MUSIC.GET_ALBUMS_NEEDING_UPGRADE, limit, sourceId),
  musicAnalyzeAllQuality: (sourceId?: string) => ipcRenderer.invoke(IPC_CHANNELS.MUSIC.ANALYZE_ALL_QUALITY, sourceId),
  onMusicQualityProgress: (callback: (progress: unknown) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, progress: unknown) => callback(progress)
    ipcRenderer.on('music:qualityProgress', handler)
    return () => ipcRenderer.removeListener('music:qualityProgress', handler)
  },

  // MusicBrainz Completeness - Unified Analysis (artists + albums)
  musicAnalyzeAll: (sourceId?: string) => ipcRenderer.invoke(IPC_CHANNELS.MUSIC.ANALYZE_ALL, sourceId),
  musicCancelAnalysis: () => ipcRenderer.invoke(IPC_CHANNELS.MUSIC.CANCEL_ANALYSIS),
  onMusicAnalysisProgress: (callback: (progress: unknown) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, progress: unknown) => callback(progress)
    ipcRenderer.on('music:analysisProgress', handler)
    return () => ipcRenderer.removeListener('music:analysisProgress', handler)
  },
  musicSearchMusicBrainzArtist: (name: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.MUSIC.SEARCH_MB_ARTIST, name),
  musicAnalyzeArtistCompleteness: (artistId: number) =>
    ipcRenderer.invoke(IPC_CHANNELS.MUSIC.ANALYZE_ARTIST_COMPLETENESS, artistId),
  musicGetArtistCompleteness: (artistName: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.MUSIC.GET_ARTIST_COMPLETENESS, artistName),
  musicGetAllArtistCompleteness: (sourceId?: string) => ipcRenderer.invoke(IPC_CHANNELS.MUSIC.GET_ALL_ARTIST_COMPLETENESS, sourceId),

  // Music - Album Track Completeness
  musicAnalyzeAlbumTrackCompleteness: (albumId: number) =>
    ipcRenderer.invoke(IPC_CHANNELS.MUSIC.ANALYZE_ALBUM_TRACK_COMPLETENESS, albumId),
  musicGetAlbumCompleteness: (albumId: number) =>
    ipcRenderer.invoke(IPC_CHANNELS.MUSIC.GET_ALBUM_COMPLETENESS, albumId),
  musicGetAllAlbumCompleteness: () => ipcRenderer.invoke(IPC_CHANNELS.MUSIC.GET_ALL_ALBUM_COMPLETENESS),
  musicGetIncompleteAlbums: () => ipcRenderer.invoke(IPC_CHANNELS.MUSIC.GET_INCOMPLETE_ALBUMS),

  // Music - Match Fixing
  musicFixArtistMatch: (artistId: number, musicbrainzId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.MUSIC.FIX_ARTIST_MATCH, artistId, musicbrainzId),
  musicSearchMusicBrainzRelease: (artistName: string, albumTitle: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.MUSIC.SEARCH_MB_RELEASE, artistName, albumTitle),
  musicFixAlbumMatch: (albumId: number, musicbrainzReleaseGroupId: string) =>
    ipcRenderer.invoke('music:fixAlbumMatch', albumId, musicbrainzReleaseGroupId),

  // Music - Cancellation
  musicCancelScan: (sourceId: string) => ipcRenderer.invoke(IPC_CHANNELS.MUSIC.CANCEL_SCAN, sourceId),
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
  musicGetArtist: (id: number) => Promise<unknown | null>
  musicGetAlbums: (filters?: unknown) => Promise<unknown[]>
  musicAlbumList: (filters?: unknown) => Promise<unknown[]>
  musicAlbumCount: (filters?: unknown) => Promise<number>
  musicGetAlbumsByArtist: (artistId: number) => Promise<unknown[]>
  musicGetAlbum: (id: number) => Promise<unknown | null>
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
  musicGetAllArtistCompleteness: (sourceId?: string) => Promise<any>

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
