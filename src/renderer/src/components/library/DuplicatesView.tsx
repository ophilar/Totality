import { useState, useEffect, useCallback } from 'react'
import { 
  Layers, RefreshCw, CheckCircle2, AlertTriangle, 
  ChevronDown, ChevronRight, Info, Search,
  HardDrive
} from 'lucide-react'
import { useSources } from '@/contexts/SourceContext'
import { useToast } from '@/contexts/ToastContext'
import { MoviePlaceholder, TvPlaceholder } from '@/components/ui/MediaPlaceholders'
import type { MediaItem } from './types'

interface DuplicateGroup {
  id: number
  source_id: string
  external_id: string
  external_type: 'tmdb_movie' | 'tmdb_series' | 'musicbrainz_artist' | 'musicbrainz_album'
  media_item_ids: string
  status: 'pending' | 'resolved' | 'ignored'
  resolution_strategy?: string
  resolved_at?: string
  created_at: string
  
  // Joined/Loaded data
  items?: MediaItem[]
  recommendation?: { keep: number; discard: number[]; reason: string }
}

export function DuplicatesView() {
  const { activeSourceId } = useSources()
  const { addToast } = useToast()
  
  const [groups, setGroups] = useState<DuplicateGroup[]>([])
  const [loading, setLoading] = useState(true)
  const [scanning, setScanning] = useState(false)
  const [expandedGroups, setExpandedGroups] = useState<Set<number>>(new Set())
  const [resolvingId, setResolvingId] = useState<number | null>(null)
  const [deleteFiles, setDeleteFiles] = useState(false)

  const loadDuplicates = useCallback(async () => {
    setLoading(true)
    try {
      const pendingGroups = await window.electronAPI.duplicatesGetPending(activeSourceId || undefined)
      
      // Load full items and recommendations for each group
      const enrichedGroups = await Promise.all(pendingGroups.map(async (group: any) => {
        const itemIds = JSON.parse(group.media_item_ids) as number[]
        
        // Fetch full media item records
        const items = await Promise.all(itemIds.map(id => window.electronAPI.getMediaItem(id)))
        const validItems = items.filter((i: any): i is MediaItem => !!i)
        
        // Get recommendation
        const recommendation = await window.electronAPI.duplicatesGetRecommendation(itemIds)
        
        return {
          ...group,
          items: validItems,
          recommendation
        }
      }))
      
      setGroups(enrichedGroups)
    } catch (err) {
      console.error('Failed to load duplicates:', err)
      addToast({ title: 'Error', message: 'Error loading duplicates', type: 'error' })
    } finally {
      setLoading(false)
    }
  }, [activeSourceId, addToast])

  useEffect(() => {
    loadDuplicates()
  }, [loadDuplicates])

  const handleScan = async () => {
    setScanning(true)
    try {
      const count = await window.electronAPI.duplicatesScan(activeSourceId || undefined)
      addToast({ title: 'Scan Complete', message: `Scan complete. Found ${count} duplicate groups.`, type: 'success' })
      loadDuplicates()
    } catch (err) {
      addToast({ title: 'Scan Failed', message: 'Failed to scan for duplicates', type: 'error' })
    } finally {
      setScanning(false)
    }
  }

  const toggleGroup = (id: number) => {
    setExpandedGroups(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleResolve = async (groupId: number, keepItemId: number) => {
    setResolvingId(groupId)
    try {
      await window.electronAPI.duplicatesResolve(groupId, keepItemId, deleteFiles)
      addToast({ title: 'Resolved', message: 'Duplicate resolved successfully', type: 'success' })
      loadDuplicates()
    } catch (err) {
      addToast({ title: 'Error', message: 'Failed to resolve duplicate', type: 'error' })
    } finally {
      setResolvingId(null)
    }
  }

  const formatSize = (bytes: number) => {
    if (bytes === 0) return '0 B'
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
  }

  if (loading && groups.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-12 text-muted-foreground">
        <RefreshCw className="w-8 h-8 animate-spin mb-4" />
        <p>Loading duplicate groups...</p>
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-background">
      {/* Header */}
      <div className="shrink-0 p-6 border-b flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Layers className="w-6 h-6 text-primary" />
            Duplicate Management
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Review and resolve items with multiple physical files.
          </p>
        </div>
        
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 bg-card border rounded-lg px-3 py-1.5 text-sm">
            <input 
              type="checkbox" 
              id="delete-files" 
              checked={deleteFiles}
              onChange={(e) => setDeleteFiles(e.target.checked)}
              className="rounded border-border text-primary focus:ring-primary"
            />
            <label htmlFor="delete-files" className="cursor-pointer select-none">
              Delete files from disk on resolve
            </label>
          </div>
          
          <button
            onClick={handleScan}
            disabled={scanning}
            className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {scanning ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
            {scanning ? 'Scanning...' : 'Scan for Duplicates'}
          </button>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-y-auto p-6">
        {groups.length === 0 ? (
          <div className="bg-card border rounded-xl p-12 text-center flex flex-col items-center max-w-2xl mx-auto mt-12">
            <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center mb-4">
              <CheckCircle2 className="w-8 h-8 text-green-500" />
            </div>
            <h3 className="text-xl font-semibold mb-2">No Duplicates Found</h3>
            <p className="text-muted-foreground mb-6">
              Your library looks clean! All matched items appear to have unique physical files.
            </p>
            <button
              onClick={handleScan}
              className="text-primary font-medium hover:underline flex items-center gap-1"
            >
              Run a manual scan <RefreshCw className="w-3 h-3" />
            </button>
          </div>
        ) : (
          <div className="space-y-4 max-w-6xl mx-auto">
            <div className="flex items-center gap-2 text-sm text-muted-foreground mb-4">
              <AlertTriangle className="w-4 h-4 text-amber-500" />
              <span>Found {groups.length} items with duplicate files. Resolve them to save storage space.</span>
            </div>

            {groups.map((group) => {
              const mainItem = group.items?.[0]
              const isExpanded = expandedGroups.has(group.id)
              const rec = group.recommendation
              
              if (!mainItem) return null

              return (
                <div key={group.id} className="bg-card border rounded-xl overflow-hidden shadow-sm">
                  {/* Summary Card */}
                  <div 
                    className="p-4 flex items-center gap-4 cursor-pointer hover:bg-muted/30 transition-colors"
                    onClick={() => toggleGroup(group.id)}
                  >
                    <div className="w-12 h-18 bg-muted rounded overflow-hidden shrink-0">
                      {mainItem.poster_url ? (
                        <img src={mainItem.poster_url} alt="" className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center">
                          {mainItem.type === 'movie' ? <MoviePlaceholder className="w-6 h-6" /> : <TvPlaceholder className="w-6 h-6" />}
                        </div>
                      )}
                    </div>
                    
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <h4 className="font-bold text-lg truncate">{mainItem.title}</h4>
                        {mainItem.year && <span className="text-muted-foreground">({mainItem.year})</span>}
                        <span className="px-2 py-0.5 bg-muted rounded text-[10px] uppercase font-bold tracking-wider text-muted-foreground">
                          {group.external_type.replace('tmdb_', '')}
                        </span>
                      </div>
                      <div className="flex items-center gap-4 mt-1 text-sm text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <HardDrive className="w-3.5 h-3.5" />
                          {group.items?.length} versions
                        </span>
                        <span className="flex items-center gap-1">
                          <Info className="w-3.5 h-3.5" />
                          Rec: {group.items?.find(i => i.id === rec?.keep)?.resolution || 'Unknown'}
                        </span>
                      </div>
                    </div>

                    <div className="shrink-0 flex items-center gap-3">
                      {isExpanded ? <ChevronDown className="w-5 h-5 text-muted-foreground" /> : <ChevronRight className="w-5 h-5 text-muted-foreground" />}
                    </div>
                  </div>

                  {/* Comparison Details */}
                  {isExpanded && (
                    <div className="border-t bg-muted/10 p-4 animate-in slide-in-from-top-2 duration-200">
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="text-muted-foreground border-b border-border/50">
                              <th className="text-left py-2 font-medium pl-2">Quality</th>
                              <th className="text-left py-2 font-medium">Codec</th>
                              <th className="text-left py-2 font-medium">Bitrate</th>
                              <th className="text-left py-2 font-medium">Audio/Subs</th>
                              <th className="text-left py-2 font-medium">Size</th>
                              <th className="text-left py-2 font-medium">Path</th>
                              <th className="text-right py-2 font-medium pr-2">Action</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-border/50">
                            {group.items?.map((item) => {
                              const isRec = rec?.keep === item.id
                              return (
                                <tr key={item.id} className={`${isRec ? 'bg-primary/5' : ''}`}>
                                  <td className="py-3 pl-2">
                                    <div className="flex items-center gap-2">
                                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                                        item.quality_tier === '4K' ? 'bg-purple-500/20 text-purple-400 border border-purple-500/30' :
                                        item.quality_tier === '1080p' ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30' :
                                        'bg-zinc-500/20 text-zinc-400 border border-zinc-500/30'
                                      }`}>
                                        {item.resolution}
                                      </span>
                                      {isRec && (
                                        <span className="flex items-center gap-0.5 text-[10px] font-bold text-primary uppercase">
                                          <CheckCircle2 className="w-3 h-3" /> Recommended
                                        </span>
                                      )}
                                    </div>
                                  </td>
                                  <td className="py-3">
                                    <div className="font-medium">{item.video_codec?.toUpperCase()}</div>
                                    <div className="text-[10px] text-muted-foreground uppercase">{item.video_profile || 'Standard'}</div>
                                  </td>
                                  <td className="py-3">
                                    <div className="font-medium">{(item.video_bitrate! / 1000).toFixed(1)} Mbps</div>
                                  </td>
                                  <td className="py-3">
                                    <div className="text-[11px] text-foreground/80">{item.audio_codec?.toUpperCase()} {item.audio_channels}ch</div>
                                    <div className="text-[10px] text-muted-foreground uppercase">
                                      {item.audio_language?.toUpperCase() || 'UNK'} | {item.audio_tracks ? 'PARSED' : 'NO INFO'}
                                    </div>
                                  </td>
                                  <td className="py-3">
                                    <div className="font-medium">{formatSize(item.file_size || 0)}</div>
                                  </td>
                                  <td className="py-3 max-w-xs">
                                    <div className="text-[11px] text-muted-foreground truncate hover:text-foreground cursor-help" title={item.file_path || ''}>
                                      {item.file_path}
                                    </div>
                                  </td>
                                  <td className="py-3 pr-2 text-right">
                                    <button
                                      disabled={resolvingId !== null}
                                      onClick={() => handleResolve(group.id, item.id!)}
                                      className={`px-3 py-1.5 rounded-md text-xs font-bold transition-all ${
                                        isRec 
                                          ? 'bg-primary text-primary-foreground hover:opacity-90' 
                                          : 'bg-card border hover:bg-muted'
                                      }`}
                                    >
                                      {resolvingId === group.id ? <RefreshCw className="w-3 h-3 animate-spin" /> : 'Keep'}
                                    </button>
                                  </td>
                                </tr>
                              )
                            })}
                          </tbody>
                        </table>
                      </div>
                      
                      {rec && (
                        <div className="mt-4 p-3 bg-card border rounded-lg flex items-start gap-3">
                          <Info className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                          <div>
                            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Reasoning</p>
                            <p className="text-sm mt-0.5">{rec.reason}</p>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
