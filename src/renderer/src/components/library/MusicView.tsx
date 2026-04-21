import React, { useState, useEffect, useMemo, useCallback, memo, useRef } from 'react'
import { createPortal } from 'react-dom'
import { VirtuosoGrid } from 'react-virtuoso'
import { MediaGridView } from './MediaGridView'
import { Music, Disc3, User, MoreVertical, RefreshCw, X, Pencil, CircleFadingArrowUp, Trash2, EyeOff, ChevronDown, ChevronUp, Copy, Check, HardDrive } from 'lucide-react'
import { AddToWishlistButton } from '../wishlist/AddToWishlistButton'
import { SlimDownBanner } from './SlimDownBanner'
import { ArtistCard } from './music/ArtistCard'
import { AlbumCard } from './music/AlbumCard'
import { TrackListItem } from './music/TrackListItem'
import { ArtistListItem } from './music/ArtistListItem'
import { AlbumListItem } from './music/AlbumListItem'
import { MissingAlbumCard } from './music/MissingAlbumCard'
import { MissingAlbumListItem } from './music/MissingAlbumListItem'
import { MusicAlbumDetails } from './music/MusicAlbumDetails'
import { MusicArtistDetails } from './music/MusicArtistDetails'
import { useMenuClose } from '../../hooks/useMenuClose'
import { providerColors } from './mediaUtils'
import type {
  MusicArtist,
  MusicAlbum,
  MusicTrack,
  MusicStats,
  MissingAlbum,
  MissingTrack,
  ArtistCompletenessData,
  AlbumCompletenessData
} from './types'

