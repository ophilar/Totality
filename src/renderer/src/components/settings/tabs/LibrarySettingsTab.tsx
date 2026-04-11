/**
 * LibrarySettingsTab - Settings tab for library preferences and exclusion management
 *
 * Uses collapsible card layout matching the Services tab pattern.
 */

import { useState, useEffect, useCallback } from 'react'
import {
  Music,
  Film,
  Tv,
  CircleFadingArrowUp,
  ChevronDown,
  ChevronRight,
  X,
  Loader2,
  Library,
  CheckCircle,
  Circle,
  Lock,
} from 'lucide-react'

interface ExclusionRecord {
  id: number
  exclusion_type: string
  reference_id: number | null
  reference_key: string | null
  parent_key: string | null
  title: string | null
  created_at: string
}

const EXCLUSION_SECTIONS = [
  { type: 'media_upgrade', label: 'Dismissed Upgrades', icon: CircleFadingArrowUp },
  { type: 'collection_movie', label: 'Dismissed Collection Movies', icon: Film },
  { type: 'series_episode', label: 'Dismissed Episodes', icon: Tv },
  { type: 'artist_album', label: 'Dismissed Albums', icon: Music },
] as const

// Collapsible card matching Services tab design
interface SettingsCardProps {
  title: string
  description: string
  icon: React.ReactNode
  status: 'configured' | 'partial' | 'not-configured'
  statusText: string
  expanded: boolean
  onToggle: () => void
  children: React.ReactNode
}

function SettingsCard({
  title,
  description,
  icon,
  status,
  statusText,
  expanded,
  onToggle,
  children,
}: SettingsCardProps) {
  return (
    <div className="border border-border/40 rounded-lg overflow-hidden bg-card/30">
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-3 p-4 hover:bg-muted/30 transition-colors text-left"
      >
        <div className="shrink-0">
          {status === 'configured' ? (
            <CheckCircle className="w-5 h-5 text-green-500" />
          ) : status === 'partial' ? (
            <CheckCircle className="w-5 h-5 text-amber-500" />
          ) : (
            <Circle className="w-5 h-5 text-muted-foreground/50" />
          )}
        </div>
        <div className="shrink-0 text-muted-foreground">{icon}</div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium text-sm">{title}</span>
            <span className="text-xs text-muted-foreground">{statusText}</span>
          </div>
          <p className="text-xs text-muted-foreground truncate">{description}</p>
        </div>
        <ChevronDown
          className={`w-4 h-4 text-muted-foreground transition-transform duration-200 ${
            expanded ? 'rotate-180' : ''
          }`}
        />
      </button>
      {expanded && (
        <div className="px-4 pb-4 pt-2 border-t border-border/30 bg-muted/10">{children}</div>
      )}
    </div>
  )
}

function Toggle({
  checked,
  onChange,
  disabled = false,
}: {
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => !disabled && onChange(!checked)}
      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-hidden focus:ring-2 focus:ring-primary focus:ring-offset-2 focus:ring-offset-background ${
        disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'
      } ${checked ? 'bg-primary' : 'bg-muted'}`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-background shadow-md ring-1 ring-border/50 transition-transform ${
          checked ? 'translate-x-6' : 'translate-x-1'
        }`}
      />
    </button>
  )
}

