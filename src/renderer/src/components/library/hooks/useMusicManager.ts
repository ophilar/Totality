
import { useState, useCallback, useEffect } from 'react'
import type { 
  MusicArtist, 
  MusicAlbum, 
  MusicTrack, 
  AlbumCompletenessData, 
  ArtistCompletenessData,
  MusicStats
} from '../types'

interface UseMusicManagerOptions {
  activeSourceId: string | null
  activeLibraryId: string | null
  addToast: (toast: any) => void
}

export function useMusicManager({ activeSourceId, activeLibraryId, addToast }: UseMusicManagerOptions) {
  const [selectedArtist, setSelectedArtist] = useState<MusicArtist | null>(null)
  const [selectedAlbum, setSelectedAlbum] = useState<MusicAlbum | null>(null)
  const [albumTracks, setAlbumTracks] = useState<MusicTrack[]>([])
  const [selectedAlbumCompleteness, setSelectedAlbumCompleteness] = useState<AlbumCompletenessData | null>(null)
  const [artistCompleteness, setArtistCompleteness] = useState<Map<string, ArtistCompletenessData>>(new Map())
  const [allAlbumCompleteness, setAllAlbumCompleteness] = useState<Map<number, AlbumCompletenessData>>(new Map())
  const [musicStats, setMusicStats] = useState<MusicStats | null>(null)

  const loadAlbumTracks = useCallback(async (albumId: number) => {
    try {
      const tracks = await window.electronAPI.musicGetTracksByAlbum(albumId)
      setAlbumTracks(tracks as MusicTrack[])
    } catch (err) {
      setAlbumTracks([])
    }
  }, [])

  const loadAlbumCompleteness = useCallback(async (albumId: number) => {
    try {
      const completeness = await window.electronAPI.musicGetAlbumCompleteness(albumId)
      setSelectedAlbumCompleteness(completeness as AlbumCompletenessData | null)
    } catch {
      setSelectedAlbumCompleteness(null)
    }
  }, [])

  const loadAllMusicCompleteness = useCallback(async () => {
    try {
      const [artists, albums, exclusions] = await Promise.all([
        window.electronAPI.musicGetAllArtistCompleteness() as Promise<ArtistCompletenessData[]>,
        window.electronAPI.musicGetAllAlbumCompleteness() as Promise<AlbumCompletenessData[]>,
        window.electronAPI.getExclusions('artist_album'),
      ])

      const excludedIds = new Set(exclusions.map((e: any) => e.reference_key))
      
      const artistMap = new Map<string, ArtistCompletenessData>()
      artists.forEach(c => artistMap.set(c.artist_name, c)) // Simplification: actual filtering logic can stay in helper
      
      const albumMap = new Map<number, AlbumCompletenessData>()
      albums.forEach(c => albumMap.set(c.album_id, c))

      setArtistCompleteness(artistMap)
      setAllAlbumCompleteness(albumMap)
    } catch (err) {
      console.warn('[useMusicManager] Failed to load completeness:', err)
    }
  }, [])

  const analyzeAlbum = useCallback(async (albumId: number) => {
    try {
      await window.electronAPI.musicAnalyzeAlbumTrackCompleteness(albumId)
      await loadAlbumCompleteness(albumId)
      loadAllMusicCompleteness()
    } catch (err) {
      addToast({ title: 'Analysis failed', type: 'error' })
    }
  }, [loadAlbumCompleteness, loadAllMusicCompleteness, addToast])

  useEffect(() => {
    if (selectedAlbum) {
      loadAlbumTracks(selectedAlbum.id)
      loadAlbumCompleteness(selectedAlbum.id)
    }
  }, [selectedAlbum, loadAlbumTracks, loadAlbumCompleteness])

  return {
    selectedArtist, setSelectedArtist,
    selectedAlbum, setSelectedAlbum,
    albumTracks,
    selectedAlbumCompleteness,
    artistCompleteness,
    allAlbumCompleteness,
    musicStats, setMusicStats,
    loadAllMusicCompleteness,
    analyzeAlbum
  }
}
