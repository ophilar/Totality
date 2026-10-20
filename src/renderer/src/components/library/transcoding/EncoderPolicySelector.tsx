import { memo } from 'react'
import type { TranscodeOptions } from './types'

interface EncoderPolicySelectorProps {
  value: TranscodeOptions['encoderPolicy'] | ''
  hardwareAvailable: boolean
  onChange: (policy: TranscodeOptions['encoderPolicy'] | undefined) => void
}

export const EncoderPolicySelector = memo(function EncoderPolicySelector({ value, hardwareAvailable, onChange }: EncoderPolicySelectorProps) {
  return (
    <label className="block space-y-1.5">
      <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Encoder policy</span>
      <select
        aria-label="Encoder policy"
        value={value}
        onChange={event => onChange(event.target.value ? event.target.value as NonNullable<TranscodeOptions['encoderPolicy']> : undefined)}
        className="w-full rounded-xl border border-border/40 bg-muted/40 px-3 py-2 text-xs font-bold"
      >
        <option value="">Select encoder policy</option>
        <option value="hardware" disabled={!hardwareAvailable}>Verified hardware</option>
        <option value="software">Software</option>
        <option value="compare" disabled={!hardwareAvailable}>Compare hardware and software</option>
      </select>
    </label>
  )
})
