import { memo } from 'react'
import type { GpuInfo, TranscodeOptions } from './types'

interface EncoderPolicySelectorProps {
  value: TranscodeOptions['encoderPolicy'] | ''
  hardwareAvailable: boolean
  softwareAvailable: boolean
  hardwareGpus: readonly GpuInfo[]
  gpuId: string
  onGpuChange: (gpuId: string) => void
  onChange: (policy: TranscodeOptions['encoderPolicy'] | undefined) => void
  disabled?: boolean
}

export const EncoderPolicySelector = memo(function EncoderPolicySelector({ value, hardwareAvailable, softwareAvailable, hardwareGpus, gpuId, onChange, onGpuChange, disabled = false }: EncoderPolicySelectorProps) {
  return (
    <label className="block space-y-1.5">
      <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Encoder policy</span>
      <select
        aria-label="Encoder policy"
        value={value}
        onChange={event => onChange(event.target.value ? event.target.value as NonNullable<TranscodeOptions['encoderPolicy']> : undefined)}
        disabled={disabled}
        className="w-full rounded-xl border border-border/40 bg-muted/40 px-3 py-2 text-xs font-bold"
      >
        <option value="automatic">Automatic · benchmark all verified GPUs</option>
        <option value="hardware" disabled={!hardwareAvailable}>Verified hardware</option>
        <option value="software" disabled={!softwareAvailable}>Software</option>
        <option value="compare" disabled={!hardwareAvailable || !softwareAvailable}>Compare hardware and software</option>
      </select>
      {value === 'automatic' && hardwareGpus.length > 0 && (
        <p className="text-xs text-muted-foreground">Benchmarks: {hardwareGpus.map(gpu => gpu.name).join(' · ')}</p>
      )}
      {value === 'hardware' && (
        <select
          aria-label="Hardware GPU"
          value={gpuId}
          onChange={event => onGpuChange(event.target.value)}
          disabled={disabled || hardwareGpus.length === 0}
          className="w-full rounded-xl border border-border/40 bg-muted/40 px-3 py-2 text-xs font-bold"
        >
          <option value="" disabled>Select a verified GPU</option>
          {hardwareGpus.map(gpu => <option key={gpu.id} value={gpu.id}>{gpu.name}</option>)}
        </select>
      )}
    </label>
  )
})
