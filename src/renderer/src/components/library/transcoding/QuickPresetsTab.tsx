import { useState } from 'react'
import { 
  Zap, 
  Check, 
  Sparkles, 
  Copy, 
  AlertTriangle, 
  Settings,
  ShieldCheck,
  TrendingDown
} from 'lucide-react'
import { useToast } from '@/contexts/ToastContext'
import type { TranscodeOptions, TranscodingParams, GpuInfo } from './types'
import { TranscodingDeviceSelector } from './TranscodingDeviceSelector'

export interface QuickPresetsTabProps {
  options: TranscodeOptions
  setOptions: React.Dispatch<React.SetStateAction<TranscodeOptions>>
  params: TranscodingParams | null
  gpus: GpuInfo[]
}

interface PresetProfile {
  id: string
  name: string
  badge: string
  crf: number
  nvencPreset: string
  cpuPreset: string
  reductionBadge: string
  footprint: string
  description: string
  icon: typeof Zap
  highlight?: boolean
}

const PRESET_PROFILES: PresetProfile[] = [
  {
    id: 'lossless',
    name: 'Lossless Archival',
    badge: 'Highest Quality',
    crf: 16,
    nvencPreset: 'p7',
    cpuPreset: 'slow',
    reductionBadge: '~15-25% Reduction',
    footprint: '~45 MB/min',
    description: 'Maximum fidelity master archival. Preserves 10-bit depth, HDR10+, and original film grain.',
    icon: ShieldCheck
  },
  {
    id: 'balanced',
    name: 'Balanced Smooth HQ',
    badge: 'Recommended',
    crf: 20,
    nvencPreset: 'p6',
    cpuPreset: 'medium',
    reductionBadge: '~40-50% Reduction',
    footprint: '~25 MB/min',
    description: 'Optimal balance of visually transparent encoding, smooth anti-stutter passthrough, and space efficiency.',
    icon: Zap,
    highlight: true
  },
  {
    id: 'efficiency',
    name: 'High Efficiency Space Saver',
    badge: 'Max Savings',
    crf: 25,
    nvencPreset: 'p5',
    cpuPreset: 'fast',
    reductionBadge: '~65-75% Reduction',
    footprint: '~12 MB/min',
    description: 'High compression ratio engineered to minimize storage footprint for streaming and massive libraries.',
    icon: TrendingDown
  }
]

export function QuickPresetsTab({
  options,
  setOptions,
  params,
  gpus
}: QuickPresetsTabProps) {
  const { addToast } = useToast()
  const [selectedProfileId, setSelectedProfileId] = useState<string>('balanced')

  const applyProfile = (profile: PresetProfile) => {
    setSelectedProfileId(profile.id)
    const selectedGpu = gpus.find(gpu => gpu.id === options.gpuId) ?? gpus[0]
    const isNvidia = selectedGpu?.vendor === 'NVIDIA'
    const preset = isNvidia ? profile.nvencPreset : profile.cpuPreset
    
    setOptions(prev => ({
      ...prev,
      crf: profile.crf,
      preset: preset,
      encoder: isNvidia ? (prev.targetCodec === 'av1' ? 'nvenc_av1' : 'nvenc_h265') : ''
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

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5">
          {PRESET_PROFILES.map((profile) => {
            const Icon = profile.icon
            const isSelected = selectedProfileId === profile.id

            return (
              <div
                key={profile.id}
                onClick={() => applyProfile(profile)}
                className={`relative flex flex-col justify-between p-4 rounded-2xl border transition-all cursor-pointer select-none ${
                  isSelected
                    ? 'bg-primary/10 border-primary shadow-lg shadow-primary/10 ring-1 ring-primary'
                    : 'bg-muted/30 border-border/40 hover:bg-muted/50 hover:border-border'
                }`}
              >
                {/* Header Badge */}
                <div className="flex items-center justify-between mb-3">
                  <span className={`text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full ${
                    profile.highlight 
                      ? 'bg-primary text-primary-foreground' 
                      : 'bg-muted text-muted-foreground border border-border/50'
                  }`}>
                    {profile.badge}
                  </span>
                  {isSelected && (
                    <div className="w-5 h-5 rounded-full bg-primary text-primary-foreground flex items-center justify-center">
                      <Check className="w-3 h-3 stroke-[3]" />
                    </div>
                  )}
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

                {/* Metrics Footer */}
                <div className="mt-4 pt-3 border-t border-border/20 space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-bold text-green-400">{profile.reductionBadge}</span>
                    <span className="text-[11px] font-mono text-muted-foreground">{profile.footprint}</span>
                  </div>
                  <div className="flex items-center justify-between text-[11px] text-muted-foreground/70">
                    <span>Quality Target: CQ {profile.crf}</span>
                    <span>Preset: {profile.nvencPreset.toUpperCase()}</span>
                  </div>
                </div>
              </div>
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
                onClick={() => setOptions(prev => ({ ...prev, targetCodec: 'av1' }))}
                className={`flex-1 py-2 px-3 rounded-xl border text-xs font-bold transition-all ${
                  options.targetCodec === 'av1'
                    ? 'bg-primary/15 border-primary text-primary'
                    : 'bg-muted/40 border-border/40 text-muted-foreground hover:text-foreground'
                }`}
              >
                AV1 (Next-Gen)
              </button>
              <button
                type="button"
                onClick={() => setOptions(prev => ({ ...prev, targetCodec: 'hevc' }))}
                className={`flex-1 py-2 px-3 rounded-xl border text-xs font-bold transition-all ${
                  options.targetCodec === 'hevc'
                    ? 'bg-primary/15 border-primary text-primary'
                    : 'bg-muted/40 border-border/40 text-muted-foreground hover:text-foreground'
                }`}
              >
                HEVC (H.265)
              </button>
            </div>
          </div>

          {/* Canonical Transcoding Device Selector */}
          <TranscodingDeviceSelector
            useGpu={options.useGpu}
            onUseGpuChange={(useGpu) => setOptions(prev => ({ ...prev, useGpu }))}
            selectedGpuId={options.gpuId}
            onSelectedGpuIdChange={(gpuId) => setOptions(prev => ({ ...prev, gpuId, useGpu: Boolean(gpuId) }))}
            gpus={gpus}
            variant="compact"
          />
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
