/**
 * QualitySettingsTab - Settings tab for quality threshold configuration
 *
 * Features:
 * - Video quality thresholds per resolution tier (SD, 720p, 1080p, 4K)
 * - Audio bitrate thresholds
 * - Music quality thresholds (lossy and hi-res)
 * - Re-analyze library after changes
 */

import { useState, useEffect, useRef, useCallback, useId } from 'react'
import { RotateCcw, Save, Loader2, RefreshCw, ChevronDown, Film, Music, Clapperboard } from 'lucide-react'

// Default values for all quality settings
const DEFAULT_SETTINGS = {
  quality_video_sd_medium: 1500,
  quality_video_sd_high: 3500,
  quality_video_720p_medium: 3000,
  quality_video_720p_high: 8000,
  quality_video_1080p_medium: 6000,
  quality_video_1080p_high: 15000,
  quality_video_4k_medium: 15000,
  quality_video_4k_high: 40000,
  quality_audio_sd_medium: 128,
  quality_audio_sd_high: 192,
  quality_audio_720p_medium: 192,
  quality_audio_720p_high: 320,
  quality_audio_1080p_medium: 256,
  quality_audio_1080p_high: 640,
  quality_audio_4k_medium: 320,
  quality_audio_4k_high: 1000,
  quality_music_low_bitrate: 192,
  quality_music_high_bitrate: 256,
  quality_music_hires_samplerate: 44100,
  quality_music_hires_bitdepth: 16,
  quality_codec_h264: 1.0,
  quality_codec_h265: 2.0,
  quality_codec_av1: 2.5,
  quality_codec_vp9: 1.8,
  quality_video_weight: 70,
  quality_efficiency_sd_target: 1200,
  quality_efficiency_720p_target: 2500,
  quality_efficiency_1080p_target: 5000,
  quality_efficiency_4k_target: 15000,
  quality_efficiency_sd_bloat: 2500,
  quality_efficiency_720p_bloat: 5000,
  quality_efficiency_1080p_bloat: 10000,
  quality_efficiency_4k_bloat: 30000,
  quality_efficiency_trash_threshold: 60,
  quality_efficiency_lossless_allowance: 4000,
  quality_efficiency_hdr_overhead: 1.10,
}
type SettingsState = typeof DEFAULT_SETTINGS
type ResolutionTier = 'sd' | '720p' | '1080p' | '4k'

const RESOLUTION_TABS: { id: ResolutionTier; label: string; description: string }[] = [
  { id: 'sd', label: 'SD', description: 'Standard definition (<720p)' },
  { id: '720p', label: '720p', description: '720p HD content' },
  { id: '1080p', label: '1080p', description: '1080p Full HD content' },
  { id: '4k', label: '4K', description: '4K Ultra HD (≥2160p)' },
]

const VIDEO_THRESHOLDS: Record<ResolutionTier, { min: number; max: number; step: number }> = {
  sd: { min: 500, max: 10000, step: 100 },
  '720p': { min: 1000, max: 15000, step: 100 },
  '1080p': { min: 2000, max: 30000, step: 100 },
  '4k': { min: 5000, max: 80000, step: 500 },
}
const AUDIO_THRESHOLDS: Record<ResolutionTier, { min: number; max: number; step: number }> = {
  sd: { min: 64, max: 640, step: 8 },
  '720p': { min: 64, max: 1000, step: 8 },
  '1080p': { min: 64, max: 1500, step: 8 },
  '4k': { min: 64, max: 2000, step: 8 },
}
// Expandable card component (matching ServicesTab)
interface SettingsCardProps {
  title: string
  description: string
  icon: React.ReactNode
  expanded: boolean
  onToggle: () => void
  children: React.ReactNode
}
function SettingsCard({
  title,
  description,
  icon,
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
        {/* Icon */}
        <div className="shrink-0 text-muted-foreground">{icon}</div>

        {/* Title and description */}
        <div className="flex-1 min-w-0">
          <span className="font-medium text-sm">{title}</span>
          <p className="text-xs text-muted-foreground truncate">{description}</p>
        </div>

        {/* Expand indicator */}
        <ChevronDown
          className={`w-4 h-4 text-muted-foreground transition-transform duration-200 ${
            expanded ? 'rotate-180' : ''
          }`}
        />
      </button>

      {/* Expanded content */}
      {expanded && (
        <div className="px-4 pb-4 pt-2 border-t border-border/30 bg-muted/10">{children}</div>
      )}
    </div>
  )
}
function formatEffectiveThreshold(thresholdKbps: number, multiplier: number): string {
  const neededKbps = thresholdKbps / multiplier
  if (neededKbps >= 1000) {
    return `${(neededKbps / 1000).toFixed(1)} Mbps`
  }
  return `${Math.round(neededKbps)} kbps`
}

