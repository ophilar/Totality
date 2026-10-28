import {
  Zap,
  Sparkles,
  Copy,
  AlertTriangle,
  Settings,
  ShieldCheck,
  TrendingDown
} from 'lucide-react'
import { useToast } from '@/contexts/ToastContext'
import type { TranscodeOptions, TranscodingParams } from './types'

export interface QuickPresetsTabProps {
  options: TranscodeOptions
  setOptions: React.Dispatch<React.SetStateAction<TranscodeOptions>>
  params: TranscodingParams | null
  supportedTargetCodecs: Array<NonNullable<TranscodeOptions['targetCodec']>>
}

interface PresetProfile {
  qualityProfile: NonNullable<TranscodeOptions['qualityProfile']>
  name: string
  badge: string
  description: string
  icon: typeof Zap
  highlight?: boolean
}

const PRESET_PROFILES: PresetProfile[] = [
  {
    qualityProfile: 'transparent',
    name: 'Higher fidelity',
    badge: 'Highest Quality',
    description: 'Highest quality gate. Parameters are selected from measured samples for this source.',
    icon: ShieldCheck
  },
  {
    qualityProfile: 'balanced',
    name: 'Balanced',
    badge: 'Recommended',
    description: 'Balanced quality and savings gate. No savings claim is shown until a sample is measured.',
    icon: Zap,
    highlight: true
  },
  {
    qualityProfile: 'maximum_savings',
    name: 'Smaller file',
    badge: 'Max Savings',
    description: 'Maximum savings gate subject to measured VMAF and banding limits.',
    icon: TrendingDown
  }
]

