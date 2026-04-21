import React from 'react'
import { Film, Tv, Music } from 'lucide-react'
import { DashboardColumn } from './DashboardColumn'
import { CollectionRow, SeriesRow, ArtistRow } from './CompletenessRows'
import * as ReactWindow from 'react-window'
import type { MissingMovie, MissingEpisode, MissingAlbumItem } from './types'
import type { MovieCollectionData, SeriesCompletenessData, ArtistCompletenessData } from '../library/types'

const List = (ReactWindow as any).VariableSizeList

interface CollectionColumnProps {
  collections: MovieCollectionData[]
  sortBy: string
  setSortBy: (sort: string) => void
  listHeight: number
  itemSize: (index: number) => number
  listRef: React.RefObject<any>
  expandedCollections: Set<number>
  toggleExpand: (index: number) => void
  onDismiss: (index: number, movie: MissingMovie) => void
}

export function CollectionsColumn({
  collections, sortBy, setSortBy, listHeight, itemSize, listRef, expandedCollections, toggleExpand, onDismiss
}: CollectionColumnProps) {
  const row = ({ index, style }: any) => (
    <CollectionRow
      index={index}
      style={style}
      collection={collections[index]}
      isExpanded={expandedCollections.has(index)}
      onToggleExpand={toggleExpand}
      onDismiss={onDismiss}
    />
  )

  const headerExtra = (
    <select value={sortBy} onChange={e => { const v = e.target.value; setSortBy(v); window.electronAPI.setSetting('dashboard_collection_sort', v) }} className="text-xs bg-background border border-border/50 rounded px-2 py-0.5 cursor-pointer">
      <option value="completeness">Completeness</option><option value="name">Name</option><option value="recent">Recent</option>
    </select>
  )

  return (
    <DashboardColumn icon={<Film className="w-4 h-4" />} title="Collections" headerExtra={headerExtra}>
      <div className="absolute inset-0">
        {collections.length > 0 && <List ref={listRef} height={listHeight} itemCount={collections.length} itemSize={itemSize} width="100%">{row}</List>}
      </div>
    </DashboardColumn>
  )
}

interface SeriesColumnProps {
  series: SeriesCompletenessData[]
  sortBy: string
  setSortBy: (sort: string) => void
  listHeight: number
  itemSize: (index: number) => number
  listRef: React.RefObject<any>
  expandedSeries: Set<number>
  toggleExpand: (index: number) => void
  onDismiss: (index: number, episode: MissingEpisode) => void
}

export function SeriesColumn({
  series, sortBy, setSortBy, listHeight, itemSize, listRef, expandedSeries, toggleExpand, onDismiss
}: SeriesColumnProps) {
  const row = ({ index, style }: any) => (
    <SeriesRow
      index={index}
      style={style}
      s={series[index]}
      isExpanded={expandedSeries.has(index)}
      onToggleExpand={toggleExpand}
      onDismiss={onDismiss}
    />
  )

  const headerExtra = (
    <select value={sortBy} onChange={e => { const v = e.target.value; setSortBy(v); window.electronAPI.setSetting('dashboard_series_sort', v) }} className="text-xs bg-background border border-border/50 rounded px-2 py-0.5 cursor-pointer">
      <option value="completeness">Completeness</option><option value="name">Name</option><option value="recent">Recent</option>
    </select>
  )

  return (
    <DashboardColumn icon={<Tv className="w-4 h-4" />} title="TV Series" headerExtra={headerExtra}>
      <div className="absolute inset-0">
        {series.length > 0 && <List ref={listRef} height={listHeight} itemCount={series.length} itemSize={itemSize} width="100%">{row}</List>}
      </div>
    </DashboardColumn>
  )
}

interface ArtistColumnProps {
  artists: ArtistCompletenessData[]
  sortBy: string
  setSortBy: (sort: string) => void
  listHeight: number
  itemSize: (index: number) => number
  listRef: React.RefObject<any>
  expandedArtists: Set<number>
  toggleExpand: (index: number) => void
  onDismiss: (index: number, album: MissingAlbumItem) => void
  includeEps: boolean
  includeSingles: boolean
}

export function ArtistColumn({
  artists, sortBy, setSortBy, listHeight, itemSize, listRef, expandedArtists, toggleExpand, onDismiss, includeEps, includeSingles
}: ArtistColumnProps) {
  const row = ({ index, style }: any) => (
    <ArtistRow
      index={index}
      style={style}
      artist={artists[index]}
      isExpanded={expandedArtists.has(index)}
      includeEps={includeEps}
      includeSingles={includeSingles}
      onToggleExpand={toggleExpand}
      onDismiss={onDismiss}
    />
  )

  const headerExtra = (
    <select value={sortBy} onChange={e => { const v = e.target.value; setSortBy(v); window.electronAPI.setSetting('dashboard_artist_sort', v) }} className="text-xs bg-background border border-border/50 rounded px-2 py-0.5 cursor-pointer">
      <option value="completeness">Completeness</option><option value="name">Name</option>
    </select>
  )

  return (
    <DashboardColumn icon={<Music className="w-4 h-4" />} title="Music" headerExtra={headerExtra}>
      <div className="absolute inset-0">
        {artists.length > 0 && <List ref={listRef} height={listHeight} itemCount={artists.length} itemSize={itemSize} width="100%">{row}</List>}
      </div>
    </DashboardColumn>
  )
}
