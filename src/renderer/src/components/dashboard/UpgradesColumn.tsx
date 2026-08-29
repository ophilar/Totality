import { CircleFadingArrowUp } from 'lucide-react'
import { useMemo } from 'react'
import { DashboardColumn } from '@/components/dashboard/DashboardColumn'
import { MovieUpgradeRow, TvUpgradeRow, MusicUpgradeRow } from '@/components/dashboard/UpgradeRows'
import { Virtuoso } from 'react-virtuoso'
import type { UpgradeTab, MusicAlbumUpgrade } from '@/components/dashboard/types'
import type { MediaItem } from '@main/types/database'
import { dashboardSortOptions } from '@/components/dashboard/sortDefinitions'

interface UpgradesColumnProps {
  upgradeTab: UpgradeTab
  setUpgradeTab: (tab: UpgradeTab) => void
  movieUpgrades: MediaItem[]
  tvUpgrades: MediaItem[]
  musicUpgrades: MusicAlbumUpgrade[]
  upgradeSortBy: string
  setUpgradeSortBy: (sort: string) => void
  sortDirection: 'asc' | 'desc'
  setSortDirection: (direction: 'asc' | 'desc') => void
  hasMovies: boolean
  hasTV: boolean
  hasMusic: boolean
  onSelect: (id: number) => void
  onDismissMovie: (index: number) => void
  onDismissTv: (index: number) => void
  onDismissMusic: (index: number) => void
  expandedRecommendations: Set<number>
  toggleRecommendation: (id: number) => void
}

export function UpgradesColumn({
  upgradeTab, setUpgradeTab,
  movieUpgrades, tvUpgrades, musicUpgrades,
  upgradeSortBy, setUpgradeSortBy,
  sortDirection, setSortDirection,
  hasMovies, hasTV, hasMusic,
  onSelect, onDismissMovie, onDismissTv, onDismissMusic,
  expandedRecommendations, toggleRecommendation
}: UpgradesColumnProps) {
  const sortItems = <T extends MediaItem | MusicAlbumUpgrade>(items: T[]) => [...items].sort((a, b) => {
    const value = (item: T): string | number => {
      if (upgradeSortBy === 'title') return item.title || ''
      if (upgradeSortBy === 'recent') return new Date(item.updated_at || item.created_at || 0).getTime()
      if (upgradeSortBy === 'efficiency') return 'file_size' in item ? item.file_size || 0 : 0
      return item.quality_tier || ''
    }
    const left = value(a), right = value(b)
    const result = typeof left === 'number' && typeof right === 'number' ? left - right : String(left).localeCompare(String(right), undefined, { numeric: true, sensitivity: 'base' })
    return sortDirection === 'asc' ? result : -result
  })
  const sortedMovies = useMemo(() => sortItems(movieUpgrades), [movieUpgrades, upgradeSortBy, sortDirection])
  const sortedTv = useMemo(() => sortItems(tvUpgrades), [tvUpgrades, upgradeSortBy, sortDirection])
  const sortedMusic = useMemo(() => sortItems(musicUpgrades), [musicUpgrades, upgradeSortBy, sortDirection])
  const movieRow = (index: number) => (
    <MovieUpgradeRow
      index={index}
      item={sortedMovies[index]}
      isExpanded={expandedRecommendations.has(sortedMovies[index].id!)}
      onToggleExpand={toggleRecommendation}
      onSelect={onSelect}
      onDismiss={onDismissMovie}
    />
  )

  const tvRow = (index: number) => (
    <TvUpgradeRow
      index={index}
      item={sortedTv[index]}
      isExpanded={expandedRecommendations.has(sortedTv[index].id!)}
      onToggleExpand={toggleRecommendation}
      onSelect={onSelect}
      onDismiss={onDismissTv}
    />
  )

  const musicRow = (index: number) => (
    <MusicUpgradeRow
      index={index}
      album={sortedMusic[index]}
      onSelect={onSelect}
      onDismiss={onDismissMusic}
    />
  )

  const headerExtra = (
    <div className="flex items-center gap-2">
      <select
        value={upgradeSortBy}
        onChange={e => {
          const v = e.target.value
          setUpgradeSortBy(v)
          window.electronAPI.setSetting('dashboard_upgrade_sort', v)
        }}
        className="text-xs bg-background text-foreground border border-border/50 rounded px-2 py-0.5 cursor-pointer focus:outline-hidden"
      >
        {dashboardSortOptions.upgrades.map(option => <option key={option.key} value={option.key}>{option.label}</option>)}
      </select>
      <button type="button" onClick={() => setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc')} className="text-xs px-1.5 py-0.5 border border-border/50 rounded hover:bg-muted" title="Toggle sort direction">
        {sortDirection === 'asc' ? '↑' : '↓'}
      </button>
    </div>
  )

  return (
    <DashboardColumn 
      icon={<CircleFadingArrowUp className="w-4 h-4" />} 
      title="Upgrades" 
      headerExtra={headerExtra}
    >
      <div className="flex flex-col h-full">
        <div className="shrink-0 p-4 pt-0 border-b border-border/30">
          <div className="flex flex-wrap gap-1 justify-center">
            {hasMovies && <button onClick={() => setUpgradeTab('movies')} className={`px-3 py-1.5 rounded-md text-xs font-medium ${upgradeTab === 'movies' ? 'bg-primary text-primary-foreground' : 'bg-muted/50'}`}>Movies</button>}
            {hasTV && <button onClick={() => setUpgradeTab('tv')} className={`px-3 py-1.5 rounded-md text-xs font-medium ${upgradeTab === 'tv' ? 'bg-primary text-primary-foreground' : 'bg-muted/50'}`}>TV</button>}
            {hasMusic && <button onClick={() => setUpgradeTab('music')} className={`px-3 py-1.5 rounded-md text-xs font-medium ${upgradeTab === 'music' ? 'bg-primary text-primary-foreground' : 'bg-muted/50'}`}>Music</button>}
          </div>
        </div>
        <div className="flex-1 min-h-0 relative">
          <div className="absolute inset-0">
            {upgradeTab === 'movies' && movieUpgrades.length > 0 && (
              <Virtuoso className="h-full" totalCount={sortedMovies.length} itemContent={movieRow} />
            )}
            {upgradeTab === 'tv' && tvUpgrades.length > 0 && (
              <Virtuoso className="h-full" totalCount={sortedTv.length} itemContent={tvRow} />
            )}
            {upgradeTab === 'music' && musicUpgrades.length > 0 && (
              <Virtuoso className="h-full" totalCount={sortedMusic.length} itemContent={musicRow} />
            )}
          </div>
        </div>
      </div>
    </DashboardColumn>
  )
}
