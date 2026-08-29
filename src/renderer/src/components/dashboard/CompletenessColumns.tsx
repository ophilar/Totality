import { Film, Tv, Music } from 'lucide-react'
import { DashboardColumn } from '@/components/dashboard/DashboardColumn'
import { CollectionRow, SeriesRow, ArtistRow } from '@/components/dashboard/CompletenessRows'
import { Virtuoso } from 'react-virtuoso'
import type { MissingMovie, MissingEpisode, MissingAlbumItem } from '@/components/dashboard/types'
import type { MovieCollectionData, SeriesCompletenessData, ArtistCompletenessData } from '@/components/library/types'
import { dashboardSortOptions } from '@/components/dashboard/sortDefinitions'

interface CollectionColumnProps {
  collections: MovieCollectionData[]
  sortBy: string
  setSortBy: (sort: string) => void
  sortOrder: 'asc' | 'desc'
  setSortOrder: (order: 'asc' | 'desc') => void
  expandedCollections: Set<number>
  toggleExpand: (index: number) => void
  onDismiss: (index: number, movie: MissingMovie) => void
}

export function CollectionsColumn({
  collections, sortBy, setSortBy, sortOrder, setSortOrder, expandedCollections, toggleExpand, onDismiss
}: CollectionColumnProps) {
  const row = (index: number) => (
    <CollectionRow
      index={index}
      collection={collections[index]}
      isExpanded={expandedCollections.has(index)}
      onToggleExpand={toggleExpand}
      onDismiss={onDismiss}
    />
  )

  const headerExtra = (
    <div className="flex items-center gap-1"><select value={sortBy} onChange={e => { const v = e.target.value; setSortBy(v); window.electronAPI.setSetting('dashboard_collection_sort', v) }} className="text-xs bg-background border border-border/50 rounded px-2 py-0.5 cursor-pointer">
      {dashboardSortOptions.collections.map(option => <option key={option.key} value={option.key}>{option.label}</option>)}
    </select><button onClick={() => { const v = sortOrder === 'asc' ? 'desc' : 'asc'; setSortOrder(v); window.electronAPI.setSetting('dashboard_collection_sort_order', v) }} className="text-xs px-1" aria-label="Toggle collection sort direction">{sortOrder === 'asc' ? '↑' : '↓'}</button></div>
  )

  return (
    <DashboardColumn icon={<Film className="w-4 h-4" />} title="Collections" headerExtra={headerExtra}>
      <div className="absolute inset-0">
        {collections.length > 0 && <Virtuoso className="h-full" totalCount={collections.length} itemContent={row} />}
      </div>
    </DashboardColumn>
  )
}

interface SeriesColumnProps {
  series: SeriesCompletenessData[]
  sortBy: string
  setSortBy: (sort: string) => void
  sortOrder: 'asc' | 'desc'
  setSortOrder: (order: 'asc' | 'desc') => void
  expandedSeries: Set<number>
  toggleExpand: (index: number) => void
  onDismiss: (index: number, episode: MissingEpisode) => void
}

export function SeriesColumn({
  series, sortBy, setSortBy, sortOrder, setSortOrder, expandedSeries, toggleExpand, onDismiss
}: SeriesColumnProps) {
  const row = (index: number) => (
    <SeriesRow
      index={index}
      s={series[index]}
      isExpanded={expandedSeries.has(index)}
      onToggleExpand={toggleExpand}
      onDismiss={onDismiss}
    />
  )

  const headerExtra = (
    <div className="flex items-center gap-1"><select value={sortBy} onChange={e => { const v = e.target.value; setSortBy(v); window.electronAPI.setSetting('dashboard_series_sort', v) }} className="text-xs bg-background border border-border/50 rounded px-2 py-0.5 cursor-pointer">
      {dashboardSortOptions.series.map(option => <option key={option.key} value={option.key}>{option.label}</option>)}
    </select><button onClick={() => { const v = sortOrder === 'asc' ? 'desc' : 'asc'; setSortOrder(v); window.electronAPI.setSetting('dashboard_series_sort_order', v) }} className="text-xs px-1" aria-label="Toggle series sort direction">{sortOrder === 'asc' ? '↑' : '↓'}</button></div>
  )

  return (
    <DashboardColumn icon={<Tv className="w-4 h-4" />} title="TV Series" headerExtra={headerExtra}>
      <div className="absolute inset-0">
        {series.length > 0 && <Virtuoso className="h-full" totalCount={series.length} itemContent={row} />}
      </div>
    </DashboardColumn>
  )
}

interface ArtistColumnProps {
  artists: ArtistCompletenessData[]
  sortBy: string
  setSortBy: (sort: string) => void
  sortOrder: 'asc' | 'desc'
  setSortOrder: (order: 'asc' | 'desc') => void
  expandedArtists: Set<number>
  toggleExpand: (index: number) => void
  onDismiss: (index: number, album: MissingAlbumItem) => void
  includeEps: boolean
  includeSingles: boolean
}

export function ArtistColumn({
  artists, sortBy, setSortBy, sortOrder, setSortOrder, expandedArtists, toggleExpand, onDismiss, includeEps, includeSingles
}: ArtistColumnProps) {
  const row = (index: number) => (
    <ArtistRow
      index={index}
      artist={artists[index]}
      isExpanded={expandedArtists.has(index)}
      includeEps={includeEps}
      includeSingles={includeSingles}
      onToggleExpand={toggleExpand}
      onDismiss={onDismiss}
    />
  )

  const headerExtra = (
    <div className="flex items-center gap-1"><select value={sortBy} onChange={e => { const v = e.target.value; setSortBy(v); window.electronAPI.setSetting('dashboard_artist_sort', v) }} className="text-xs bg-background border border-border/50 rounded px-2 py-0.5 cursor-pointer">
      {dashboardSortOptions.artists.map(option => <option key={option.key} value={option.key}>{option.label}</option>)}
    </select><button onClick={() => { const v = sortOrder === 'asc' ? 'desc' : 'asc'; setSortOrder(v); window.electronAPI.setSetting('dashboard_artist_sort_order', v) }} className="text-xs px-1" aria-label="Toggle artist sort direction">{sortOrder === 'asc' ? '↑' : '↓'}</button></div>
  )

  return (
    <DashboardColumn icon={<Music className="w-4 h-4" />} title="Music" headerExtra={headerExtra}>
      <div className="absolute inset-0">
        {artists.length > 0 && <Virtuoso className="h-full" totalCount={artists.length} itemContent={row} />}
      </div>
    </DashboardColumn>
  )
}
