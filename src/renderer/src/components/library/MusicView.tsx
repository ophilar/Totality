import { useMemo, useCallback } from 'react'
import { MediaGridView } from './MediaGridView'
import { Music, Disc3, User, RefreshCw } from 'lucide-react'
import { SlimDownBanner } from './SlimDownBanner'
import { ArtistCard } from './music/ArtistCard'
import { AlbumCard } from './music/AlbumCard'
import { TrackListItem } from './music/TrackListItem'
import { ArtistListItem } from './music/ArtistListItem'
import { AlbumListItem } from './music/AlbumListItem'
import { MusicAlbumDetails } from './music/MusicAlbumDetails'
import { MusicArtistDetails } from './music/MusicArtistDetails'
import { useSources } from '../../contexts/SourceContext'
import type {
  MusicArtist,
  MusicAlbum,
  MusicTrack,
  MusicStats,
  MissingAlbum,
  ArtistCompletenessData,
  AlbumCompletenessData
} from './types'

export function MusicView({
  artists,
  totalArtistCount,
  artistsLoading,
  onLoadMoreArtists,
  albums,
  totalTrackCount,
  totalAlbumCount,
  albumsLoading,
  onLoadMoreAlbums,
  selectedArtist,
  selectedAlbum,
  artistCompleteness,
  albumCompleteness,
  allAlbumCompleteness,
  musicViewMode,
  onSelectArtist,
  onSelectAlbum,
  onBack,
  gridScale,
  viewType,
  showSourceBadge,
  onAnalyzeAlbum,
  onAnalyzeArtist,
  onFixArtistMatch,
  onFixAlbumMatch,
  onRescanTrack,
  includeEps,
  includeSingles,
  scrollElement,
  onDismissMissingAlbum,
  sortBy,
  onSortChange,
  slimDown,
  tracks,
  allTracks,
  tracksLoading,
  onLoadMoreTracks,
  onArtistCompletenessUpdated,
  searchQuery,
  qualityFilter
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
  const { scanProgress } = useSources()
  const activeScan = Array.from(scanProgress.values())[0]
  const posterMinWidth = useMemo(() => 120 + gridScale * 15, [gridScale])

  const sortedArtists = useMemo(() => {
    const items = [...artists]
    items.sort((a, b) => {
      if (sortBy === 'efficiency' || sortBy === 'waste' || sortBy === 'size') {
        const compA = artistCompleteness.get(a.name); const compB = artistCompleteness.get(b.name)
        if (sortBy === 'efficiency') { const effA = compA?.efficiency_score ?? 100; const effB = compB?.efficiency_score ?? 100; if (effA !== effB) return effA - effB }
        else if (sortBy === 'waste') { const wA = compA?.storage_debt_bytes ?? 0; const wB = compB?.storage_debt_bytes ?? 0; if (wA !== wB) return wB - wA }
        else if (sortBy === 'size') { const sA = compA?.total_size ?? 0; const sB = compB?.total_size ?? 0; if (sA !== sB) return sB - sA }
      }
      return (a.sort_name || a.name).localeCompare(b.sort_name || b.name)
    })
    return items
  }, [artists, sortBy, artistCompleteness])

  const handleAnalyzeAlbum = useCallback(async (albumId: number) => { await onAnalyzeAlbum(albumId) }, [onAnalyzeAlbum])
  const handleAnalyzeArtist = useCallback(async (artistId: number) => { await onAnalyzeArtist(artistId); onArtistCompletenessUpdated() }, [onAnalyzeArtist, onArtistCompletenessUpdated])

  const allFilteredAlbums = useMemo(() => {
    let result = [...albums]
    if (!selectedArtist && searchQuery.trim()) result = result.filter(album => album.title.toLowerCase().includes(searchQuery.toLowerCase()) || album.artist_name.toLowerCase().includes(searchQuery.toLowerCase()))
    return result
  }, [albums, selectedArtist, searchQuery])

  const filteredAlbums = useMemo(() => selectedArtist ? albums.filter(a => a.artist_id === selectedArtist.id) : [], [albums, selectedArtist])

  function getQualityTier(track: MusicTrack) {
    const bitrate = track.audio_bitrate || 0; const isLossless = track.is_lossless || ['flac', 'alac', 'wav', 'aiff'].some(c => track.audio_codec?.toLowerCase().includes(c))
    if (isLossless && ((track.bit_depth || 16) >= 24 || (track.sample_rate || 0) > 48000)) return 'ultra'
    if (isLossless) return 'high'; if (bitrate >= 256) return 'high-lossy'; if (bitrate >= 160) return 'medium'; return 'low'
  }

  const filteredTracks = useMemo(() => {
    if (qualityFilter === 'all') return allTracks
    return allTracks.filter(track => {
      const tier = getQualityTier(track)
      if (qualityFilter === 'high') return tier === 'ultra' || tier === 'high'
      if (qualityFilter === 'medium') return tier === 'medium'
      if (qualityFilter === 'low') return tier === 'low'
      return true
    })
  }, [allTracks, qualityFilter])

  if (selectedAlbum) return <MusicAlbumDetails selectedAlbum={selectedAlbum} selectedArtist={selectedArtist} albumCompleteness={albumCompleteness} tracks={tracks} onBack={onBack} onAnalyzeAlbum={handleAnalyzeAlbum} onRescanTrack={onRescanTrack} />
  if (selectedArtist) return <MusicArtistDetails selectedArtist={selectedArtist} filteredAlbums={filteredAlbums} viewType={viewType} showSourceBadge={showSourceBadge} allAlbumCompleteness={allAlbumCompleteness} onSelectAlbum={onSelectAlbum} onAnalyzeAlbum={handleAnalyzeAlbum} onFixAlbumMatch={onFixAlbumMatch} artistCompleteness={artistCompleteness} onAnalyzeArtist={handleAnalyzeArtist} onFixArtistMatch={onFixArtistMatch} onBack={onBack} posterMinWidth={posterMinWidth} scrollElement={scrollElement} includeEps={includeEps} includeSingles={includeSingles} onDismissMissingAlbum={onDismissMissingAlbum} />

  const header = (
    <div className="flex items-center justify-between mb-4">
      <div className="flex items-center gap-4">
        <h2 className="text-xl font-bold flex items-center gap-2">
          {musicViewMode === 'artists' ? <User className="w-6 h-6" /> : musicViewMode === 'albums' ? <Disc3 className="w-6 h-6" /> : <Music className="w-6 h-6" />}
          {musicViewMode === 'artists' ? 'Artists' : musicViewMode === 'albums' ? 'Albums' : 'Tracks'}
          <span className="text-sm font-normal text-muted-foreground ml-2">{musicViewMode === 'artists' ? totalArtistCount : musicViewMode === 'albums' ? totalAlbumCount : totalTrackCount} items</span>
        </h2>
        {activeScan && (
          <div className="flex items-center gap-2 px-3 py-1 bg-primary/10 text-primary rounded-full text-xs font-medium animate-pulse">
            <RefreshCw className="w-3 h-3 animate-spin" /> Scan in Progress: {activeScan.phase} ({Math.round(activeScan.percentage)}%)
          </div>
        )}
      </div>
      <div className="flex items-center gap-2 bg-muted/50 p-1 rounded-lg">
        {['title', 'efficiency', 'waste', 'size'].map((s) => (
          <button key={s} onClick={() => onSortChange(s as any)} className={`px-3 py-1 text-xs font-medium rounded-md transition-colors capitalize ${sortBy === s ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'}`}>{s}</button>
        ))}
      </div>
    </div>
  )

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {slimDown && <SlimDownBanner className="mb-4" />}
      {musicViewMode === 'artists' && (
        <MediaGridView
          items={sortedArtists} totalCount={totalArtistCount} viewType={viewType} loading={artistsLoading} onLoadMore={onLoadMoreArtists} posterMinWidth={posterMinWidth} banner={header}
          emptyState={<div className="py-20 text-center opacity-40"><User className="w-20 h-20 mx-auto mb-4" /><p>No artists found</p></div>}
          renderGridItem={(artist) => <ArtistCard artist={artist} onClick={() => onSelectArtist(artist)} showSourceBadge={showSourceBadge} artistCompleteness={artistCompleteness} onAnalyzeCompleteness={handleAnalyzeArtist} onFixMatch={onFixArtistMatch ? () => onFixArtistMatch(artist.id!, artist.name) : undefined} />}
          renderListItem={(artist) => <ArtistListItem artist={artist} onClick={() => onSelectArtist(artist)} showSourceBadge={showSourceBadge} completeness={artistCompleteness.get(artist.name)} onAnalyzeCompleteness={handleAnalyzeArtist} onFixMatch={onFixArtistMatch ? () => onFixArtistMatch(artist.id!, artist.name) : undefined} />}
        />
      )}
      {musicViewMode === 'albums' && (
        <MediaGridView
          items={allFilteredAlbums} totalCount={totalAlbumCount} viewType={viewType} loading={albumsLoading} onLoadMore={onLoadMoreAlbums} posterMinWidth={posterMinWidth} banner={header}
          emptyState={<div className="py-20 text-center opacity-40"><Disc3 className="w-20 h-20 mx-auto mb-4" /><p>No albums found</p></div>}
          renderGridItem={(album) => <AlbumCard album={album} onClick={() => onSelectAlbum(album)} showSourceBadge={showSourceBadge} completeness={allAlbumCompleteness.get(album.id!)} onAnalyze={handleAnalyzeAlbum} onFixMatch={onFixAlbumMatch ? () => onFixAlbumMatch(album.id!, album.title, album.artist_name!) : undefined} />}
          renderListItem={(album) => <AlbumListItem album={album} onClick={() => onSelectAlbum(album)} showSourceBadge={showSourceBadge} completeness={allAlbumCompleteness.get(album.id!)} />}
        />
      )}
      {musicViewMode === 'tracks' && (
        <MediaGridView
          items={filteredTracks} totalCount={totalTrackCount} viewType="list" loading={tracksLoading} onLoadMore={onLoadMoreTracks} banner={header}
          emptyState={<div className="py-20 text-center opacity-40"><Music className="w-20 h-20 mx-auto mb-4" /><p>No tracks found</p></div>}
          renderListItem={(track, index) => <TrackListItem track={track} index={index + 1} artistName={track.artist_name} albumTitle={track.album_name} onClickQuality={() => {}} />}
          renderGridItem={() => <div />}
        />
      )}
    </div>
  )
}