export function QuickPresetsTab({
  options,
  setOptions,
  params,
  supportedTargetCodecs,
}: QuickPresetsTabProps) {
  const { addToast } = useToast()

  const applyProfile = (profile: PresetProfile) => {
    setOptions(prev => ({
      ...prev,
      qualityProfile: profile.qualityProfile,
      crf: undefined,
      preset: '',
      encoder: ''
    }))

    addToast({ title: `Applied profile: ${profile.name}`, type: 'info' })
  }

  const copyCommand = () => {
    if (!params) return
    const cmd = `ffmpeg ${(params.ffmpegArgs || []).join(' ')}`
    navigator.clipboard.writeText(cmd)
    addToast({ title: 'FFmpeg command copied to clipboard', type: 'success' })
  }

  return (
    <div className="space-y-6">
      {/* 3 Main Preset Cards */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground/80 flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5 text-primary" />
            Curated Archival Profiles
          </span>
          <span className="text-[11px] text-muted-foreground">Select a baseline optimization profile</span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5" role="radiogroup" aria-label="Quality preference">
          {PRESET_PROFILES.map((profile) => {
            const Icon = profile.icon
            const isSelected = options.qualityProfile === profile.qualityProfile

            return (
              <label
                key={profile.qualityProfile}
                className={`relative flex flex-col justify-between p-4 rounded-2xl border transition-all cursor-pointer select-none focus-within:ring-2 focus-within:ring-primary ${
                  isSelected
                    ? 'bg-primary/10 border-primary shadow-lg shadow-primary/10 ring-1 ring-primary'
                    : 'bg-muted/30 border-border/40 hover:bg-muted/50 hover:border-border'
                }`}
              >
                <input
                  type="radio"
                  name="optimization-quality-profile"
                  value={profile.qualityProfile}
                  checked={isSelected}
                  onChange={() => applyProfile(profile)}
                  className="sr-only"
                />
                {/* Header Badge */}
                <div className="flex items-center justify-between mb-3">
                  <span className={`text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full ${
                    profile.highlight
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted text-muted-foreground border border-border/50'
                  }`}>
                    {profile.badge}
                  </span>
                  <span aria-hidden="true" className={`h-4 w-4 rounded-full border-2 ${isSelected ? 'border-primary bg-primary ring-2 ring-primary/30' : 'border-muted-foreground/60'}`} />
                </div>

                {/* Profile Info */}
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <div className={`p-2 rounded-xl ${
                      isSelected ? 'bg-primary/20 text-primary' : 'bg-muted text-muted-foreground'
                    }`}>
                      <Icon className="w-4 h-4" />
                    </div>
                    <h4 className="text-sm font-bold leading-tight">{profile.name}</h4>
                  </div>

                  <p className="text-xs text-muted-foreground leading-relaxed pt-1">
                    {profile.description}
                  </p>
                </div>

                <div className="mt-4 pt-3 border-t border-border/20 text-[11px] text-muted-foreground/70">
                  Measured per source and selected encoder
                </div>
              </label>
            )
          })}
        </div>
      </div>

      {/* Quick Config Bar */}
      <div className="bg-muted/20 border border-border/40 rounded-2xl p-4 space-y-4">
        <div className="flex items-center justify-between">
          <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground/80 flex items-center gap-2">
            <Settings className="w-3.5 h-3.5 text-primary" />
            Quick Hardware & Codec Controls
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Target Codec */}
          <div className="space-y-1.5">
            <label className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">Target Codec</label>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={!supportedTargetCodecs.includes('av1')}
                onClick={() => setOptions(prev => ({ ...prev, targetCodec: 'av1' }))}
                className={`flex-1 py-2 px-3 rounded-xl border text-xs font-bold transition-all ${
                  options.targetCodec === 'av1'
                    ? 'bg-primary/15 border-primary text-primary'
                    : 'bg-muted/40 border-border/40 text-muted-foreground hover:text-foreground'
                }`}
              >
                AV1{!supportedTargetCodecs.includes('av1') ? ' (unavailable)' : ''}
              </button>
              <button
                type="button"
                disabled={!supportedTargetCodecs.includes('hevc')}
                onClick={() => setOptions(prev => ({ ...prev, targetCodec: 'hevc' }))}
                className={`flex-1 py-2 px-3 rounded-xl border text-xs font-bold transition-all ${
                  options.targetCodec === 'hevc'
                    ? 'bg-primary/15 border-primary text-primary'
                    : 'bg-muted/40 border-border/40 text-muted-foreground hover:text-foreground'
                }`}
              >
                HEVC{!supportedTargetCodecs.includes('hevc') ? ' (unavailable)' : ''}
              </button>
            </div>
            {supportedTargetCodecs.length === 0 && <p role="status" className="text-xs text-amber-300">No compatible HEVC or AV1 encoder is available for the selected playback target.</p>}
            {!options.targetCodec && supportedTargetCodecs.length > 0 && <p role="status" className="text-xs text-amber-300">Choose an output codec to continue.</p>}
          </div>

        </div>
      </div>

      {/* Generated Strategy Preview Card */}
      {params && (
        <div className="bg-primary/5 border border-primary/20 rounded-2xl p-4 space-y-3 animate-in fade-in duration-300">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-primary uppercase tracking-wider flex items-center gap-1.5">
              <Zap className="w-3.5 h-3.5" />
              Active Strategy Preview
            </span>
            {params.expectedSizeReduction && (
              <span className="bg-green-500/15 text-green-400 text-[10px] font-black px-2 py-0.5 rounded-full">
                ~{params.expectedSizeReduction} SAVINGS
              </span>
            )}
          </div>
          <p className="text-xs text-foreground/90 leading-relaxed font-medium">
            {params.summary}
          </p>

          {params.warnings && params.warnings.length > 0 && (
            <div className="space-y-1">
              {params.warnings.map((w, i) => (
                <div key={i} className="flex items-center gap-1.5 text-[11px] text-amber-400 font-medium">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                  <span>{w}</span>
                </div>
              ))}
            </div>
          )}

          <div className="flex justify-end pt-1">
            <button
              onClick={copyCommand}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-muted/60 hover:bg-muted text-xs font-bold text-muted-foreground hover:text-foreground rounded-xl border border-border/40 transition-all"
            >
              <Copy className="w-3.5 h-3.5" />
              Copy CLI Command
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
