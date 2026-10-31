import { Film, Tv, Music, Star, Search } from 'lucide-react'

export type MobileTab = 'movies' | 'tv' | 'music' | 'wishlist'

interface MobileTabBarProps {
  activeTab: MobileTab
  onTabChange: (tab: MobileTab) => void
  onSearchOpen: () => void
}

const tabs: { id: MobileTab; label: string; icon: typeof Film }[] = [
  { id: 'movies', label: 'Movies', icon: Film },
  { id: 'tv', label: 'TV Shows', icon: Tv },
  { id: 'music', label: 'Music', icon: Music },
  { id: 'wishlist', label: 'Wishlist', icon: Star },
]

export function MobileTabBar({ activeTab, onTabChange, onSearchOpen }: MobileTabBarProps) {
  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 bg-black/72 backdrop-blur-xl border-t border-white/10" style={{ transform: 'none', touchAction: 'none', paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}>
      <div className="px-2 py-2 flex items-center gap-1" role="tablist" aria-label="Navigation">
        {tabs.map(({ id, label, icon: Icon }) => {
          const active = activeTab === id
          return (
            <button
              key={id}
              onClick={() => onTabChange(id)}
              role="tab"
              aria-selected={active}
              aria-label={label}
              className={`flex-1 flex flex-col items-center justify-center gap-0.5 min-h-[52px] rounded-2xl transition-colors ${
                active
                  ? 'bg-foreground text-background'
                  : 'text-white'
              }`}
            >
              <Icon className="w-5 h-5" />
              <span className="text-micro">{label}</span>
            </button>
          )
        })}

        {/* Search */}
        <button
          onClick={onSearchOpen}
          className="flex-1 flex flex-col items-center justify-center gap-0.5 min-h-[52px] rounded-2xl text-white transition-colors"
          aria-label="Search"
        >
          <Search className="w-5 h-5" />
          <span className="text-micro">Search</span>
        </button>
      </div>
    </nav>
  )
}
