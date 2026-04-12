
import React from 'react'
import { Unlock, Lock, Layers, Grid3x3, List } from 'lucide-react'

interface BrowserFilterBarProps {
  view: string
  musicViewMode: string
  setMusicViewMode: (val: any) => void
  activeSourceId: string | null
  activeLibraryId: string | null
  setActiveLibraryId: (id: string | null) => void
  currentTypeLibraries: any[]
  isUnlocked: boolean
  setIsUnlocked: (val: boolean) => void
  setShowPinModal: (val: boolean) => void
  tierFilter: string
  setTierFilter: (val: any) => void
  qualityFilter: string
  setQualityFilter: (val: any) => void
  slimDown: boolean
  setSlimDown: (val: boolean) => void
  collectionsOnly: boolean
  setCollectionsOnly: (val: boolean) => void
  hasCollections: boolean
  gridScale: number
  setGridScale: (val: number) => void
  viewType: string
  setViewType: (val: any) => void
  selectedShow: any
}

export const BrowserFilterBar: React.FC<BrowserFilterBarProps> = ({
  view,
  musicViewMode, setMusicViewMode,
  activeSourceId,
  activeLibraryId, setActiveLibraryId,
  currentTypeLibraries,
  isUnlocked, setIsUnlocked,
  setShowPinModal,
  tierFilter, setTierFilter,
  qualityFilter, setQualityFilter,
  slimDown, setSlimDown,
  collectionsOnly, setCollectionsOnly,
  hasCollections,
  gridScale, setGridScale,
  viewType, setViewType,
  selectedShow
}) => {
  return (
    <div className="shrink-0 py-3 px-4">
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            {/* Music View Mode */}
            {view === 'music' && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">View</span>
                <div className="flex gap-1">
                  {(['artists', 'albums', 'tracks'] as const).map((mode) => (
                    <button
                      key={mode}
                      onClick={() => setMusicViewMode(mode)}
                      className={`px-2.5 py-1.5 rounded-md text-xs transition-colors ${musicViewMode === mode ? 'bg-primary text-primary-foreground' : 'bg-card text-muted-foreground hover:bg-muted'}`}
                    >
                      {mode.charAt(0).toUpperCase() + mode.slice(1)}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Library Filter */}
            {activeSourceId && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">Library</span>
                <div className="flex items-center gap-1">
                  <select
                    value={activeLibraryId || ''}
                    onChange={(e) => setActiveLibraryId(e.target.value || null)}
                    className="px-2.5 py-1 bg-card border border-border rounded-md text-xs text-foreground focus:outline-hidden focus:ring-2 focus:ring-primary"
                  >
                    <option value="">All Libraries</option>
                    {currentTypeLibraries.map(lib => (
                      <option key={lib.id} value={lib.id}>{lib.isProtected ? '🔒 ' : ''}{lib.name}</option>
                    ))}
                  </select>
                  <button
                    onClick={() => isUnlocked ? setIsUnlocked(false) : setShowPinModal(true)}
                    className={`p-1.5 rounded-md transition-colors ${isUnlocked ? 'bg-primary/20 text-primary hover:bg-primary/30' : 'bg-card text-muted-foreground hover:bg-muted'}`}
                  >
                    {isUnlocked ? <Unlock className="w-3.5 h-3.5" /> : <Lock className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>
            )}

            {/* Resolution Filter */}
            {(view === 'movies' || view === 'tv' || (view === 'music' && musicViewMode === 'tracks')) && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">Resolution</span>
                <div className="flex gap-1">
                  {['all', '4K', '1080p', '720p', 'SD'].map((tier) => (
                    <button
                      key={tier}
                      onClick={() => setTierFilter(tier)}
                      className={`px-2.5 py-1 rounded-md text-xs transition-colors ${tierFilter === tier ? 'bg-primary text-primary-foreground' : 'bg-card text-muted-foreground hover:bg-muted'}`}
                    >
                      {tier === 'all' ? 'All' : tier}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Quality Filter */}
            {(view !== 'music' || musicViewMode === 'tracks') && (
              <>
                <div className="h-6 w-px bg-border/50" />
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">Quality</span>
                  <div className="flex gap-1">
                    {['all', 'high', 'medium', 'low'].map((q) => (
                      <button
                        key={q}
                        onClick={() => setQualityFilter(q)}
                        className={`px-2.5 py-1 rounded-md text-xs transition-colors ${qualityFilter === q ? 'bg-primary text-primary-foreground' : 'bg-card text-muted-foreground hover:bg-muted'}`}
                      >
                        {q.charAt(0).toUpperCase() + q.slice(1)}
                      </button>
                    ))}
                  </div>
                </div>
              </>
            )}

            {/* Slim Down */}
            <div className="h-6 w-px bg-border/50" />
            <button
              onClick={() => setSlimDown(!slimDown)}
              className={`px-2.5 py-1 rounded-md text-xs transition-colors ${slimDown ? 'bg-primary text-primary-foreground' : 'bg-card text-muted-foreground hover:bg-muted'}`}
            >
              Slim Down
            </button>

            {/* Collections */}
            {view === 'movies' && hasCollections && (
              <button
                onClick={() => setCollectionsOnly(!collectionsOnly)}
                className={`px-2.5 py-1 rounded-md text-xs transition-colors flex items-center gap-1.5 ${collectionsOnly ? 'bg-primary text-primary-foreground' : 'bg-card text-muted-foreground hover:bg-muted'}`}
              >
                <Layers className="w-3.5 h-3.5" /> Collections
              </button>
            )}
          </div>

          {/* View Toggles */}
          <div className="flex items-center gap-3 ml-auto">
            {!(view === 'tv' && selectedShow) && viewType === 'grid' && (
              <input
                type="range" min="1" max="7" value={gridScale}
                onChange={(e) => setGridScale(Number(e.target.value))}
                className="w-20 h-1 bg-border/50 rounded-lg appearance-none cursor-pointer"
              />
            )}
            {!(view === 'tv' && selectedShow) && (
              <div className="flex gap-1">
                <button onClick={() => setViewType('grid')} className={`p-1.5 rounded-md ${viewType === 'grid' ? 'bg-primary text-primary-foreground' : 'bg-card text-muted-foreground hover:bg-muted'}`}>
                  <Grid3x3 className="w-4 h-4" />
                </button>
                <button onClick={() => setViewType('list')} className={`p-1.5 rounded-md ${viewType === 'list' ? 'bg-primary text-primary-foreground' : 'bg-card text-muted-foreground hover:bg-muted'}`}>
                  <List className="w-4 h-4" />
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
