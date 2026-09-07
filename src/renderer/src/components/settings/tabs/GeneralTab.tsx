/**
 * GeneralTab - Settings tab for general application behavior
 *
 * Features:
 * - Minimize to tray on close
 * - Start minimized to tray
 * - Live monitoring configuration (enable, polling intervals, behavior)
 */

import { useState, useEffect, useCallback } from 'react'
import { Loader2, Monitor, Radio, ChevronDown, CheckCircle, Circle, Languages, HardDrive, FolderOpen, Zap, ShieldCheck, Copy } from 'lucide-react'

// Collapsible settings card matching Library/Services tab pattern
function SettingsCard({ title, description, icon, status, statusText, expanded, onToggle, children }: {
  title: string
  description: string
  icon: React.ReactNode
  status: 'configured' | 'partial' | 'not-configured'
  statusText: string
  expanded: boolean
  onToggle: () => void
  children: React.ReactNode
}) {
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
        <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`} />
      </button>
      {expanded && (
        <div className="px-4 pb-4 pt-2 border-t border-border/30 bg-muted/10">{children}</div>
      )}
    </div>
  )
}

interface MonitoringConfig {
  enabled: boolean
  startOnLaunch: boolean
  pauseDuringManualScan: boolean
  pollingIntervals: Record<string, number>
}

interface MediaSource {
  source_id: string
  source_type: string
  display_name: string
  is_enabled: boolean
}

import { ProviderType } from '@main/types/database'
import { PROVIDERS } from '@main/constants/providers'

const MONITORING_PROVIDERS: Array<{
  key: string
  name: string
  method: 'polling' | 'file-watching'
}> = [
  { key: ProviderType.Plex, name: PROVIDERS[ProviderType.Plex].name, method: 'polling' },
  { key: ProviderType.Jellyfin, name: PROVIDERS[ProviderType.Jellyfin].name, method: 'polling' },
  { key: ProviderType.Emby, name: PROVIDERS[ProviderType.Emby].name, method: 'polling' },
  { key: ProviderType.Kodi, name: PROVIDERS[ProviderType.Kodi].name, method: 'polling' },
  { key: ProviderType.Local, name: PROVIDERS[ProviderType.Local].name, method: 'file-watching' },
]

const INTERVAL_OPTIONS = [
  { label: '1 min', value: 60000 },
  { label: '2 min', value: 120000 },
  { label: '5 min', value: 300000 },
  { label: '10 min', value: 600000 },
  { label: '15 min', value: 900000 },
  { label: '30 min', value: 1800000 },
]

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

export function GeneralTab() {
  const [expandedCards, setExpandedCards] = useState<Set<string>>(new Set())
  const toggleCard = (id: string) => setExpandedCards(prev => {
    const next = new Set(prev)
    next.has(id) ? next.delete(id) : next.add(id)
    return next
  })

  const [isLoading, setIsLoading] = useState(true)
  const [minimizeToTray, setMinimizeToTray] = useState(false)
  const [startMinimized, setStartMinimized] = useState(false)
  const [subtitlePreferredLanguages, setSubtitlePreferredLanguages] = useState('eng, heb, spa')
  const [isSavingSubtitles, setIsSavingSubtitles] = useState(false)
  const [subtitleSaved, setSubtitleSaved] = useState(false)
  const [transcodingTempDir, setTranscodingTempDir] = useState('')
  const [transcodingDefaultOutputMode, setTranscodingDefaultOutputMode] = useState<'replace' | 'quarantine-replace' | 'copy'>('quarantine-replace')
  const [isSavingTranscodeSettings, setIsSavingTranscodeSettings] = useState(false)
  const [transcodeSettingsSaved, setTranscodeSettingsSaved] = useState(false)
  // Monitoring state
  const [monitoringConfig, setMonitoringConfig] = useState<MonitoringConfig>({
    enabled: false,
    startOnLaunch: true,
    pauseDuringManualScan: true,
    pollingIntervals: {
      plex: 300000,
      jellyfin: 300000,
      emby: 300000,
      kodi: 300000,
    },
  })
  const [configuredProviders, setConfiguredProviders] = useState<Set<string>>(new Set())
  const [isSaving, setIsSaving] = useState(false)

  useEffect(() => {
    const load = async () => {
      try {
        const [trayVal, startVal, mConfig, sources, subLangs, tempDirVal, outputModeVal] = await Promise.all([
          window.electronAPI.getSetting('minimize_to_tray'),
          window.electronAPI.getSetting('start_minimized_to_tray'),
          window.electronAPI.monitoringGetConfig(),
          window.electronAPI.sourcesList(),
          window.electronAPI.getSetting('subtitle_preferred_languages'),
          window.electronAPI.getSetting('transcoding_temp_directory'),
          window.electronAPI.getSetting('transcoding_default_output_mode'),
        ])
        setMinimizeToTray(trayVal === 'true')
        setStartMinimized(startVal === 'true')
        setMonitoringConfig(mConfig)
        if (subLangs && typeof subLangs === 'string') {
          setSubtitlePreferredLanguages(subLangs)
        }
        if (tempDirVal && typeof tempDirVal === 'string') {
          setTranscodingTempDir(tempDirVal)
        }
        if (outputModeVal && (outputModeVal === 'replace' || outputModeVal === 'quarantine-replace' || outputModeVal === 'copy')) {
          setTranscodingDefaultOutputMode(outputModeVal)
        }

        const providerTypes = new Set<string>()
        ;(sources as MediaSource[]).forEach((source) => {
          if (source.is_enabled) {
            const type = source.source_type.startsWith('kodi') ? 'kodi' : source.source_type
            providerTypes.add(type)
          }
        })
        setConfiguredProviders(providerTypes)
      } catch (error) {
        window.electronAPI.log.error('[GeneralTab]', 'Failed to load general settings:', error)
      } finally {
        setIsLoading(false)
      }
    }
    load()
  }, [])

  const saveMonitoringConfig = useCallback(
    async (config: Partial<MonitoringConfig>) => {
      setIsSaving(true)
      try {
        await window.electronAPI.monitoringSetConfig(config)
        setMonitoringConfig((prev) => ({ ...prev, ...config }))
      } catch (error) {
        window.electronAPI.log.error('[GeneralTab]', 'Failed to save monitoring config:', error)
      } finally {
        setIsSaving(false)
      }
    },
    []
  )

  if (isLoading) {
    return (
      <div className="p-6 flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="p-6 space-y-5 overflow-y-auto">
      {/* Window Behavior */}
      <SettingsCard
        title="Window Behavior"
        description="System tray and startup options"
        icon={<Monitor className="w-5 h-5" />}
        status="configured"
        statusText={minimizeToTray ? 'Tray enabled' : 'Default'}
        expanded={expandedCards.has('window')}
        onToggle={() => toggleCard('window')}
      >
        <div className="space-y-3">
          <label className="flex items-center justify-between cursor-pointer">
            <div>
              <p className="text-sm font-medium text-foreground">Minimize to tray on close</p>
              <p className="text-xs text-muted-foreground">Closing the window hides the app to the system tray instead of quitting</p>
            </div>
            <Toggle
              checked={minimizeToTray}
              onChange={async (checked) => {
                setMinimizeToTray(checked)
                await window.electronAPI.setSetting('minimize_to_tray', String(checked))
                if (!checked) {
                  setStartMinimized(false)
                  await window.electronAPI.setSetting('start_minimized_to_tray', 'false')
                }
              }}
            />
          </label>

          {minimizeToTray && (
            <label className="flex items-center justify-between cursor-pointer pl-4 border-l-2 border-border/40">
              <div>
                <p className="text-sm font-medium text-foreground">Start minimized to tray</p>
                <p className="text-xs text-muted-foreground">Launch the app hidden in the system tray</p>
              </div>
              <Toggle
                checked={startMinimized}
                onChange={async (checked) => {
                  setStartMinimized(checked)
                  await window.electronAPI.setSetting('start_minimized_to_tray', String(checked))
                }}
              />
            </label>
          )}
        </div>
      </SettingsCard>

      {/* Live Monitoring */}
      <SettingsCard
        title="Live Monitoring"
        description="Automatic change detection for media sources"
        icon={<Radio className="w-5 h-5" />}
        status={monitoringConfig.enabled ? 'configured' : 'not-configured'}
        statusText={monitoringConfig.enabled ? 'Active' : 'Disabled'}
        expanded={expandedCards.has('monitoring')}
        onToggle={() => toggleCard('monitoring')}
      >
        <div className="space-y-4">
          {/* Enable toggle */}
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-foreground">Enable monitoring</p>
              <p className="text-xs text-muted-foreground">
                {monitoringConfig.enabled
                  ? 'Automatically detecting new content'
                  : 'Enable to detect new content automatically'}
              </p>
            </div>
            <Toggle
              checked={monitoringConfig.enabled}
              onChange={(enabled) => saveMonitoringConfig({ enabled })}
              disabled={isSaving}
            />
          </div>

          {/* Source Detection */}
          <div
            className={`space-y-2 transition-opacity ${!monitoringConfig.enabled ? 'opacity-50 pointer-events-none' : ''}`}
          >
            <p className="text-xs font-medium text-foreground">Source Detection</p>
            <div className="bg-background/50 rounded-lg divide-y divide-border/30">
              {MONITORING_PROVIDERS.map((provider) => {
                const isConfigured = configuredProviders.has(provider.key)
                return (
                  <div
                    key={provider.key}
                    className={`flex items-center justify-between px-4 py-2.5 ${
                      !isConfigured ? 'opacity-40' : ''
                    }`}
                  >
                    <span className="text-sm text-foreground">{provider.name}</span>
                    {provider.method === 'polling' ? (
                      <select
                        value={monitoringConfig.pollingIntervals[provider.key] || 300000}
                        onChange={(e) => {
                          const newIntervals = {
                            ...monitoringConfig.pollingIntervals,
                            [provider.key]: parseInt(e.target.value, 10),
                          }
                          saveMonitoringConfig({ pollingIntervals: newIntervals })
                        }}
                        disabled={isSaving || !monitoringConfig.enabled || !isConfigured}
                        className="bg-background text-foreground text-sm rounded-md px-3 py-2 border border-border/30 focus:outline-hidden focus:ring-2 focus:ring-primary min-w-[90px] disabled:opacity-50"
                      >
                        {INTERVAL_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span className="bg-background text-foreground text-sm rounded-md px-3 py-2 border border-border/30 min-w-[90px] text-center">
                        File Watching
                      </span>
                    )}
                  </div>
                )
              })}
            </div>
          </div>

          {/* Behavior */}
          <div
            className={`space-y-2 transition-opacity ${!monitoringConfig.enabled ? 'opacity-50 pointer-events-none' : ''}`}
          >
            <p className="text-xs font-medium text-foreground">Behavior</p>
            <div className="bg-background/50 rounded-lg divide-y divide-border/30">
              <div className="flex items-center justify-between px-4 py-3">
                <span className="text-sm text-foreground">Start on app launch</span>
                <Toggle
                  checked={monitoringConfig.startOnLaunch}
                  onChange={(startOnLaunch) => saveMonitoringConfig({ startOnLaunch })}
                  disabled={isSaving || !monitoringConfig.enabled}
                />
              </div>
              <div className="flex items-center justify-between px-4 py-3">
                <span className="text-sm text-foreground">Pause during manual scans</span>
                <Toggle
                  checked={monitoringConfig.pauseDuringManualScan}
                  onChange={(pauseDuringManualScan) =>
                    saveMonitoringConfig({ pauseDuringManualScan })
                  }
                  disabled={isSaving || !monitoringConfig.enabled}
                />
              </div>
            </div>
          </div>
        </div>
      </SettingsCard>

      {/* Subtitle Stream Preferences */}
      <SettingsCard
        title="Subtitle Stream Preferences"
        description="Default language whitelist for stream remuxing and transcoding"
        icon={<Languages className="w-5 h-5" />}
        status="configured"
        statusText={subtitlePreferredLanguages.trim() ? `${subtitlePreferredLanguages.split(',').filter(Boolean).length} languages` : 'None'}
        expanded={expandedCards.has('subtitles')}
        onToggle={() => toggleCard('subtitles')}
      >
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">
              Global Subtitle Language Whitelist
            </label>
            <p className="text-xs text-muted-foreground mb-3">
              Specify ISO-639 language codes (e.g. <code>eng, heb, spa, jpn</code>) to preserve during lossless stream copy or transcoding. Non-whitelisted subtitles are pruned to eliminate container bloat.
            </p>
            <div className="flex gap-2">
              <input
                type="text"
                value={subtitlePreferredLanguages}
                onChange={(e) => {
                  setSubtitlePreferredLanguages(e.target.value)
                  setSubtitleSaved(false)
                }}
                placeholder="e.g. eng, heb, spa, jpn"
                className="flex-1 bg-background text-foreground text-sm rounded-md px-3 py-2 border border-border/40 focus:outline-hidden focus:ring-2 focus:ring-primary font-mono"
              />
              <button
                type="button"
                onClick={async () => {
                  setIsSavingSubtitles(true)
                  try {
                    await window.electronAPI.setSetting('subtitle_preferred_languages', subtitlePreferredLanguages)
                    setSubtitleSaved(true)
                    setTimeout(() => setSubtitleSaved(false), 2000)
                  } finally {
                    setIsSavingSubtitles(false)
                  }
                }}
                disabled={isSavingSubtitles}
                className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-xs font-bold hover:bg-primary/90 transition-colors disabled:opacity-50 shrink-0 cursor-pointer"
              >
                {isSavingSubtitles ? 'Saving...' : subtitleSaved ? 'Saved!' : 'Save'}
              </button>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
              <span className="font-semibold">Quick Add / Toggle:</span>
              {['eng', 'heb', 'spa', 'fre', 'ger', 'ita', 'jpn', 'kor', 'zho', 'und'].map((code) => {
                const currentList = subtitlePreferredLanguages.split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
                const isAdded = currentList.includes(code)
                return (
                  <button
                    key={code}
                    type="button"
                    onClick={async () => {
                      let updated: string
                      if (isAdded) {
                        updated = currentList.filter(c => c !== code).join(', ')
                      } else {
                        updated = [...currentList, code].join(', ')
                      }
                      setSubtitlePreferredLanguages(updated)
                      setSubtitleSaved(false)
                      await window.electronAPI.setSetting('subtitle_preferred_languages', updated)
                    }}
                    className={`px-2 py-0.5 rounded border transition-colors cursor-pointer ${
                      isAdded
                        ? 'bg-primary/20 border-primary text-primary font-semibold'
                        : 'bg-background/80 border-border/50 text-muted-foreground hover:bg-muted'
                    }`}
                  >
                    {code} {isAdded ? '✓' : '+'}
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      </SettingsCard>

      {/* Transcoding Cache & Output Handling */}
      <SettingsCard
        title="Transcoding Cache & Output Handling"
        description="Dedicated temporary transcode drive and default file replacement strategy"
        icon={<HardDrive className="w-5 h-5" />}
        status="configured"
        statusText={transcodingTempDir ? 'Custom cache path' : 'Default source drive'}
        expanded={expandedCards.has('transcode-cache')}
        onToggle={() => toggleCard('transcode-cache')}
      >
        <div className="space-y-4 pt-2">
          {/* Dedicated Temp Directory */}
          <div className="space-y-2">
            <label className="text-xs font-semibold text-foreground flex items-center gap-1.5">
              <FolderOpen className="w-4 h-4 text-primary" />
              Dedicated Transcoding Cache Directory (Fast SSD / NVMe)
            </label>
            <p className="text-xs text-muted-foreground">
              Directory or dedicated drive used to write temporary encode files. Leave blank to write alongside source media files.
            </p>
            <div className="flex gap-2">
              <input
                type="text"
                value={transcodingTempDir}
                onChange={(e) => {
                  setTranscodingTempDir(e.target.value)
                  setTranscodeSettingsSaved(false)
                }}
                placeholder="e.g. D:\transcode_cache or /tmp/transcode"
                className="flex-1 bg-background text-foreground text-sm rounded-md px-3 py-2 border border-border/40 focus:outline-hidden focus:ring-2 focus:ring-primary font-mono"
              />
              <button
                type="button"
                onClick={async () => {
                  setIsSavingTranscodeSettings(true)
                  try {
                    await window.electronAPI.setSetting('transcoding_temp_directory', transcodingTempDir.trim())
                    await window.electronAPI.setSetting('transcoding_default_output_mode', transcodingDefaultOutputMode)
                    setTranscodeSettingsSaved(true)
                    setTimeout(() => setTranscodeSettingsSaved(false), 2000)
                  } finally {
                    setIsSavingTranscodeSettings(false)
                  }
                }}
                disabled={isSavingTranscodeSettings}
                className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-xs font-bold hover:bg-primary/90 transition-colors disabled:opacity-50 shrink-0 cursor-pointer"
              >
                {isSavingTranscodeSettings ? 'Saving...' : transcodeSettingsSaved ? 'Saved!' : 'Save Settings'}
              </button>
            </div>
          </div>

          {/* Default Output Mode */}
          <div className="space-y-2 pt-2 border-t border-border/20">
            <label className="text-xs font-semibold text-foreground flex items-center gap-1.5">
              <Zap className="w-4 h-4 text-primary" />
              Default Output & Verification Mode
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
              <button
                type="button"
                onClick={async () => {
                  setTranscodingDefaultOutputMode('replace')
                  await window.electronAPI.setSetting('transcoding_default_output_mode', 'replace')
                }}
                className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
                  transcodingDefaultOutputMode === 'replace'
                    ? 'border-primary bg-primary/10 shadow-sm ring-1 ring-primary'
                    : 'border-border bg-card/60 hover:bg-card'
                }`}
              >
                <div className="flex items-center gap-1 font-bold text-xs mb-1">
                  <Zap className="w-3.5 h-3.5 text-primary" />
                  <span>Direct Replace</span>
                </div>
                <p className="text-[11px] text-muted-foreground">In-place replacement with zero residual storage footprint.</p>
              </button>

              <button
                type="button"
                onClick={async () => {
                  setTranscodingDefaultOutputMode('quarantine-replace')
                  await window.electronAPI.setSetting('transcoding_default_output_mode', 'quarantine-replace')
                }}
                className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
                  transcodingDefaultOutputMode === 'quarantine-replace'
                    ? 'border-primary bg-primary/10 shadow-sm ring-1 ring-primary'
                    : 'border-border bg-card/60 hover:bg-card'
                }`}
              >
                <div className="flex items-center gap-1 font-bold text-xs mb-1">
                  <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" />
                  <span>Quarantine & Replace</span>
                </div>
                <p className="text-[11px] text-muted-foreground">Replaces original and retains timestamped backup.</p>
              </button>

              <button
                type="button"
                onClick={async () => {
                  setTranscodingDefaultOutputMode('copy')
                  await window.electronAPI.setSetting('transcoding_default_output_mode', 'copy')
                }}
                className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
                  transcodingDefaultOutputMode === 'copy'
                    ? 'border-primary bg-primary/10 shadow-sm ring-1 ring-primary'
                    : 'border-border bg-card/60 hover:bg-card'
                }`}
              >
                <div className="flex items-center gap-1 font-bold text-xs mb-1">
                  <Copy className="w-3.5 h-3.5 text-muted-foreground" />
                  <span>Create Sibling Copy</span>
                </div>
                <p className="text-[11px] text-muted-foreground">Preserves original intact and outputs an optimized sister file.</p>
              </button>
            </div>
          </div>
        </div>
      </SettingsCard>
    </div>
  )
}
