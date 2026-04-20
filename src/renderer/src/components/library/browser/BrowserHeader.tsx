
import React from 'react'
import { Film, Tv, Music, Layers, Heart, Library, Star, Settings, Home, RefreshCw } from 'lucide-react'
import logoImage from '../../../assets/totality_header_logo.png'
import { SearchAutocomplete } from './SearchAutocomplete'
import { ScanningStatus } from './ScanningStatus'
import { ActivityPanel } from '../../ui/ActivityPanel'

interface BrowserHeaderProps {
  view: string
  setView: (view: any) => void
  hasMovies: boolean
  hasTV: boolean
  hasMusic: boolean
  wishlistCount: number
  isAutoRefreshing: boolean
  tmdbApiKeySet: boolean
  themeAccentColor: string
  showCompletenessPanel: boolean
  setShowCompletenessPanel: (val: boolean) => void
  showWishlistPanel: boolean
  setShowWishlistPanel: (val: boolean) => void
  onOpenSettings: () => void
  onNavigateHome?: () => void
  onLibraryTabChange?: (tab: any) => void
  
  // Search props
  searchProps: any
}

export const BrowserHeader: React.FC<BrowserHeaderProps> = ({
  view,
  setView,
  hasMovies,
  hasTV,
  hasMusic,
  wishlistCount,
  isAutoRefreshing,
  tmdbApiKeySet,
  themeAccentColor,
  showCompletenessPanel,
  setShowCompletenessPanel,
  showWishlistPanel,
  setShowWishlistPanel,
  onOpenSettings,
  onNavigateHome,
  onLibraryTabChange,
  searchProps
}) => {
  const handleTabClick = (tab: any) => {
    setView(tab)
    onLibraryTabChange?.(tab)
  }

  return (
    <header className="dark fixed top-4 left-4 right-4 z-100 bg-black rounded-2xl shadow-xl px-4 py-3">
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-4 flex-1 min-w-0">
          <img src={logoImage} alt="Totality" className="h-10 shrink-0" />
          <SearchAutocomplete {...searchProps} />
          <ScanningStatus />
        </div>

        <div className="shrink-0 flex gap-1" role="tablist">
          {onNavigateHome && (
            <button onClick={onNavigateHome} className="px-3 py-2 rounded-md text-sm font-medium transition-colors bg-card text-muted-foreground hover:bg-muted">
              <Home className="w-4 h-4" />
            </button>
          )}
          {onNavigateHome && <div className="w-px bg-border/50 mx-1" />}

          <button
            onClick={() => handleTabClick('movies')}
            disabled={!hasMovies}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors flex items-center gap-2 ${view === 'movies' ? 'bg-primary text-primary-foreground' : 'bg-card text-muted-foreground hover:bg-muted'} disabled:opacity-40`}
          >
            <Film className="w-4 h-4" />
            <span>Movies</span>
          </button>

          <button
            onClick={() => handleTabClick('tv')}
            disabled={!hasTV}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors flex items-center gap-2 ${view === 'tv' ? 'bg-primary text-primary-foreground' : 'bg-card text-muted-foreground hover:bg-muted'} disabled:opacity-40`}
          >
            <Tv className="w-4 h-4" />
            <span>TV Shows</span>
          </button>

          <button
            onClick={() => handleTabClick('music')}
            disabled={!hasMusic}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors flex items-center gap-2 ${view === 'music' ? 'bg-primary text-primary-foreground' : 'bg-card text-muted-foreground hover:bg-muted'} disabled:opacity-40`}
          >
            <Music className="w-4 h-4" />
            <span>Music</span>
          </button>

          <button
            onClick={() => handleTabClick('duplicates')}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors flex items-center gap-2 ${view === 'duplicates' ? 'bg-primary text-primary-foreground' : 'bg-card text-muted-foreground hover:bg-muted'}`}
          >
            <Layers className="w-4 h-4" />
            <span>Duplicates</span>
          </button>

          <button
            onClick={() => handleTabClick('wishlist')}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors flex items-center gap-2 ${view === 'wishlist' ? 'bg-primary text-primary-foreground' : 'bg-card text-muted-foreground hover:bg-muted'}`}
          >
            <Heart className="w-4 h-4" />
            <span>Wishlist</span>
          </button>

          {isAutoRefreshing && (
            <div className="flex items-center gap-1.5 px-2 py-1 text-xs text-muted-foreground">
              <RefreshCw className="w-3 h-3 animate-spin" />
              <span>Syncing</span>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end flex-1 gap-2">
          <button
            onClick={() => {
              const newState = !showCompletenessPanel
              if (newState) setShowWishlistPanel(false)
              setShowCompletenessPanel(newState)
            }}
            className={`p-2.5 rounded-md transition-colors flex items-center gap-1 shrink-0 ${showCompletenessPanel ? 'bg-primary text-primary-foreground' : 'bg-card text-muted-foreground hover:bg-muted'}`}
          >
            <Library className="w-4 h-4" />
            {!tmdbApiKeySet && <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: themeAccentColor }} />}
          </button>
          
          <button
            onClick={() => {
              const newState = !showWishlistPanel
              if (newState) setShowCompletenessPanel(false)
              setShowWishlistPanel(newState)
            }}
            className={`p-2.5 rounded-md transition-colors flex items-center gap-1.5 shrink-0 ${showWishlistPanel ? 'bg-primary text-primary-foreground' : 'bg-card text-muted-foreground hover:bg-muted'}`}
          >
            <Star className="w-4 h-4" />
            {wishlistCount > 0 && <span className="text-xs font-medium" style={showWishlistPanel ? undefined : { color: themeAccentColor }}>{wishlistCount}</span>}
          </button>

          <ActivityPanel />

          <button onClick={onOpenSettings} className="p-2.5 rounded-md transition-colors shrink-0 bg-card text-muted-foreground hover:bg-muted">
            <Settings className="w-4 h-4" />
          </button>
        </div>
      </div>
    </header>
  )
}
