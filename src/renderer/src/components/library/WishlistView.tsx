import { useState, useEffect } from 'react'
import { Virtuoso } from 'react-virtuoso'
import { ArrowUpCircle, X, HardDrive, Zap, Info } from 'lucide-react'
import { MoviePlaceholder, TvPlaceholder } from '../ui/MediaPlaceholders'
import { emitDismissUpgrade } from '../../utils/dismissEvents'
import type { MediaItem, SeriesCompletenessData, MovieCollectionData } from './types'
import { useToast } from '../../contexts/ToastContext'

interface WishlistViewProps {
  onSelectMovie?: (id: number) => void
}

type TabType = 'upgrades' | 'missing'

interface MissingItem {
  id: string
  title: string
  year?: number
  type: 'movie' | 'episode'
  poster_url?: string
  series_title?: string
  season_number?: number
  episode_number?: number
  collection_name?: string
  tmdb_id?: string
  parent_tmdb_id?: string // for episodes
}

export function WishlistView(_props: WishlistViewProps) {
  const [activeTab, setActiveTab] = useState<TabType>('upgrades')
  const [upgrades, setUpgrades] = useState<MediaItem[]>([])
  const [missing, setMissing] = useState<MissingItem[]>([])
  const [loading, setLoading] = useState(true)
  const { addToast } = useToast()

  // Load data for the wishlist view
  const loadData = async () => {
    setLoading(true)
    try {
      // 1. Load Upgrades (items with needs_upgrade = true or high storage debt)
      // We fetch all items with needsUpgrade filter. The storage debt items will also be returned.
      const upgradeItems = await window.electronAPI.getMediaItems({
        needsUpgrade: true,
        limit: 10000, 
      })
      setUpgrades(upgradeItems as MediaItem[])

      // 2. Load Missing items from Collections and SeriesCompleteness
      const [seriesData, collectionsData] = await Promise.all([
        window.electronAPI.seriesGetAll(),
        window.electronAPI.collectionsGetAll(),
      ])

      const missingList: MissingItem[] = []

      // Extract missing movies
      ;(collectionsData as MovieCollectionData[]).forEach(c => {
        try {
          const missingMovies = JSON.parse(c.missing_movies || '[]')
          missingMovies.forEach((m: { tmdb_id: string; title: string; year?: number; poster_path?: string }) => {
            missingList.push({
              id: `movie-${m.tmdb_id}`,
              title: m.title,
              year: m.year,
              type: 'movie',
              poster_url: m.poster_path ? `https://image.tmdb.org/t/p/w200${m.poster_path}` : undefined,
              collection_name: c.collection_name,
              tmdb_id: m.tmdb_id,
              parent_tmdb_id: c.tmdb_collection_id
            })
          })
        } catch (e) {
          // ignore parsing error
        }
      })

      // Extract missing episodes
      ;(seriesData as SeriesCompletenessData[]).forEach(s => {
        try {
          const missingEpisodes = JSON.parse(s.missing_episodes || '[]')
          missingEpisodes.forEach((ep: any) => {
            missingList.push({
              id: `episode-${s.tmdb_id}-${ep.season_number}-${ep.episode_number}`,
              title: ep.title || `Episode ${ep.episode_number}`,
              type: 'episode',
              series_title: s.series_title,
              season_number: ep.season_number,
              episode_number: ep.episode_number,
              tmdb_id: s.tmdb_id,
              parent_tmdb_id: s.tmdb_id
            })
          })
        } catch (e) {
          // ignore parsing error
        }
      })

      setMissing(missingList)
    } catch (err) {
      window.electronAPI.log.error('[WishlistView]', 'Failed to load wishlist data:', err)
      addToast({ title: 'Failed to load wishlist data', type: 'error' })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Handle Dismiss for Upgrades
  const handleDismissUpgrade = async (item: MediaItem) => {
    try {
      await window.electronAPI.addExclusion('media_upgrade', item.id, undefined, undefined, item.title)
      setUpgrades(prev => prev.filter(u => u.id !== item.id))
      emitDismissUpgrade({ mediaId: item.id! })
      addToast({ title: `Dismissed upgrade for ${item.title}`, type: 'success' })
    } catch (err) {
      window.electronAPI.log.error('[WishlistView]', 'Failed to dismiss upgrade:', err)
      addToast({ title: 'Failed to dismiss upgrade', type: 'error' })
    }
  }

  // Handle Dismiss for Missing Items
  const handleDismissMissing = async (item: MissingItem) => {
    try {
      if (item.type === 'movie') {
        await window.electronAPI.addExclusion(
          'collection_movie',
          item.tmdb_id ? parseInt(item.tmdb_id, 10) : 0,
          item.parent_tmdb_id,
          undefined,
          item.title
        )
      } else {
        await window.electronAPI.addExclusion(
          'series_episode',
          0,
          item.parent_tmdb_id || item.series_title,
          `S${item.season_number}E${item.episode_number}`,
          `${item.series_title} - S${item.season_number}E${item.episode_number}`
        )
      }
      setMissing(prev => prev.filter(m => m.id !== item.id))
      addToast({ title: `Dismissed missing item ${item.title}`, type: 'success' })
    } catch (err) {
      window.electronAPI.log.error('[WishlistView]', 'Failed to dismiss missing item:', err)
      addToast({ title: 'Failed to dismiss item', type: 'error' })
    }
  }

  const formatBytesAsGB = (bytes?: number) => {
    if (!bytes) return '0.0 GB'
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
  }

  // Render individual upgrade row
  const renderUpgradeRow = (_index: number, item: MediaItem) => {
    const effScore = item.efficiency_score ?? 0
    const debtBytes = item.storage_debt_bytes ?? 0

    return (
      <div className="flex items-center gap-4 p-4 mb-2 bg-card border border-border/50 rounded-xl shadow-sm hover:border-border transition-colors group">
        <div className="flex-shrink-0 w-16 h-24 bg-muted rounded overflow-hidden">
          {item.poster_url ? (
            <img src={item.poster_url} alt={item.title} className="w-full h-full object-cover" />
          ) : item.type === 'movie' ? (
            <div className="w-full h-full flex items-center justify-center">
              <MoviePlaceholder className="w-8 h-8 text-muted-foreground" />
            </div>
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <TvPlaceholder className="w-8 h-8 text-muted-foreground" />
            </div>
          )}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <h3 className="font-semibold text-base truncate">{item.title}</h3>
            {item.year && <span className="text-sm text-muted-foreground">({item.year})</span>}
            <span className="px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider bg-primary/10 text-primary rounded-md">
              {item.type}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted-foreground mt-2">
            <div className="flex items-center gap-1.5" title="Efficiency Score">
              <Zap className="w-4 h-4 text-yellow-500" />
              <span>Score: <strong className="text-foreground">{effScore}%</strong></span>
            </div>

            <div className="flex items-center gap-1.5" title="Storage Debt">
              <HardDrive className="w-4 h-4 text-red-400" />
              <span>Debt: <strong className="text-foreground">{formatBytesAsGB(debtBytes)}</strong></span>
            </div>

            <div className="flex items-center gap-1.5 ml-auto">
              <span className="px-2 py-1 bg-muted rounded text-xs">
                Current: {item.resolution} {item.video_bitrate ? `(${Math.round(item.video_bitrate / 1000)} Mbps)` : ''}
              </span>
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={() => handleDismissUpgrade(item)}
            className="p-2 text-muted-foreground hover:text-foreground hover:bg-muted rounded-lg transition-colors"
            title="Dismiss Upgrade"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
    )
  }

  // Render individual missing row
  const renderMissingRow = (_index: number, item: MissingItem) => {
    return (
      <div className="flex items-center gap-4 p-4 mb-2 bg-card border border-border/50 rounded-xl shadow-sm hover:border-border transition-colors group">
        <div className="flex-shrink-0 w-16 h-24 bg-muted rounded overflow-hidden">
          {item.poster_url ? (
            <img src={item.poster_url} alt={item.title} className="w-full h-full object-cover" />
          ) : item.type === 'movie' ? (
            <div className="w-full h-full flex items-center justify-center">
              <MoviePlaceholder className="w-8 h-8 text-muted-foreground" />
            </div>
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <TvPlaceholder className="w-8 h-8 text-muted-foreground" />
            </div>
          )}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <h3 className="font-semibold text-base truncate">
              {item.type === 'episode' && item.series_title ? `${item.series_title} - ` : ''}{item.title}
            </h3>
            {item.year && <span className="text-sm text-muted-foreground">({item.year})</span>}
            <span className="px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider bg-primary/10 text-primary rounded-md">
              {item.type}
            </span>
          </div>

          <div className="flex items-center gap-2 text-sm text-muted-foreground mt-2">
            {item.type === 'movie' && item.collection_name && (
              <span>Collection: <strong className="text-foreground">{item.collection_name}</strong></span>
            )}
            {item.type === 'episode' && (
              <span>Season {item.season_number} Episode {item.episode_number}</span>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={() => handleDismissMissing(item)}
            className="p-2 text-muted-foreground hover:text-foreground hover:bg-muted rounded-lg transition-colors"
            title="Dismiss Missing Item"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-muted-foreground flex items-center gap-2">
          <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          Loading wishlist data...
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-background">
      {/* Tabs Header */}
      <div className="flex items-center gap-4 px-6 py-4 border-b border-border/50">
        <button
          onClick={() => setActiveTab('upgrades')}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-colors ${
            activeTab === 'upgrades'
              ? 'bg-primary text-primary-foreground'
              : 'text-muted-foreground hover:bg-muted'
          }`}
        >
          <ArrowUpCircle className="w-4 h-4" />
          Upgrades ({upgrades.length})
        </button>

        <button
          onClick={() => setActiveTab('missing')}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-colors ${
            activeTab === 'missing'
              ? 'bg-primary text-primary-foreground'
              : 'text-muted-foreground hover:bg-muted'
          }`}
        >
          <Info className="w-4 h-4" />
          Missing ({missing.length})
        </button>
      </div>

      {/* List Content */}
      <div className="flex-1 px-6 py-4 min-h-0 overflow-hidden">
        {activeTab === 'upgrades' ? (
          upgrades.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
              <ArrowUpCircle className="w-12 h-12 mb-4 opacity-20" />
              <p>No upgrades needed. Your library is looking great!</p>
            </div>
          ) : (
            <Virtuoso
              data={upgrades}
              itemContent={renderUpgradeRow}
              className="h-full scrollbar-visible"
              style={{ height: '100%' }}
            />
          )
        ) : (
          missing.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
              <Info className="w-12 h-12 mb-4 opacity-20" />
              <p>No missing items found in your tracked collections or series.</p>
            </div>
          ) : (
            <Virtuoso
              data={missing}
              itemContent={renderMissingRow}
              className="h-full scrollbar-visible"
              style={{ height: '100%' }}
            />
          )
        )}
      </div>
    </div>
  )
}
