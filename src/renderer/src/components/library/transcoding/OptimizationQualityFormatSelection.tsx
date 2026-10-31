import type { TranscodeOptions } from './types'
import { OPTIMIZATION_VIDEO_FORMATS } from './optimizationOptions'
import { OPTIMIZATION_CHOICE_ACCENTS } from './optimizationChoiceAccents'
import { HardDrive, Eye, Scale, Layers } from 'lucide-react'

type QualityProfile = NonNullable<TranscodeOptions['qualityProfile']>
type VideoCodec = NonNullable<TranscodeOptions['targetCodec']>

const QUALITY_PROFILES: ReadonlyArray<{ value: QualityProfile; label: string; description: string }> = [
  { value: 'transparent', label: 'Higher fidelity', description: 'Keep more detail; use more space.' },
  { value: 'balanced', label: 'Balanced', description: 'Balance picture detail and file size.' },
  { value: 'maximum_savings', label: 'Smaller file', description: 'Save more space; lose some detail.' },
]

export function OptimizationQualityFormatSelection({
  qualityProfile,
  targetCodec,
  supportedTargetCodecs,
  unsupportedReasons = {},
  videoRequired,
  disabled = false,
  onQualityProfileChange,
  onTargetCodecChange,
}: {
  qualityProfile: QualityProfile | ''
  targetCodec: VideoCodec | ''
  supportedTargetCodecs: readonly VideoCodec[]
  unsupportedReasons?: Partial<Record<VideoCodec, string>>
  videoRequired: boolean
  disabled?: boolean
  onQualityProfileChange: (value: QualityProfile | '') => void
  onTargetCodecChange: (value: VideoCodec | '') => void
}) {
  if (!videoRequired) return null

  return <section aria-label="Output settings" className="space-y-4">
    <fieldset className="space-y-2">
      <legend className="text-sm font-semibold">Quality</legend>
      <div role="radiogroup" aria-label="Quality" className="grid gap-2 sm:grid-cols-3">
        {QUALITY_PROFILES.map(profile => {
          const icon = profile.value === 'transparent' ? Eye : profile.value === 'balanced' ? Scale : HardDrive
          const accent = profile.value === 'transparent' ? 'preserve' : profile.value === 'balanced' ? 'recommended' : 'compress'
          const Icon = icon
          return <label key={profile.value} className={`flex min-h-20 cursor-pointer items-start gap-2 rounded-lg border px-3 py-2 text-sm font-medium focus-within:ring-2 focus-within:ring-primary ${qualityProfile === profile.value ? 'border-primary bg-muted/40' : 'border-border/60 bg-card hover:bg-muted/30'} ${disabled ? 'cursor-not-allowed' : ''}`}>
          <input type="radio" name="optimization-quality" value={profile.value} checked={qualityProfile === profile.value} disabled={disabled} onChange={() => onQualityProfileChange(profile.value)} className="sr-only" />
          <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${OPTIMIZATION_CHOICE_ACCENTS[accent]}`} aria-hidden="true" />
          <span className="min-w-0 flex-1"><span className="flex items-center justify-between gap-2">{profile.label}{qualityProfile === profile.value && <span className="text-primary" aria-hidden="true">✓</span>}</span><span className="mt-1 block text-xs font-normal text-muted-foreground">{profile.description}</span></span>
        </label>})}
      </div>
    </fieldset>
    <fieldset className="space-y-2">
      <legend className="text-sm font-semibold">Video format</legend>
      <div role="radiogroup" aria-label="Video format" className="grid gap-2 sm:grid-cols-2">
        {OPTIMIZATION_VIDEO_FORMATS.map(format => {
          const selected = targetCodec === format.value
          const accent = format.value === 'hevc' ? 'recommended' : 'compress'
          return <label key={format.value} className={`flex min-h-12 items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium focus-within:ring-2 focus-within:ring-primary ${selected ? 'border-primary bg-muted/40' : 'border-border/60 bg-card hover:bg-muted/30'} ${disabled || !supportedTargetCodecs.includes(format.value) ? 'cursor-not-allowed' : 'cursor-pointer'}`}>
          <input type="radio" name="optimization-video-format" value={format.value} checked={selected} disabled={disabled || !supportedTargetCodecs.includes(format.value)} onChange={() => onTargetCodecChange(format.value)} className="sr-only" />
          <Layers className={`h-4 w-4 shrink-0 ${OPTIMIZATION_CHOICE_ACCENTS[accent]}`} aria-hidden="true" />
          <span className="min-w-0 flex-1"><span className="flex items-center justify-between gap-2">{format.label}{!supportedTargetCodecs.includes(format.value) ? ' (unavailable)' : ''}{selected && <span className="text-primary" aria-hidden="true">✓</span>}</span><span className="mt-1 block text-xs font-normal text-muted-foreground">{supportedTargetCodecs.includes(format.value) ? format.value === 'hevc' ? 'Smaller files with broad device support.' : 'Smaller files; newer devices may be needed.' : unsupportedReasons[format.value] ?? 'No compatible encoder is available.'}</span></span>
        </label>})}
      </div>
      {supportedTargetCodecs.length === 0 && <span role="status" className="block font-normal text-amber-300">No compatible video format is available for this target.</span>}
    </fieldset>
  </section>
}