// Utility to format bytes into readable strings
const formatBytes = (bytes: number) => {
  if (!bytes || bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
}

// ============================================================================
// MUSIC VIEW COMPONENTS
// ============================================================================

export function MusicView({
  artists,
  totalArtistCount,
  artistsLoading,
  onLoadMoreArtists,
  albums,
  tracks,
  allTracks,
  totalTrackCount,
  tracksLoading,
  onLoadMoreTracks,
  totalAlbumCount,
  albumsLoading,
  onLoadMoreAlbums,
  albumSortColumn,
  albumSortDirection,
  onAlbumSortChange,
  stats,
  selectedArtist,
  selectedAlbum,
  artistCompleteness,
  albumCompleteness,
  allAlbumCompleteness,
  musicViewMode,
  trackSortColumn,
  trackSortDirection,
  onTrackSortChange,
  onSelectArtist,
  onSelectAlbum,
  onBack,
  gridScale,
  viewType,
  searchQuery,
  qualityFilter,
  showSourceBadge,
  onAnalyzeAlbum,
  onAnalyzeArtist,
  onArtistCompletenessUpdated,
  onFixArtistMatch,
  onFixAlbumMatch,
  onRescanTrack,
  includeEps,
  includeSingles,
  scrollElement,
  onDismissMissingAlbum,
  sortBy,
  onSortChange,
  slimDown
}: {
  artists: MusicArtist[]
  totalArtistCount: number
  artistsLoading: boolean
  onLoadMoreArtists: () => void
  albums: MusicAlbum[]
  tracks: MusicTrack[]
  allTracks: MusicTrack[]
  totalTrackCount: number
  tracksLoading: boolean
  onLoadMoreTracks: () => void
  totalAlbumCount: number
  albumsLoading: boolean
  onLoadMoreAlbums: () => void
  albumSortColumn: 'title' | 'artist'
  albumSortDirection: 'asc' | 'desc'
  onAlbumSortChange: (column: 'title' | 'artist', direction: 'asc' | 'desc') => void
  stats: MusicStats | null
  selectedArtist: MusicArtist | null
  selectedAlbum: MusicAlbum | null
  artistCompleteness: Map<string, ArtistCompletenessData>
  albumCompleteness: AlbumCompletenessData | null
  allAlbumCompleteness: Map<number, AlbumCompletenessData>
  musicViewMode: 'artists' | 'albums' | 'tracks'
  trackSortColumn: 'title' | 'artist' | 'album' | 'codec' | 'duration'
  trackSortDirection: 'asc' | 'desc'
  onTrackSortChange: (column: 'title' | 'artist' | 'album' | 'codec' | 'duration', direction: 'asc' | 'desc') => void
  onSelectArtist: (artist: MusicArtist) => void
  onSelectAlbum: (album: MusicAlbum) => void
  onBack: () => void
  gridScale: number
  viewType: 'grid' | 'list'
  searchQuery: string
  qualityFilter: 'all' | 'low' | 'medium' | 'high'
  showSourceBadge: boolean
  onAnalyzeAlbum: (albumId: number) => Promise<void>
  onAnalyzeArtist: (artistId: number) => Promise<void>
  onArtistCompletenessUpdated: () => void
  onFixArtistMatch?: (artistId: number, artistName: string) => void
  onFixAlbumMatch?: (albumId: number, albumTitle: string, artistName: string) => void
  onRescanTrack?: (track: MusicTrack) => Promise<void>
  includeEps: boolean
  includeSingles: boolean
  scrollElement?: HTMLElement | null
  onDismissMissingAlbum?: (album: MissingAlbum, artistName: string, artistMusicbrainzId?: string) => Promise<void>
  sortBy: 'title' | 'efficiency' | 'waste' | 'size'
  onSortChange: (sort: 'title' | 'efficiency' | 'waste' | 'size') => void
  slimDown: boolean
}) {
  const [isAnalyzingAlbum, setIsAnalyzingAlbum] = useState(false)
  const [isAnalyzingArtist, setIsAnalyzingArtist] = useState(false)
  const [showArtistMenu, setShowArtistMenu] = useState(false)
  const [bioExpanded, setBioExpanded] = useState(false)
  const [copiedTitle, setCopiedTitle] = useState(false)
  useEffect(() => { setBioExpanded(false); setCopiedTitle(false) }, [selectedArtist])
  const artistMenuRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!showArtistMenu) return
    const handle = (e: MouseEvent) => {
      if (artistMenuRef.current && !artistMenuRef.current.contains(e.target as Node)) setShowArtistMenu(false)
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [showArtistMenu])
  const [trackMenuOpen, setTrackMenuOpen] = useState<string | number | null>(null)
  const [rescanningTrackId, setRescanningTrackId] = useState<string | number | null>(null)
  const trackMenuRef = useRef<HTMLDivElement>(null)
    


  // Click-outside and Escape key handler for track menu
  useEffect(() => {
    if (trackMenuOpen === null) return

    const handleClickOutside = (event: MouseEvent) => {
      if (trackMenuRef.current && !trackMenuRef.current.contains(event.target as Node)) {
        setTrackMenuOpen(null)
      }
    }
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setTrackMenuOpen(null)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [trackMenuOpen])

  // Handle track rescan
  const handleTrackRescan = async (trackId: string | number, originalTrack: MusicTrack | undefined) => {
    if (!originalTrack || !onRescanTrack) return
    setTrackMenuOpen(null)
    setRescanningTrackId(trackId)
    try {
      await onRescanTrack(originalTrack)
    } finally {
      setRescanningTrackId(null)
    }
  }
  const [selectedTrackForQuality, setSelectedTrackForQuality] = useState<{
    title: string
    codec?: string
    bitrate?: number
    sample_rate?: number
    bit_depth?: number
    is_lossless?: boolean
    qualityTier: string | null
    artist_name?: string
    album_title?: string
  } | null>(null)

  // Track list column state
  const [trackColumnWidths, setTrackColumnWidths] = useState({
    title: 200,
    artist: 160,
    album: 180,
    quality: 60,
    codec: 70,
    duration: 60
  })
  // trackSortColumn and trackSortDirection are now passed as props from parent

  // Album sort state is now passed from parent (for server-side pagination)
  const [resizingColumn, setResizingColumn] = useState<string | null>(null)
  const resizeStartX = useRef(0)
  const resizeStartWidth = useRef(0)

  // Column resize handlers - use refs to avoid re-renders during drag
  const pendingWidthRef = useRef<number>(0)
  const rafIdRef = useRef<number | null>(null)

  const handleResizeStart = (column: string, e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setResizingColumn(column)
    resizeStartX.current = e.clientX
    resizeStartWidth.current = trackColumnWidths[column as keyof typeof trackColumnWidths]
    pendingWidthRef.current = resizeStartWidth.current
  }

  useEffect(() => {
    if (!resizingColumn) return

    const handleMouseMove = (e: MouseEvent) => {
      const delta = e.clientX - resizeStartX.current
      pendingWidthRef.current = Math.max(50, resizeStartWidth.current + delta)

      // Use RAF to batch updates and update only the header visually during drag
      if (rafIdRef.current) cancelAnimationFrame(rafIdRef.current)
      rafIdRef.current = requestAnimationFrame(() => {
        const header = document.querySelector(`[data-resize-column="${resizingColumn}"]`) as HTMLElement
        if (header) header.style.width = `${pendingWidthRef.current}px`
      })
    }

    const handleMouseUp = () => {
      // Only update state once on mouse up
      if (rafIdRef.current) cancelAnimationFrame(rafIdRef.current)
      setTrackColumnWidths(prev => ({ ...prev, [resizingColumn]: pendingWidthRef.current }))
      setResizingColumn(null)
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
      if (rafIdRef.current) cancelAnimationFrame(rafIdRef.current)
    }
  }, [resizingColumn])

  // Column sort handler for tracks (delegates to parent via prop)
  const handleTrackSort = (column: 'title' | 'artist' | 'album' | 'codec' | 'duration') => {
    if (trackSortColumn === column) {
      onTrackSortChange(column, trackSortDirection === 'asc' ? 'desc' : 'asc')
    } else {
      onTrackSortChange(column, 'asc')
    }
  }

  // Column sort handler for albums (delegates to parent via prop)
  const handleAlbumSort = (column: 'title' | 'artist') => {
    if (albumSortColumn === column) {
      onAlbumSortChange(column, albumSortDirection === 'asc' ? 'desc' : 'asc')
    } else {
      onAlbumSortChange(column, 'asc')
    }
  }

  // Wrapper to handle analyze with loading state
  const handleAnalyzeAlbum = async (albumId: number) => {
    setIsAnalyzingAlbum(true)
    try {
      await onAnalyzeAlbum(albumId)
    } finally {
      setIsAnalyzingAlbum(false)
    }
  }

  // Wrapper to handle artist analysis with loading state
  const handleAnalyzeArtist = async (artistId: number) => {
    setIsAnalyzingArtist(true)
    try {
      await onAnalyzeArtist(artistId)
      onArtistCompletenessUpdated()
    } finally {
      setIsAnalyzingArtist(false)
    }
  }

  // Map scale to minimum poster width
  const posterMinWidth = useMemo(() => {
    const widthMap: Record<number, number> = {
      1: 120, 2: 140, 3: 160, 4: 180, 5: 200, 6: 240, 7: 300
    }
    return widthMap[gridScale] || widthMap[5]
  }, [gridScale])

  // Create lookup maps for artist and album names
  const artistNameMap = useMemo(() => {
    const map = new Map<number, string>()
    artists.forEach(a => { if (a.id !== undefined) map.set(a.id, a.name) })
    return map
  }, [artists])

  const albumInfoMap = useMemo(() => {
    const map = new Map<number, { title: string; artistName?: string }>()
    albums.forEach(a => { if (a.id !== undefined) map.set(a.id, { title: a.title, artistName: a.artist_name }) })
    return map
  }, [albums])

  // Artists are now filtered and sorted server-side via pagination

  // Filter albums for selected artist or all albums
  const filteredAlbums = useMemo(() => {
    let filtered = selectedArtist
      ? albums.filter(a => a.artist_id === selectedArtist.id || a.artist_name === selectedArtist.name)
      : albums

    // Apply search filter when not viewing a specific artist
    if (!selectedArtist && searchQuery.trim()) {
      filtered = filtered.filter(album =>
        album.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        album.artist_name.toLowerCase().includes(searchQuery.toLowerCase())
      )
    }

    return filtered.sort((a, b) => (a.year || 0) - (b.year || 0))
  }, [albums, selectedArtist, searchQuery])

  // Albums are now filtered/sorted server-side via loadPaginatedAlbums
  const allFilteredAlbums = useMemo(() => {
    if (sortBy === 'title') return albums

    const result = [...albums]
    result.sort((a, b) => {
      const compA = a.id ? allAlbumCompleteness.get(a.id) : undefined
      const compB = b.id ? allAlbumCompleteness.get(b.id) : undefined

      if (sortBy === 'efficiency') {
        const effA = (compA as any)?.efficiency_score ?? 100
        const effB = (compB as any)?.efficiency_score ?? 100
        if (effA !== effB) return effA - effB
      } else if (sortBy === 'waste') {
        const wasteA = (compA as any)?.storage_debt_bytes ?? 0
        const wasteB = (compB as any)?.storage_debt_bytes ?? 0
        if (wasteA !== wasteB) return wasteB - wasteA
      } else if (sortBy === 'size') {
        const sizeA = (compA as any)?.total_size ?? 0
        const sizeB = (compB as any)?.total_size ?? 0
        if (sizeA !== sizeB) return sizeB - sizeA
      }
      return 0
    })
    return result
  }, [albums, sortBy, allAlbumCompleteness])

  // Tracks are now loaded from the server pre-filtered/sorted/paginated.
  // Quality filter is still applied client-side on the loaded page (lightweight).
  const filteredTracks = useMemo(() => {
    const result = [...allTracks]

    // Apply sorting first
    if (sortBy === 'efficiency') {
      result.sort((a, b) => (a.efficiency_score ?? 100) - (b.efficiency_score ?? 100))
    } else if (sortBy === 'waste') {
      result.sort((a, b) => (b.storage_debt_bytes ?? 0) - (a.storage_debt_bytes ?? 0))
    } else if (sortBy === 'size') {
      result.sort((a, b) => (b.file_size ?? 0) - (a.file_size ?? 0))
    }

    if (qualityFilter === 'all') return result

    const LOSSLESS_CODECS = ['flac', 'alac', 'wav', 'aiff', 'pcm', 'dsd', 'ape', 'wavpack', 'wv']
    const isLosslessCodec = (codec?: string): boolean => {
      if (!codec) return false
      return LOSSLESS_CODECS.some(c => codec.toLowerCase().includes(c))
    }
    const getTrackQualityTier = (track: MusicTrack): 'ultra' | 'high' | 'high-lossy' | 'medium' | 'low' | null => {
      const bitrateKbps = track.audio_bitrate || 0
      const sampleRate = track.sample_rate || 0
      const bitDepth = track.bit_depth || 16
      const isLossless = track.is_lossless || isLosslessCodec(track.audio_codec)
      if (isLossless && (bitDepth >= 24 || sampleRate > 48000)) return 'ultra'
      if (isLossless) return 'high'
      if (bitrateKbps >= 256) return 'high-lossy'
      if (track.audio_codec?.toLowerCase().includes('aac')) {
        if (bitrateKbps >= 128) return 'medium'
      } else {
        if (bitrateKbps >= 160) return 'medium'
      }
      if (bitrateKbps > 0) return 'low'
      if (track.audio_codec) {
        const cl = track.audio_codec.toLowerCase()
        if (cl.includes('mp3') || cl.includes('aac') || cl.includes('ogg')) return 'medium'
      }
      return null
    }
    return result.filter(track => {
      const tier = getTrackQualityTier(track)
      if (qualityFilter === 'high') return tier === 'ultra' || tier === 'high'
      if (qualityFilter === 'medium') return tier === 'medium'
      if (qualityFilter === 'low') return tier === 'low'
      return true
    })
  }, [allTracks, qualityFilter, sortBy])

  // Album detail view
  if (selectedAlbum) {
    return (
      <MusicAlbumDetails
        selectedAlbum={selectedAlbum}
        selectedArtist={selectedArtist}
        albumCompleteness={albumCompleteness}
        tracks={tracks}
        onBack={onBack}
        onAnalyzeAlbum={handleAnalyzeAlbum}
        onRescanTrack={onRescanTrack}
      />
    )
  }

  // Artist detail view (showing albums)
  if (selectedArtist) {
    return (
      <MusicArtistDetails
        selectedArtist={selectedArtist}
        filteredAlbums={filteredAlbums}
        viewType={viewType}
        showSourceBadge={showSourceBadge}
        allAlbumCompleteness={allAlbumCompleteness}
        onSelectAlbum={onSelectAlbum}
        onAnalyzeAlbum={handleAnalyzeAlbum}
        onFixAlbumMatch={onFixAlbumMatch}
        artistCompleteness={artistCompleteness}
        onAnalyzeArtist={handleAnalyzeArtist}
        onFixArtistMatch={onFixArtistMatch}
        onBack={onBack}
        posterMinWidth={posterMinWidth}
        scrollElement={scrollElement}
        includeEps={includeEps}
        includeSingles={includeSingles}
        onDismissMissingAlbum={onDismissMissingAlbum}
      />
    )
  }

  // Main view content based on mode
  const mainContent = useMemo(() => {
    if (musicViewMode === 'artists') {
      return (
        <MediaGridView
          items={artists}
          totalCount={totalArtistCount}
          loading={artistsLoading}
          onLoadMore={onLoadMoreArtists}
          viewType={viewType}
          posterMinWidth={posterMinWidth}
          emptyState={
            <div className="flex flex-col items-center justify-center text-center p-12">
              <User className="w-24 h-24 text-muted-foreground/40 mb-6" />
              <p className="text-muted-foreground text-xl font-medium">No artists found</p>
            </div>
          }
          renderGridItem={(artist) => (
            <div key={artist.id!} data-title={artist.name}>
              <ArtistCard
                artist={artist}
                onClick={() => onSelectArtist(artist)}
                showSourceBadge={showSourceBadge}
                onFixMatch={onFixArtistMatch && artist.id !== undefined ? () => onFixArtistMatch(artist.id!, artist.name) : undefined}
                onAnalyzeCompleteness={onAnalyzeArtist}
                artistCompleteness={artistCompleteness}
              />
            </div>
          )}
          renderListItem={(artist) => (
            <div key={artist.id!} data-title={artist.name}>
              <ArtistListItem
                artist={artist}
                completeness={artistCompleteness.get(artist.name)}
                onClick={() => onSelectArtist(artist)}
                showSourceBadge={showSourceBadge}
                onFixMatch={onFixArtistMatch && artist.id !== undefined ? () => onFixArtistMatch(artist.id!, artist.name) : undefined}
                onAnalyzeCompleteness={onAnalyzeArtist}
              />
            </div>
          )}
        />
      )
    }

    if (musicViewMode === 'albums') {
      const listHeader = (
        <div className="flex items-center gap-4 px-4 py-2 border-b border-border text-xs font-bold uppercase tracking-wider text-muted-foreground bg-muted/10 sticky top-0 z-10 rounded-t-lg">
          <div className="w-16" />
          <div className="flex-1 flex items-center gap-1 cursor-pointer hover:text-foreground" onClick={() => handleAlbumSort('title')}>
            <span>Album</span>
            {albumSortColumn === 'title' && <span className="text-primary">{albumSortDirection === 'asc' ? '↑' : '↓'}</span>}
          </div>
          <div className="w-48 flex items-center gap-1 cursor-pointer hover:text-foreground" onClick={() => handleAlbumSort('artist')}>
            <span>Artist</span>
            {albumSortColumn === 'artist' && <span className="text-primary">{albumSortDirection === 'asc' ? '↑' : '↓'}</span>}
          </div>
          <div className="w-20 text-center">Tracks</div>
        </div>
      )

      return (
        <MediaGridView
          items={allFilteredAlbums}
          totalCount={totalAlbumCount}
          loading={albumsLoading}
          onLoadMore={onLoadMoreAlbums}
          viewType={viewType}
          posterMinWidth={posterMinWidth}
          listHeader={listHeader}
          emptyState={
            <div className="flex flex-col items-center justify-center text-center p-12">
              <Disc3 className="w-24 h-24 text-muted-foreground/40 mb-6" />
              <p className="text-muted-foreground text-xl font-medium">No albums found</p>
            </div>
          }
          renderGridItem={(album) => (
            <div key={album.id} data-title={album.title}>
              <AlbumCard
                album={album}
                onClick={() => onSelectAlbum(album)}
                showArtist={true}
                showSourceBadge={showSourceBadge}
                onAnalyze={onAnalyzeAlbum}
                onFixMatch={onFixAlbumMatch && album.id ? () => onFixAlbumMatch(album.id!, album.title, album.artist_name || '') : undefined}
                completeness={album.id ? allAlbumCompleteness.get(album.id) : undefined}
              />
            </div>
          )}
          renderListItem={(album) => (
            <div key={album.id} data-title={album.title}>
              <AlbumListItem
                album={album}
                onClick={() => onSelectAlbum(album)}
                showArtist={true}
                showSourceBadge={showSourceBadge}
                completeness={album.id ? allAlbumCompleteness.get(album.id) : undefined}
              />
            </div>
          )}
        />
      )
    }

    if (musicViewMode === 'tracks') {
      const listHeader = (
        <div className="flex items-center gap-4 px-4 py-2 border-b border-border text-xs font-bold uppercase tracking-wider text-muted-foreground bg-muted/10 sticky top-0 z-10 rounded-t-lg select-none">
          <div className="w-8 text-center">#</div>
          <div data-resize-column="title" className="flex items-center gap-1 cursor-pointer hover:text-foreground" style={{ width: trackColumnWidths.title, minWidth: 50 }} onClick={() => handleTrackSort('title')}>
            <span>Title</span>
            {trackSortColumn === 'title' && <span className="text-primary">{trackSortDirection === 'asc' ? '↑' : '↓'}</span>}
            <div className="ml-auto w-1 h-4 cursor-col-resize hover:bg-primary/50 rounded" onMouseDown={(e) => handleResizeStart('title', e)} />
          </div>
          <div data-resize-column="artist" className="flex items-center gap-1 cursor-pointer hover:text-foreground" style={{ width: trackColumnWidths.artist, minWidth: 50 }} onClick={() => handleTrackSort('artist')}>
            <span>Artist</span>
            {trackSortColumn === 'artist' && <span className="text-primary">{trackSortDirection === 'asc' ? '↑' : '↓'}</span>}
            <div className="ml-auto w-1 h-4 cursor-col-resize hover:bg-primary/50 rounded" onMouseDown={(e) => handleResizeStart('artist', e)} />
          </div>
          <div data-resize-column="album" className="flex items-center gap-1 cursor-pointer hover:text-foreground" style={{ width: trackColumnWidths.album, minWidth: 50 }} onClick={() => handleTrackSort('album')}>
            <span>Album</span>
            {trackSortColumn === 'album' && <span className="text-primary">{trackSortDirection === 'asc' ? '↑' : '↓'}</span>}
            <div className="ml-auto w-1 h-4 cursor-col-resize hover:bg-primary/50 rounded" onMouseDown={(e) => handleResizeStart('album', e)} />
          </div>
          <div style={{ width: trackColumnWidths.quality, minWidth: 50 }}>Quality</div>
          <div className="flex items-center gap-1 cursor-pointer hover:text-foreground" style={{ width: trackColumnWidths.codec, minWidth: 50 }} onClick={() => handleTrackSort('codec')}>
            <span>Codec</span>
            {trackSortColumn === 'codec' && <span className="text-primary">{trackSortDirection === 'asc' ? '↑' : '↓'}</span>}
          </div>
          <div className="flex items-center gap-1 cursor-pointer hover:text-foreground text-right" style={{ width: trackColumnWidths.duration, minWidth: 50 }} onClick={() => handleTrackSort('duration')}>
            <span>Time</span>
            {trackSortColumn === 'duration' && <span className="text-primary">{trackSortDirection === 'asc' ? '↑' : '↓'}</span>}
          </div>
          <div className="w-20 text-right pr-4">Size</div>
        </div>
      )

      return (
        <MediaGridView
          items={filteredTracks}
          totalCount={totalTrackCount}
          loading={tracksLoading}
          onLoadMore={onLoadMoreTracks}
          viewType="list" // Tracks are always list for now
          listHeader={listHeader}
          emptyState={
            <div className="flex flex-col items-center justify-center text-center p-12">
              <Music className="w-24 h-24 text-muted-foreground/40 mb-6" />
              <p className="text-muted-foreground text-xl font-medium">No tracks found</p>
            </div>
          }
          renderGridItem={() => null}
          renderListItem={(track, index) => {
            const albumInfo = track.album_id ? albumInfoMap.get(track.album_id) : undefined
            const artistName = track.artist_id ? artistNameMap.get(track.artist_id) : albumInfo?.artistName
            return (
              <TrackListItem
                track={track}
                index={index + 1}
                artistName={artistName}
                albumTitle={albumInfo?.title}
                columnWidths={trackColumnWidths}
                onClickQuality={() => {
                  // ... quality tier logic ...
                  setSelectedTrackForQuality({
                    title: track.title,
                    codec: track.audio_codec,
                    bitrate: track.audio_bitrate,
                    sample_rate: track.sample_rate,
                    bit_depth: track.bit_depth,
                    is_lossless: track.is_lossless,
                    qualityTier: 'medium', // Fallback for now
                    artist_name: artistName,
                    album_title: albumInfo?.title
                  })
                }}
              />
            )
          }}
        />
      )
    }
    return null
  }, [musicViewMode, artists, totalArtistCount, artistsLoading, viewType, posterMinWidth, allFilteredAlbums, totalAlbumCount, albumsLoading, albumSortColumn, albumSortDirection, allAlbumCompleteness, filteredTracks, totalTrackCount, tracksLoading, trackColumnWidths, trackSortColumn, trackSortDirection])

  return (
    <div className="h-full flex flex-col">
      {/* Stats Bar and Sorting */}
      <div className="flex items-center justify-between pb-4">
        {stats && (
          <div className="flex items-center gap-6 text-sm text-muted-foreground font-medium">
            <span>{stats.totalArtists.toLocaleString()} Artists</span>
            <span className="text-muted-foreground/50">•</span>
            <span>{stats.totalAlbums.toLocaleString()} Albums</span>
            <span className="text-muted-foreground/50">•</span>
            <span>{stats.totalTracks.toLocaleString()} Tracks</span>
          </div>
        )}

        <div className="flex items-center gap-3">
          <span className="text-xs text-muted-foreground uppercase tracking-wider font-bold">Sort:</span>
          <div className="flex gap-1 bg-muted/30 p-1 rounded-lg">
            {(['title', 'efficiency', 'waste', 'size'] as const).map(s => (
              <button
                key={s}
                onClick={() => onSortChange(s)}
                className={`px-3 py-1 rounded-md text-xs font-bold transition-all ${sortBy === s ? 'bg-primary text-primary-foreground shadow-sm' : 'hover:bg-muted/50 text-muted-foreground'}`}
              >
                {s.charAt(0).toUpperCase() + s.slice(1)}
              </button>
            ))}
          </div>
        </div>
      </div>

      {(slimDown || sortBy === 'efficiency' || sortBy === 'waste' || sortBy === 'size') && (
        <SlimDownBanner className="mb-4" />
      )}

      <div className="flex-1 min-h-0">
        {mainContent}
      </div>

      {/* Empty state for artists view */}
      {musicViewMode === 'artists' && artists.length === 0 && (
        <div className="p-12 text-center">
          <User className="w-12 h-12 mx-auto text-muted-foreground mb-2" />
          <p className="text-muted-foreground">No artists found</p>
        </div>
      )}

      {/* Track Quality Details Modal */}
      {selectedTrackForQuality && (() => {
        const tier = selectedTrackForQuality.qualityTier
        const bitrateKbps = selectedTrackForQuality.bitrate || 0
        const isLossy = !selectedTrackForQuality.is_lossless
        const isHighLossy = isLossy && bitrateKbps >= 256
        const tierLabel = isHighLossy ? 'High' : tier ? tier.charAt(0).toUpperCase() + tier.slice(1) : 'Unknown'
        const tierDescription = tier === 'ultra' ? 'Hi-Res Lossless' :
                                tier === 'high' ? 'CD-Quality Lossless' :
                                isHighLossy ? 'High Bitrate Lossy' :
                                tier === 'medium' ? 'Transparent Lossy' :
                                tier === 'low' ? 'Low Bitrate Lossy' : 'Unknown'
        // Calculate score within tier (not against global ceiling)
        const sampleRate = selectedTrackForQuality.sample_rate || 44100
        const bitDepth = selectedTrackForQuality.bit_depth || 16
        const tierScore = tier === 'ultra' ? 100 :
                         tier === 'high' ? Math.round(70 + Math.min((sampleRate / 48000), 1) * 15 + Math.min((bitDepth / 24), 1) * 15) :
                         isHighLossy ? Math.min(Math.round(90 + (bitrateKbps - 256) / 64 * 10), 100) :
                         tier === 'medium' ? Math.round(40 + ((bitrateKbps - 128) / (256 - 128)) * 50) :
                         tier === 'low' ? Math.round((bitrateKbps / 192) * 40) : 0

        // Check if bitrate is low (for lossy codecs, below 160kbps for MP3 or 128kbps for AAC)
        const isLossyCodec = !selectedTrackForQuality.is_lossless
        const codec = (selectedTrackForQuality.codec || '').toLowerCase()
        const isAAC = codec.includes('aac')
        const bitrateLow = isLossyCodec && selectedTrackForQuality.bitrate &&
          (isAAC ? selectedTrackForQuality.bitrate < 128 : selectedTrackForQuality.bitrate < 160)

        // Get explanation text for low/medium tiers
        const getIssueText = () => {
          if (tier === 'low') {
            return `${Math.round(selectedTrackForQuality.bitrate || 0)} kbps may have audible artifacts. Consider 256+ kbps for transparent quality, or lossless for archival.`
          }
          if (tier === 'medium') {
            return `Good for everyday listening. Lossless (FLAC) available for critical listening or archival.`
          }
          return null
        }
        const issueText = getIssueText()

        return createPortal(
          <div
            className="fixed inset-0 bg-black/60 flex items-center justify-center z-200 p-6"
            onClick={() => setSelectedTrackForQuality(null)}
          >
            <div
              className="bg-card rounded-xl w-full max-w-lg overflow-hidden shadow-2xl border border-border"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Header — matches MediaDetails pattern */}
              <div className="flex gap-4 p-4 border-b border-border/30 bg-sidebar-gradient rounded-t-xl">
                {/* Title & Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h2 className="text-lg font-medium truncate">{selectedTrackForQuality.title}</h2>
                      {(selectedTrackForQuality.artist_name || selectedTrackForQuality.album_title) && (
                        <p className="text-sm text-muted-foreground truncate">
                          {[selectedTrackForQuality.artist_name, selectedTrackForQuality.album_title].filter(Boolean).join(' · ')}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {(tier === 'low' || tier === 'medium') && (
                        <AddToWishlistButton
                          mediaType="track"
                          title={selectedTrackForQuality.title}
                          artistName={selectedTrackForQuality.artist_name}
                          albumTitle={selectedTrackForQuality.album_title}
                          reason="upgrade"
                          compact
                        />
                      )}
                      {(tier === 'low' || tier === 'medium') && (
                        <button
                          onClick={() => setSelectedTrackForQuality(null)}
                          className="p-1 text-muted-foreground hover:text-foreground transition-colors"
                          title="Dismiss"
                        >
                          <EyeOff className="w-4 h-4" />
                        </button>
                      )}
                      <button
                        onClick={() => setSelectedTrackForQuality(null)}
                        className="text-muted-foreground hover:text-foreground p-1"
                      >
                        <X className="w-5 h-5" />
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              {/* Content */}
              <div className="p-4 space-y-4">
                {/* Quality Score Card */}
                <div className="rounded-lg p-3">
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex items-center gap-4 bg-muted/30 -ml-3 -mt-3 -mb-3 px-4 py-3 rounded-l-lg">
                      <div className="text-center">
                        <div className="text-2xl font-bold">{tierLabel}</div>
                        <div className="text-xs font-medium text-muted-foreground">{tierDescription}</div>
                      </div>
                      <div className="h-10 w-px bg-border" />
                      <div className="text-center">
                        <div className="text-2xl font-bold">{tierScore}</div>
                        <div className="text-xs font-medium text-muted-foreground">Score</div>
                      </div>
                    </div>

                    {/* Quality Bar + Premium Badges */}
                    <div className="flex-1 flex items-center gap-4">
                      <div className="flex-1">
                        <div className="flex items-baseline gap-1.5">
                          <span className="text-sm text-muted-foreground">Quality</span>
                          <span className="text-sm font-medium tabular-nums">{tierScore}</span>
                        </div>
                        <div className="h-1 bg-muted rounded-full overflow-hidden mt-1">
                          <div className="h-full bg-primary transition-all" style={{ width: `${tierScore}%` }} />
                        </div>
                        <div className="text-sm text-muted-foreground mt-0.5">
                          {selectedTrackForQuality.is_lossless
                            ? `${selectedTrackForQuality.bit_depth || 16}-bit / ${((selectedTrackForQuality.sample_rate || 44100) / 1000).toFixed(1)} kHz`
                            : `${Math.round(selectedTrackForQuality.bitrate || 0)} kbps`
                          } · Target: {tier === 'ultra' ? '24-bit+ / 96+ kHz'
                            : tier === 'high' ? '16-bit+ / 44.1+ kHz'
                            : isHighLossy ? '256+ kbps'
                            : tier === 'medium' ? '192-256 kbps'
                            : '160+ kbps'}
                        </div>
                      </div>
                      {(selectedTrackForQuality.bit_depth ?? 0) >= 24 && (
                        <span className="px-2 py-0.5 text-xs font-medium rounded bg-purple-500/20 text-purple-400">Hi-Res</span>
                      )}
                    </div>
                  </div>

                  {/* Issue text */}
                  {issueText && (
                    <div className="mt-3 pt-3 border-t border-border">
                      <div className="text-sm text-muted-foreground">{issueText}</div>
                    </div>
                  )}
                </div>

                {/* Technical Specs */}
                <div className="bg-muted/30 rounded-lg p-3">
                  <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Audio Specs</h3>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Codec</span>
                      <span className="font-medium uppercase">{selectedTrackForQuality.codec || 'Unknown'}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Bitrate</span>
                      <span className="font-medium flex items-center">
                        {selectedTrackForQuality.bitrate ? `${Math.round(selectedTrackForQuality.bitrate)} kbps` : 'N/A'}
                        {bitrateLow && <span className="inline-block w-2 h-2 rounded-full bg-red-500 ml-1.5" title="Below quality threshold" />}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Sample Rate</span>
                      <span className="font-medium">{selectedTrackForQuality.sample_rate ? `${(selectedTrackForQuality.sample_rate / 1000).toFixed(1)} kHz` : 'N/A'}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Bit Depth</span>
                      <span className="font-medium">{selectedTrackForQuality.bit_depth ? `${selectedTrackForQuality.bit_depth}-bit` : 'N/A'}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>,
          document.body
        )
      })()}
    </div>
  )
}