export function QualitySettingsTab() {
  const [settings, setSettings] = useState<SettingsState>({ ...DEFAULT_SETTINGS })
  const [originalSettings, setOriginalSettings] = useState<SettingsState>({ ...DEFAULT_SETTINGS })
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [hasChanges, setHasChanges] = useState(false)
  const [selectedTier, setSelectedTier] = useState<ResolutionTier>('1080p')
  const [showReanalyzePrompt, setShowReanalyzePrompt] = useState(false)
  const [isReanalyzing, setIsReanalyzing] = useState(false)
  const [reanalyzeProgress, setReanalyzeProgress] = useState<{ current: number; total: number } | null>(null)

  // Expanded state for cards
  const [expandedCards, setExpandedCards] = useState<Set<string>>(new Set())

  const toggleCard = (card: string) => {
    setExpandedCards((prev) => {
      const next = new Set(prev)
      if (next.has(card)) {
        next.delete(card)
      } else {
        next.add(card)
      }
      return next
    })
  }

  useEffect(() => {
    queueMicrotask(() => {
      void (async () => {
        setIsLoading(true)
        const allSettings = await window.electronAPI.getAllSettings()
        const loaded: SettingsState = { ...DEFAULT_SETTINGS }
        for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof SettingsState)[]) {
          if (allSettings[key] !== undefined && allSettings[key] !== '') {
            const value = parseFloat(allSettings[key])
            if (!isNaN(value)) loaded[key] = value
          }
        }
        setSettings(loaded)
        setOriginalSettings(loaded)
        setIsLoading(false)
      })()
    })
  }, [])

  useEffect(() => {
    const cleanup = window.electronAPI.onQualityAnalysisProgress?.((progress: unknown) => {
      setReanalyzeProgress(progress as { current: number; total: number })
    })
    return () => cleanup?.()
  }, [])

  useEffect(() => {
    const changed = JSON.stringify(settings) !== JSON.stringify(originalSettings)
    queueMicrotask(() => { setHasChanges(changed) })
  }, [settings, originalSettings])

  const handleSave = async () => {
    setIsSaving(true)
    try {
      for (const [key, value] of Object.entries(settings)) {
        await window.electronAPI.setSetting(key, String(value))
      }
      setOriginalSettings({ ...settings })
      setShowReanalyzePrompt(true)
    } catch (error) {
      window.electronAPI.log.error('[QualitySettingsTab]', 'Failed to save settings:', error)
    } finally {
      setIsSaving(false)
    }
  }

  const handleReanalyze = async () => {
    setIsReanalyzing(true)
    setReanalyzeProgress({ current: 0, total: 0 })
    try {
      await window.electronAPI.qualityAnalyzeAll()
    } catch (error) {
      window.electronAPI.log.error('[QualitySettingsTab]', 'Failed to re-analyze:', error)
    } finally {
      setIsReanalyzing(false)
      setReanalyzeProgress(null)
      setShowReanalyzePrompt(false)
    }
  }

  const handleSkipReanalyze = () => {
    setShowReanalyzePrompt(false)
  }

  const handleReset = () => {
    setSettings({ ...DEFAULT_SETTINGS })
  }

  const updateSetting = <K extends keyof SettingsState>(key: K, value: SettingsState[K]) => {
    setSettings(prev => ({ ...prev, [key]: value }))
  }

  if (showReanalyzePrompt) {
    return (
      <div className="p-6 flex flex-col items-center justify-center h-64 text-center">
        {isReanalyzing ? (
          <>
            <RefreshCw className="w-8 h-8 animate-spin text-primary mb-4" aria-hidden="true" />
            <h3 className="text-base font-medium mb-2">Re-analyzing Library</h3>
            {reanalyzeProgress && reanalyzeProgress.total > 0 ? (
              <>
                <p className="text-xs text-muted-foreground mb-3">
                  {reanalyzeProgress.current} of {reanalyzeProgress.total} items
                </p>
                <div className="w-64 h-2 bg-muted rounded-full overflow-hidden">
                  <div
                    className="h-full bg-primary transition-all duration-300"
                    style={{ width: `${(reanalyzeProgress.current / reanalyzeProgress.total) * 100}%` }}
                  />
                </div>
              </>
            ) : (
              <p className="text-xs text-muted-foreground">Starting analysis...</p>
            )}
          </>
        ) : (
          <>
            <div className="w-12 h-12 rounded-full bg-primary/20 flex items-center justify-center mb-4">
              <Save className="w-6 h-6 text-primary" />
            </div>
            <h3 className="text-base font-medium mb-2">Settings Saved</h3>
            <p className="text-xs text-muted-foreground mb-6 max-w-sm">
              Would you like to re-analyze your library with the new quality thresholds?
            </p>
            <div className="flex gap-3">
              <button
                onClick={handleSkipReanalyze}
                className="px-3 py-1.5 text-xs rounded-md hover:bg-muted transition-colors"
              >
                Skip
              </button>
              <button
                onClick={handleReanalyze}
                className="px-3 py-1.5 text-xs bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors"
              >
                Re-analyze Library
              </button>
            </div>
          </>
        )}
      </div>
    )
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <RefreshCw className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="p-6 space-y-5 overflow-y-auto">
      {/* Video Quality Card */}
      <SettingsCard
        title="Video Quality"
        description="Bitrate thresholds for movies and TV shows"
        icon={<Film className="w-7 h-7" />}
        expanded={expandedCards.has('video')}
        onToggle={() => toggleCard('video')}
      >
        <div className="space-y-4">
          {/* Resolution Tabs */}
          <div className="flex gap-1 bg-muted p-1 rounded-lg" role="tablist">
            {RESOLUTION_TABS.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setSelectedTier(tab.id)}
                role="tab"
                aria-selected={selectedTier === tab.id}
                className={`flex-1 px-3 py-2 text-xs font-medium rounded-md transition-colors ${
                  selectedTier === tab.id
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <p className="text-xs text-muted-foreground">
            {RESOLUTION_TABS.find(t => t.id === selectedTier)?.description}
          </p>

          <div className="grid grid-cols-2 gap-4">
            <QualityThreshold
              label="Video Bitrate"
              mediumValue={settings[`quality_video_${selectedTier}_medium` as keyof SettingsState] as number}
              highValue={settings[`quality_video_${selectedTier}_high` as keyof SettingsState] as number}
              min={VIDEO_THRESHOLDS[selectedTier].min}
              max={VIDEO_THRESHOLDS[selectedTier].max}
              step={VIDEO_THRESHOLDS[selectedTier].step}
              unit="Mbps"
              displayDivisor={1000}
              onChange={(medium, high) => {
                updateSetting(`quality_video_${selectedTier}_medium` as keyof SettingsState, medium)
                updateSetting(`quality_video_${selectedTier}_high` as keyof SettingsState, high)
              }}
            />
            <QualityThreshold
              label="Audio Bitrate Target"
              mediumValue={settings[`quality_audio_${selectedTier}_medium` as keyof SettingsState] as number}
              highValue={settings[`quality_audio_${selectedTier}_high` as keyof SettingsState] as number}
              min={AUDIO_THRESHOLDS[selectedTier].min}
              max={AUDIO_THRESHOLDS[selectedTier].max}
              step={AUDIO_THRESHOLDS[selectedTier].step}
              unit="kbps"
              onChange={(medium, high) => {
                updateSetting(`quality_audio_${selectedTier}_medium` as keyof SettingsState, medium)
                updateSetting(`quality_audio_${selectedTier}_high` as keyof SettingsState, high)
              }}
            />
            <div className="bg-background/50 rounded-lg p-3 space-y-2 col-span-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium">Score Weighting</span>
              </div>
              <div className="relative h-4">
                <div className="absolute top-1/2 -translate-y-1/2 left-0 right-0 h-1.5 rounded-full overflow-hidden">
                  <div className="absolute h-full bg-accent/40" style={{ left: 0, width: `${settings.quality_video_weight}%` }} />
                  <div className="absolute h-full bg-accent/70" style={{ left: `${settings.quality_video_weight}%`, width: `${100 - settings.quality_video_weight}%` }} />
                </div>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={5}
                  value={settings.quality_video_weight}
                  onChange={(e) => updateSetting('quality_video_weight', parseInt(e.target.value))}
                  className="absolute top-0 left-0 w-full h-full opacity-0 cursor-pointer"
                />
                <div
                  className="absolute top-1/2 -translate-y-1/2 w-3 h-3 bg-white rounded-full shadow-md border-2 border-background z-10 pointer-events-none"
                  style={{ left: `${settings.quality_video_weight}%`, marginLeft: '-6px' }}
                />
              </div>
              <div className="flex justify-between text-[10px] font-medium">
                <span className="text-accent/60">Video {settings.quality_video_weight}%</span>
                <span className="text-accent">Audio {100 - settings.quality_video_weight}%</span>
              </div>
            </div>
          </div>

          {/* Efficiency UI Thresholds */}
          <div className="border-t border-border pt-4 mt-2">
            <h4 className="text-sm font-medium mb-2">Efficiency UI Thresholds</h4>
            <p className="text-xs text-muted-foreground mb-3">
              Configure when the "Efficiency Trash" icon appears in your library.
            </p>

            <div className="grid grid-cols-2 gap-4">
              <NumberInput
                label="Efficiency Score Trash Threshold (%)"
                value={settings.quality_efficiency_trash_threshold}
                min={0}
                max={100}
                step={5}
                onChange={(v) => updateSetting('quality_efficiency_trash_threshold', v)}
                hint="Items with efficiency below this will show the trash icon."
              />
            </div>
          </div>

          {/* Efficiency & Bloat */}
          <div className="border-t border-border pt-4 mt-2">
            <h4 className="text-sm font-medium mb-2">Efficiency & Bloat</h4>
            <p className="text-xs text-muted-foreground mb-3">
              Configure targets for storage efficiency analysis. These thresholds define when a file
              is considered "efficient" or "bloated" for its resolution tier.
            </p>

            <div className="grid grid-cols-2 gap-4">
              <QualityThreshold
                label="Efficiency Target"
                mediumValue={settings[`quality_efficiency_${selectedTier}_target` as keyof SettingsState] as number}
                highValue={settings[`quality_efficiency_${selectedTier}_target` as keyof SettingsState] as number}
                min={VIDEO_THRESHOLDS[selectedTier].min / 2}
                max={VIDEO_THRESHOLDS[selectedTier].max / 2}
                step={VIDEO_THRESHOLDS[selectedTier].step / 2}
                unit="Mbps"
                displayDivisor={1000}
                lowLabel="Efficient"
                mediumLabel="Target"
                highLabel="Target"
                onChange={(val) => {
                  updateSetting(`quality_efficiency_${selectedTier}_target` as keyof SettingsState, val)
                }}
              />
              <QualityThreshold
                label="Bloat Threshold"
                mediumValue={settings[`quality_efficiency_${selectedTier}_bloat` as keyof SettingsState] as number}
                highValue={settings[`quality_efficiency_${selectedTier}_bloat` as keyof SettingsState] as number}
                min={VIDEO_THRESHOLDS[selectedTier].min}
                max={VIDEO_THRESHOLDS[selectedTier].max * 1.5}
                step={VIDEO_THRESHOLDS[selectedTier].step}
                unit="Mbps"
                displayDivisor={1000}
                lowLabel="Optimal"
                mediumLabel="Bloat"
                highLabel="Bloat"
                onChange={(val) => {
                  updateSetting(`quality_efficiency_${selectedTier}_bloat` as keyof SettingsState, val)
                }}
              />
            </div>

            <h4 className="text-xs font-medium mt-4 mb-2">Quality Allowances</h4>
            <p className="text-[10px] text-muted-foreground mb-3">
              High-value features like lossless audio and HDR require more space. These settings
              grant "bitrate credits" so feature-rich files aren't unfairly penalized as bloat.
            </p>

            <div className="grid grid-cols-2 gap-4">
              <QualityThreshold
                label="Lossless Audio Allowance"
                mediumValue={settings.quality_efficiency_lossless_allowance}
                highValue={settings.quality_efficiency_lossless_allowance}
                min={0}
                max={10000}
                step={500}
                unit="Mbps"
                displayDivisor={1000}
                lowLabel="None"
                mediumLabel="Allowance"
                highLabel="Allowance"
                onChange={(val) => updateSetting('quality_efficiency_lossless_allowance', val)}
              />
              <QualityThreshold
                label="HDR Bloat Allowance"
                mediumValue={Math.round(settings.quality_efficiency_hdr_overhead * 100)}
                highValue={Math.round(settings.quality_efficiency_hdr_overhead * 100)}
                min={100}
                max={150}
                step={5}
                unit="%"
                lowLabel="Standard"
                mediumLabel="Allowance"
                highLabel="Allowance"
                onChange={(val) => updateSetting('quality_efficiency_hdr_overhead', val / 100)}
              />
            </div>
          </div>

          {/* Codec Efficiency */}
          <div className="border-t border-border pt-4 mt-2">
            <h4 className="text-sm font-medium mb-2">Codec Efficiency</h4>
            <p className="text-xs text-muted-foreground mb-3">
              Newer codecs like HEVC and AV1 deliver the same picture quality at much lower bitrates
              than H.264. A value of 2.0x means the codec is twice as efficient, so it only needs half
              the bitrate to score the same.
            </p>

            <div className="grid grid-cols-2 gap-4">
              <NumberInput
                label="H.264 (baseline)"
                value={settings.quality_codec_h264}
                min={0.5}
                max={5.0}
                step={0.1}
                onChange={(v) => updateSetting('quality_codec_h264', v)}
                hint={`Needs ${formatEffectiveThreshold(settings[`quality_video_${selectedTier}_high` as keyof SettingsState] as number, settings.quality_codec_h264)} for ${RESOLUTION_TABS.find(t => t.id === selectedTier)?.label} HIGH`}
              />
              <NumberInput
                label="HEVC / H.265"
                value={settings.quality_codec_h265}
                min={0.5}
                max={5.0}
                step={0.1}
                onChange={(v) => updateSetting('quality_codec_h265', v)}
                hint={`Needs ${formatEffectiveThreshold(settings[`quality_video_${selectedTier}_high` as keyof SettingsState] as number, settings.quality_codec_h265)} for ${RESOLUTION_TABS.find(t => t.id === selectedTier)?.label} HIGH`}
              />
              <NumberInput
                label="AV1"
                value={settings.quality_codec_av1}
                min={0.5}
                max={5.0}
                step={0.1}
                onChange={(v) => updateSetting('quality_codec_av1', v)}
                hint={`Needs ${formatEffectiveThreshold(settings[`quality_video_${selectedTier}_high` as keyof SettingsState] as number, settings.quality_codec_av1)} for ${RESOLUTION_TABS.find(t => t.id === selectedTier)?.label} HIGH`}
              />
              <NumberInput
                label="VP9"
                value={settings.quality_codec_vp9}
                min={0.5}
                max={5.0}
                step={0.1}
                onChange={(v) => updateSetting('quality_codec_vp9', v)}
                hint={`Needs ${formatEffectiveThreshold(settings[`quality_video_${selectedTier}_high` as keyof SettingsState] as number, settings.quality_codec_vp9)} for ${RESOLUTION_TABS.find(t => t.id === selectedTier)?.label} HIGH`}
              />
            </div>

            <p className="text-[10px] text-muted-foreground italic mt-3">
              Most users won't need to change these. Adjust if your HEVC or AV1 files are scoring
              higher or lower than they look — lower the value if scores seem too generous, raise it
              if scores seem too harsh.
            </p>
          </div>

        </div>
      </SettingsCard>

      {/* Music Quality Card */}
      <SettingsCard
        title="Music Quality"
        description="Bitrate thresholds for music files"
        icon={<Music className="w-7 h-7" />}
        expanded={expandedCards.has('music')}
        onToggle={() => toggleCard('music')}
      >
        <div className="space-y-4">
          <p className="text-xs text-muted-foreground">
            Set bitrate thresholds for lossy music quality tiers and hi-res detection.
          </p>

          <QualityThreshold
            label="Lossy Audio"
            mediumValue={settings.quality_music_low_bitrate}
            highValue={settings.quality_music_high_bitrate}
            min={64}
            max={320}
            step={8}
            unit="kbps"
            lowLabel="LOSSY_LOW"
            mediumLabel="LOSSY_MID"
            highLabel="LOSSY_HIGH"
            onChange={(medium, high) => {
              updateSetting('quality_music_low_bitrate', medium)
              updateSetting('quality_music_high_bitrate', high)
            }}
          />

          <div className="grid grid-cols-2 gap-4">
            <NumberInput
              label="Hi-Res Sample Rate Threshold (Hz)"
              value={settings.quality_music_hires_samplerate}
              min={44100}
              max={192000}
              step={100}
              onChange={(v) => updateSetting('quality_music_hires_samplerate', v)}
              hint="Above this = Hi-Res"
            />
            <NumberInput
              label="Hi-Res Bit Depth Threshold"
              value={settings.quality_music_hires_bitdepth}
              min={16}
              max={32}
              onChange={(v) => updateSetting('quality_music_hires_bitdepth', v)}
              hint="Above this = Hi-Res"
            />
          </div>
        </div>
      </SettingsCard>

      <SettingsCard
        title="FFmpeg encoding guidance"
        description="Totality uses FFmpeg for hardware HEVC and SVT-AV1 transcoding. Audio remains stream-copied. HDR metadata is retained only when the selected encoder and source format support it."
        icon={<Clapperboard className="w-7 h-7" />}
        expanded={expandedCards.has('ffmpeg')}
        onToggle={() => toggleCard('ffmpeg')}
      >
        <p className="text-xs text-muted-foreground">Use HEVC NVENC or Quick Sync for fast HDR-compatible output. Use SVT-AV1 when software encoding time is acceptable and the playback client supports AV1. Totality verifies the produced streams before activation.</p>
      </SettingsCard>

      {/* Footer */}
      <div className="flex items-center justify-end gap-2 pt-3">
        <button
          onClick={handleReset}
          disabled={isSaving}
          className="flex items-center gap-2 px-3 py-1.5 text-xs bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors disabled:opacity-50"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          Reset to Defaults
        </button>
        {hasChanges && (
          <button
            onClick={handleSave}
            disabled={isSaving}
            className="flex items-center gap-2 px-3 py-1.5 text-xs bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            {isSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
            {isSaving ? 'Saving...' : 'Save Changes'}
          </button>
        )}
      </div>
    </div>
  )
}

// Quality threshold component with visual LOW/MEDIUM/HIGH zones
function QualityThreshold({
  label,
  mediumValue,
  highValue,
  min,
  max,
  step,
  unit,
  displayDivisor = 1,
  lowLabel = 'LOW',
  mediumLabel = 'MEDIUM',
  highLabel = 'HIGH',
  onChange,
}: {
  label: string
  mediumValue: number
  highValue: number
  min: number
  max: number
  step: number
  unit: string
  displayDivisor?: number
  lowLabel?: string
  mediumLabel?: string
  highLabel?: string
  onChange: (medium: number, high: number) => void
}) {
  const formatValue = (value: number) => {
    const displayed = value / displayDivisor
    return displayDivisor > 1 ? displayed.toFixed(1) : displayed.toLocaleString()
  }
  const trackRef = useRef<HTMLDivElement>(null)
  const [dragging, setDragging] = useState<'medium' | 'high' | null>(null)

  const getPercent = (value: number) => ((value - min) / (max - min)) * 100

  const getValueFromPosition = useCallback((clientX: number) => {
    if (!trackRef.current) return min
    const rect = trackRef.current.getBoundingClientRect()
    const percent = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
    const rawValue = min + percent * (max - min)
    return Math.round(rawValue / step) * step
  }, [min, max, step])

  const handleMouseDown = (handle: 'medium' | 'high') => (e: React.MouseEvent) => {
    e.preventDefault()
    setDragging(handle)
  }

  useEffect(() => {
    if (!dragging) return

    const handleMouseMove = (e: MouseEvent) => {
      const newValue = getValueFromPosition(e.clientX)
      if (dragging === 'medium') {
        onChange(Math.min(newValue, highValue - step), highValue)
      } else {
        onChange(mediumValue, Math.max(newValue, mediumValue + step))
      }
    }

    const handleMouseUp = () => setDragging(null)

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [dragging, mediumValue, highValue, step, onChange, getValueFromPosition])

  const mediumPercent = getPercent(mediumValue)
  const highPercent = getPercent(highValue)

  return (
    <div className="bg-background/50 rounded-lg p-3 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium">{label}</span>
      </div>

      <div className="relative h-4">
        <div
          ref={trackRef}
          className="absolute top-1/2 -translate-y-1/2 left-0 right-0 h-1.5 rounded-full cursor-pointer overflow-hidden"
          onClick={(e) => {
            const value = getValueFromPosition(e.clientX)
            const distToMedium = Math.abs(value - mediumValue)
            const distToHigh = Math.abs(value - highValue)
            if (distToMedium < distToHigh) {
              onChange(Math.min(value, highValue - step), highValue)
            } else {
              onChange(mediumValue, Math.max(value, mediumValue + step))
            }
          }}
        >
          <div className="absolute h-full bg-accent/20" style={{ left: 0, width: `${mediumPercent}%` }} />
          <div className="absolute h-full bg-accent/40" style={{ left: `${mediumPercent}%`, width: `${highPercent - mediumPercent}%` }} />
          <div className="absolute h-full bg-accent/70" style={{ left: `${highPercent}%`, width: `${100 - highPercent}%` }} />
        </div>

        <div
          role="slider"
          tabIndex={0}
          aria-label={`${label} ${mediumLabel} threshold`}
          aria-valuemin={min}
          aria-valuemax={highValue - step}
          aria-valuenow={mediumValue}
          className={`absolute top-1/2 -translate-y-1/2 w-3 h-3 bg-white rounded-full cursor-grab shadow-md border-2 border-background z-10 ${dragging === 'medium' ? 'cursor-grabbing scale-110' : 'hover:scale-110'} transition-transform`}
          style={{ left: `${mediumPercent}%`, marginLeft: '-6px' }}
          onMouseDown={handleMouseDown('medium')}
        />

        <div
          role="slider"
          tabIndex={0}
          aria-label={`${label} ${highLabel} threshold`}
          aria-valuemin={mediumValue + step}
          aria-valuemax={max}
          aria-valuenow={highValue}
          className={`absolute top-1/2 -translate-y-1/2 w-3 h-3 bg-white rounded-full cursor-grab shadow-md border-2 border-background z-10 ${dragging === 'high' ? 'cursor-grabbing scale-110' : 'hover:scale-110'} transition-transform`}
          style={{ left: `${highPercent}%`, marginLeft: '-6px' }}
          onMouseDown={handleMouseDown('high')}
        />
      </div>

      <div className="flex text-[10px] font-medium">
        <div className="text-accent/40" style={{ width: `${mediumPercent}%` }}>{lowLabel}</div>
        <div className="text-accent/60 text-center" style={{ width: `${highPercent - mediumPercent}%` }}>{mediumLabel}</div>
        <div className="text-accent text-right flex-1">{highLabel}</div>
      </div>

      <div className="flex justify-between text-[10px] text-muted-foreground">
        <span>{formatValue(min)} {unit}</span>
        <span className="text-accent/60">{formatValue(mediumValue)}</span>
        <span className="text-accent">{formatValue(highValue)}</span>
        <span>{formatValue(max)} {unit}</span>
      </div>
    </div>
  )
}

// Number input component
function NumberInput({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
  hint,
}: {
  label: string
  value: number
  min: number
  max: number
  step?: number
  onChange: (value: number) => void
  hint?: string
}) {
  const inputId = useId()
  const hintId = useId()

  return (
    <div className="space-y-1">
      <label htmlFor={inputId} className="block text-xs text-muted-foreground">{label}</label>
      <input
        id={inputId}
        type="number"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => {
          const v = parseFloat(e.target.value)
          if (!isNaN(v) && v >= min && v <= max) {
            onChange(v)
          }
        }}
        aria-describedby={hint ? hintId : undefined}
        className="w-full px-3 py-1.5 bg-background border border-border/30 rounded-md text-sm text-foreground focus:outline-hidden focus:ring-2 focus:ring-primary"
      />
      {hint && <p id={hintId} className="text-[10px] text-muted-foreground">{hint}</p>}
    </div>
  )
}
