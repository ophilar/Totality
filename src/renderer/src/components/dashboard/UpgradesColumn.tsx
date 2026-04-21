import React from 'react'
import { CircleFadingArrowUp } from 'lucide-react'
import { DashboardColumn } from '@/components/dashboard/DashboardColumn'
import { MovieUpgradeRow, TvUpgradeRow, MusicUpgradeRow } from '@/components/dashboard/UpgradeRows'
import * as ReactWindow from 'react-window'
import type { UpgradeTab, MusicAlbumUpgrade } from '@/components/dashboard/types'
import type { MediaItem } from '@main/types/database'
// @ts-expect-error react-window types
import type { VariableSizeList } from 'react-window'

const List = (ReactWindow as any).VariableSizeList

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
  listHeight: number
  itemSize: (index: number) => number
  listRef: React.RefObject<VariableSizeList | null>
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
  listHeight, itemSize, listRef,
  onSelect, onDismissMovie, onDismissTv, onDismissMusic,
  expandedRecommendations, toggleRecommendation
}: UpgradesColumnProps) {
  const movieRow = ({ index, style }: { index: number; style: React.CSSProperties }) => (
    <MovieUpgradeRow
      index={index}
      style={style}
      item={movieUpgrades[index]}
      isExpanded={expandedRecommendations.has(movieUpgrades[index].id!)}
      onToggleExpand={toggleRecommendation}
      onSelect={onSelect}
      onDismiss={onDismissMovie}
    />
  )

  const tvRow = ({ index, style }: { index: number; style: React.CSSProperties }) => (
    <TvUpgradeRow
      index={index}
      style={style}
      item={tvUpgrades[index]}
      isExpanded={expandedRecommendations.has(tvUpgrades[index].id!)}
      onToggleExpand={toggleRecommendation}
      onSelect={onSelect}
      onDismiss={onDismissTv}
    />
  )

  const musicRow = ({ index, style }: { index: number; style: React.CSSProperties }) => (
    <MusicUpgradeRow
      index={index}
      style={style}
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
              <List ref={listRef} height={listHeight} itemCount={movieUpgrades.length} itemSize={itemSize} width="100%">{movieRow}</List>
            )}
            {upgradeTab === 'tv' && tvUpgrades.length > 0 && (
              <List ref={listRef} height={listHeight} itemCount={tvUpgrades.length} itemSize={itemSize} width="100%">{tvRow}</List>
            )}
            {upgradeTab === 'music' && musicUpgrades.length > 0 && (
              <List ref={listRef} height={listHeight} itemCount={musicUpgrades.length} itemSize={itemSize} width="100%">{musicRow}</List>
            )}
          </div>
        </div>
      </div>
    </DashboardColumn>
  )
}