export function LibrarySettingsTab() {
  const [isLoading, setIsLoading] = useState(true)

  // Card expand state
  const [expandedCards, setExpandedCards] = useState<Set<string>>(new Set(['analysis']))

  // Music completeness toggles
  const [includeEps, setIncludeEps] = useState(true)
  const [includeSingles, setIncludeSingles] = useState(true)

  // Exclusions
  const [exclusions, setExclusions] = useState<Record<string, ExclusionRecord[]>>({
    media_upgrade: [],
    collection_movie: [],
    series_episode: [],
    artist_album: [],
  })
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set())

  // Protected Libraries state
  const [sources, setSources] = useState<any[]>([])
  const [sourceLibraries, setSourceLibraries] = useState<Record<string, any[]>>({})
  const [hasPin, setHasPin] = useState(false)
  const [isChangingPin, setIsChangingPin] = useState(false)
  const [newPin, setNewPin] = useState('')

  const toggleCard = (card: string) => {
    setExpandedCards((prev) => {
      const next = new Set(prev)
      if (next.has(card)) next.delete(card)
      else next.add(card)
      return next
    })
  }

  // Load sources and their libraries
  const loadSourceData = useCallback(async () => {
    try {
      const srcList = await window.electronAPI.sourcesList()
      setSources(srcList)
      
      const libMap: Record<string, any[]> = {}
      await Promise.all(srcList.map(async (src: any) => {
        const libs = await window.electronAPI.sourcesGetLibrariesWithStatus(src.source_id)
        libMap[src.source_id] = libs
      }))
      setSourceLibraries(libMap)
      
      const pinStatus = await window.electronAPI.dbHasPin()
      setHasPin(pinStatus)
    } catch (err) {
      window.electronAPI.log.error('[LibrarySettingsTab]', 'Failed to load source/library data:', err)
    }
  }, [])

  // Load all data on mount
  useEffect(() => {
    async function loadData() {
      try {
        await loadSourceData()
        
        const [
          epsVal,
          singlesVal,
          mediaUpgrade,
          collectionMovie,
          seriesEpisode,
          artistAlbum,
        ] = await Promise.all([
          window.electronAPI.getSetting('completeness_include_eps'),
          window.electronAPI.getSetting('completeness_include_singles'),
          window.electronAPI.getExclusions('media_upgrade'),
          window.electronAPI.getExclusions('collection_movie'),
          window.electronAPI.getExclusions('series_episode'),
          window.electronAPI.getExclusions('artist_album'),
        ])

        setIncludeEps((epsVal as string) !== 'false')
        setIncludeSingles((singlesVal as string) !== 'false')
        setExclusions({
          media_upgrade: mediaUpgrade as ExclusionRecord[],
          collection_movie: collectionMovie as ExclusionRecord[],
          series_episode: seriesEpisode as ExclusionRecord[],
          artist_album: artistAlbum as ExclusionRecord[],
        })
      } catch (error) {
        window.electronAPI.log.error('[LibrarySettingsTab]', 'Failed to load library settings:', error)
      } finally {
        setIsLoading(false)
      }
    }
    loadData()
  }, [loadSourceData])

  const handleToggleProtected = async (sourceId: string, libraryId: string, isProtected: boolean) => {
    try {
      await window.electronAPI.dbSetLibraryProtected(sourceId, libraryId, isProtected)
      await loadSourceData()
    } catch (err) {
      window.electronAPI.log.error('[LibrarySettingsTab]', 'Failed to toggle library protection:', err)
    }
  }

  const handleSetPin = async () => {
    if (newPin.length < 4) return
    try {
      await window.electronAPI.dbSetPin(newPin)
      setNewPin('')
      setIsChangingPin(false)
      const pinStatus = await window.electronAPI.dbHasPin()
      setHasPin(pinStatus)
    } catch (err) {
      window.electronAPI.log.error('[LibrarySettingsTab]', 'Failed to set PIN:', err)
    }
  }

  const reloadExclusions = useCallback(async () => {
    try {
      const [mediaUpgrade, collectionMovie, seriesEpisode, artistAlbum] = await Promise.all([
        window.electronAPI.getExclusions('media_upgrade'),
        window.electronAPI.getExclusions('collection_movie'),
        window.electronAPI.getExclusions('series_episode'),
        window.electronAPI.getExclusions('artist_album'),
      ])
      setExclusions({
        media_upgrade: mediaUpgrade as ExclusionRecord[],
        collection_movie: collectionMovie as ExclusionRecord[],
        series_episode: seriesEpisode as ExclusionRecord[],
        artist_album: artistAlbum as ExclusionRecord[],
      })
    } catch (error) {
      window.electronAPI.log.error('[LibrarySettingsTab]', 'Failed to reload exclusions:', error)
    }
  }, [])

  const toggleSection = useCallback((type: string) => {
    setExpandedSections((prev) => {
      const next = new Set(prev)
      if (next.has(type)) next.delete(type)
      else next.add(type)
      return next
    })
  }, [])

  const handleRemoveExclusion = useCallback(
    async (id: number, type: string) => {
      setExclusions((prev) => ({
        ...prev,
        [type]: prev[type].filter((e) => e.id !== id),
      }))
      try {
        await window.electronAPI.removeExclusion(id)
        // Notify library views to reload completeness data
        window.dispatchEvent(new CustomEvent('exclusions-changed', { detail: { type } }))
      } catch (error) {
        window.electronAPI.log.error('[LibrarySettingsTab]', 'Failed to remove exclusion:', error)
        await reloadExclusions()
      }
    },
    [reloadExclusions]
  )

  const handleClearAll = useCallback(
    async (type: string) => {
      const items = exclusions[type]
      if (items.length === 0) return
      setExclusions((prev) => ({ ...prev, [type]: [] }))
      try {
        await Promise.all(items.map((e) => window.electronAPI.removeExclusion(e.id)))
        // Notify library views to reload completeness data
        window.dispatchEvent(new CustomEvent('exclusions-changed', { detail: { type } }))
      } catch (error) {
        window.electronAPI.log.error('[LibrarySettingsTab]', 'Failed to clear exclusions:', error)
        await reloadExclusions()
      }
    },
    [exclusions, reloadExclusions]
  )

  if (isLoading) {
    return (
      <div className="p-6 flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  const totalExclusions = Object.values(exclusions).reduce((sum, list) => sum + list.length, 0)

  return (
    <div className="p-6 space-y-5 overflow-y-auto h-full">
      {/* Header */}
      <div className="mb-4">
        <p className="text-xs text-muted-foreground">
          Configure library analysis preferences and exclusions.
        </p>
      </div>

      {/* Library Analysis Card */}
      <SettingsCard
        title="Library Analysis"
        description="Music completeness and dismissed items"
        icon={<Library className="w-5 h-5" />}
        status="configured"
        statusText={
          totalExclusions > 0
            ? `${totalExclusions} exclusion${totalExclusions !== 1 ? 's' : ''}`
            : 'Active'
        }
        expanded={expandedCards.has('analysis')}
        onToggle={() => toggleCard('analysis')}
      >
        <div className="space-y-4">
          {/* Completeness Options */}
          <div className="space-y-2">
            <p className="text-xs font-medium text-foreground">Completeness</p>
            <p className="text-xs text-muted-foreground">
              Configure how completeness analysis works across your libraries.
              Changes take effect on next analysis run.
            </p>
            <div className="bg-background/50 rounded-lg divide-y divide-border/30">
              <div className="flex items-center justify-between px-4 py-3">
                <span className="text-sm text-foreground">Include EPs</span>
                <Toggle
                  checked={includeEps}
                  onChange={async (checked) => {
                    setIncludeEps(checked)
                    await window.electronAPI.setSetting(
                      'completeness_include_eps',
                      String(checked)
                    )
                  }}
                />
              </div>
              <div className="flex items-center justify-between px-4 py-3">
                <span className="text-sm text-foreground">Include Singles</span>
                <Toggle
                  checked={includeSingles}
                  onChange={async (checked) => {
                    setIncludeSingles(checked)
                    await window.electronAPI.setSetting(
                      'completeness_include_singles',
                      String(checked)
                    )
                  }}
                />
              </div>
            </div>
          </div>

          {/* Managed Exclusions */}
          <div className="space-y-2">
            <p className="text-xs font-medium text-foreground">Managed Exclusions</p>
            <p className="text-xs text-muted-foreground">
              {totalExclusions === 0
                ? 'Items you dismiss will appear here.'
                : `${totalExclusions} dismissed item${totalExclusions !== 1 ? 's' : ''}. Remove items to see them again.`}
            </p>
            <div className="bg-background/50 rounded-lg divide-y divide-border/30">
              {EXCLUSION_SECTIONS.map((section) => {
                const items = exclusions[section.type] || []
                const isExpanded = expandedSections.has(section.type)
                const Icon = section.icon

                return (
                  <div key={section.type}>
                    <button
                      type="button"
                      onClick={() => toggleSection(section.type)}
                      className="w-full flex items-center justify-between px-4 py-3 hover:bg-muted/30 transition-colors"
                    >
                      <div className="flex items-center gap-3">
                        <Icon className="w-4 h-4 text-muted-foreground shrink-0" />
                        <span className="text-sm text-foreground">{section.label}</span>
                        {items.length > 0 && (
                          <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded-full">
                            {items.length}
                          </span>
                        )}
                      </div>
                      {isExpanded ? (
                        <ChevronDown className="w-4 h-4 text-muted-foreground" />
                      ) : (
                        <ChevronRight className="w-4 h-4 text-muted-foreground" />
                      )}
                    </button>

                    {isExpanded && (
                      <div className="border-t border-border/30">
                        {items.length === 0 ? (
                          <p className="px-4 py-3 text-xs text-muted-foreground italic">
                            No dismissed items
                          </p>
                        ) : (
                          <>
                            <div className="flex justify-end px-4 pt-2">
                              <button
                                type="button"
                                onClick={() => handleClearAll(section.type)}
                                className="text-xs text-muted-foreground hover:text-destructive transition-colors"
                              >
                                Clear All
                              </button>
                            </div>
                            <div className="max-h-48 overflow-y-auto px-4 pb-3">
                              {items.map((item) => (
                                <div
                                  key={item.id}
                                  className="flex items-center justify-between py-1.5 group"
                                >
                                  <span className="text-xs text-foreground truncate mr-2">
                                    {item.title || item.reference_key || 'Unknown item'}
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => handleRemoveExclusion(item.id, section.type)}
                                    className="p-1 rounded-md text-muted-foreground hover:text-destructive transition-colors opacity-0 group-hover:opacity-100 shrink-0"
                                    title="Remove exclusion"
                                  >
                                    <X className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              ))}
                            </div>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>        </div>
      </SettingsCard>

      {/* Protected Libraries Card */}
      <SettingsCard
        title="Protected Libraries"
        description="Hide sensitive or personal libraries behind a PIN"
        icon={<Lock className="w-5 h-5" />}
        status={hasPin ? 'configured' : 'not-configured'}
        statusText={hasPin ? 'PIN Set' : 'No PIN'}
        expanded={expandedCards.has('security')}
        onToggle={() => toggleCard('security')}
      >
        <div className="space-y-6">
          {/* PIN Management */}
          <div className="space-y-2">
            <p className="text-xs font-medium text-foreground">Security PIN</p>
            <p className="text-xs text-muted-foreground">
              Used to unlock libraries marked as protected.
            </p>
            
            {!isChangingPin ? (
              <div className="flex items-center justify-between bg-background/50 px-4 py-3 rounded-lg border border-border/30">
                <span className="text-sm font-medium">
                  {hasPin ? '••••••••' : 'No PIN configured'}
                </span>
                <button
                  onClick={() => setIsChangingPin(true)}
                  className="text-xs text-primary hover:underline font-medium"
                >
                  {hasPin ? 'Change PIN' : 'Set PIN'}
                </button>
              </div>
            ) : (
              <div className="flex gap-2 items-center">
                <input
                  type="password"
                  value={newPin}
                  onChange={(e) => setNewPin(e.target.value.replace(/[^0-9]/g, ''))}
                  placeholder="Enter 4-8 digits"
                  maxLength={8}
                  className="flex-1 px-3 py-2 bg-background border border-border rounded-md text-sm focus:outline-hidden focus:ring-2 focus:ring-primary"
                />
                <button
                  onClick={handleSetPin}
                  disabled={newPin.length < 4}
                  className="px-3 py-2 bg-primary text-primary-foreground rounded-md text-xs font-bold disabled:opacity-50"
                >
                  Save
                </button>
                <button
                  onClick={() => { setIsChangingPin(false); setNewPin('') }}
                  className="px-3 py-2 bg-muted text-muted-foreground rounded-md text-xs font-bold"
                >
                  Cancel
                </button>
              </div>
            )}
          </div>

          {/* Library List */}
          <div className="space-y-3">
            <p className="text-xs font-medium text-foreground">Manage Libraries</p>
            {sources.length === 0 ? (
              <p className="text-xs text-muted-foreground italic">No sources configured.</p>
            ) : (
              <div className="space-y-4">
                {sources.map(source => {
                  const libs = sourceLibraries[source.source_id] || []
                  if (libs.length === 0) return null
                  
                  return (
                    <div key={source.source_id} className="space-y-2">
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/70">
                          {source.display_name}
                        </span>
                        <div className="h-px bg-border/20 flex-1" />
                      </div>
                      
                      <div className="bg-background/50 rounded-lg border border-border/30 divide-y divide-border/20">
                        {libs.map(lib => (
                          <div key={lib.id} className="flex items-center justify-between px-4 py-2.5">
                            <div className="min-w-0">
                              <p className="text-sm font-medium truncate">{lib.name}</p>
                              <p className="text-[10px] text-muted-foreground uppercase">{lib.type}</p>
                            </div>
                            <div className="flex items-center gap-3">
                              {lib.isProtected && <Lock className="w-3 h-3 text-amber-500" />}
                              <Toggle 
                                checked={!!lib.isProtected}
                                onChange={(checked) => handleToggleProtected(source.source_id, lib.id, checked)}
                              />
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      </SettingsCard>

    </div>
  )
}
