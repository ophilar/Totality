import { CircleFadingArrowUp } from 'lucide-react'
import { DashboardColumn } from '@/components/dashboard/DashboardColumn'
import { MovieUpgradeRow, TvUpgradeRow, MusicUpgradeRow } from '@/components/dashboard/UpgradeRows'
import { Virtuoso } from 'react-virtuoso'
import type { UpgradeTab, MusicAlbumUpgrade } from '@/components/dashboard/types'
import type { MediaItem } from '@main/types/database'

interface UpgradesColumnProps {
  upgradeTab: UpgradeTab
  setUpgradeTab: (tab: UpgradeTab) => void
  movieUpgrades: MediaItem[]
  tvUpgrades: MediaItem[]
  musicUpgrades: MusicAlbumUpgrade[]
  upgradeSortBy: string
  setUpgradeSortBy: (sort: string) => void
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
  hasMovies, hasTV, hasMusic,
  onSelect, onDismissMovie, onDismissTv, onDismissMusic,
  expandedRecommendations, toggleRecommendation
}: UpgradesColumnProps) {
  const movieRow = (index: number) => (
    <MovieUpgradeRow
      index={index}
      item={movieUpgrades[index]}
      isExpanded={expandedRecommendations.has(movieUpgrades[index].id!)}
      onToggleExpand={toggleRecommendation}
      onSelect={onSelect}
      onDismiss={onDismissMovie}
    />
  )

  const tvRow = (index: number) => (
    <TvUpgradeRow
      index={index}
      item={tvUpgrades[index]}
      isExpanded={expandedRecommendations.has(tvUpgrades[index].id!)}
      onToggleExpand={toggleRecommendation}
      onSelect={onSelect}
      onDismiss={onDismissTv}
    />
  )

  const musicRow = (index: number) => (
    <MusicUpgradeRow
      index={index}
      album={musicUpgrades[index]}
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
        <option value="quality">Quality</option>
        <option value="efficiency">Efficiency</option>
        <option value="recent">Recent</option>
        <option value="title">Title</option>
      </select>
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
              <Virtuoso className="h-full" totalCount={movieUpgrades.length} itemContent={movieRow} />
            )}
            {upgradeTab === 'tv' && tvUpgrades.length > 0 && (
              <Virtuoso className="h-full" totalCount={tvUpgrades.length} itemContent={tvRow} />
            )}
            {upgradeTab === 'music' && musicUpgrades.length > 0 && (
              <Virtuoso className="h-full" totalCount={musicUpgrades.length} itemContent={musicRow} />
            )}
          </div>
        </div>
      </div>
    </DashboardColumn>
  )
}
