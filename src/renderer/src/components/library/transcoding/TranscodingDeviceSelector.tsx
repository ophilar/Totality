import { memo } from 'react'
import { Cpu, Zap } from 'lucide-react'
import type { GpuInfo } from './types'

export interface TranscodingDeviceSelectorProps {
  useGpu: boolean
  onUseGpuChange: (useGpu: boolean) => void
  selectedGpuId: string
  onSelectedGpuIdChange: (gpuId: string) => void
  gpus: GpuInfo[]
  variant?: 'compact' | 'expanded'
  className?: string
}

/**
 * Consolidated canonical UI component for selecting transcoding hardware & device.
 * Used across TranscodeModal (QuickPresetsTab, AdvancedTab), ShowTranscodeModal, and Optimization views.
 */
export const TranscodingDeviceSelector = memo(function TranscodingDeviceSelector({
  useGpu,
  onUseGpuChange,
  selectedGpuId,
  onSelectedGpuIdChange,
  gpus,
  variant = 'compact',
  className = ''
}: TranscodingDeviceSelectorProps) {
  const selectedGpu = gpus.find(g => g.id === selectedGpuId) || gpus[0]
  const hasHardwareGpu = gpus.length > 0

  const handleDeviceChange = (gpuId: string) => {
    onSelectedGpuIdChange(gpuId)
    if (typeof window !== 'undefined' && window.electronAPI?.setSelectedGpu) {
      void window.electronAPI.setSelectedGpu(gpuId)
    }
  }

  if (variant === 'compact') {
    return (
      <div className={`space-y-2 ${className}`}>
        <div className="flex items-center justify-between">
          <label className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
            <Cpu className="w-3.5 h-3.5 text-primary" />
            Transcoding Device
          </label>
          {useGpu && selectedGpu && (
            <span className="text-[10px] bg-primary/15 text-primary font-bold px-2 py-0.5 rounded-full border border-primary/20 flex items-center gap-1">
              <Zap className="w-2.5 h-2.5 fill-current" />
              {selectedGpu.vendor} Hardware VRAM
            </span>
          )}
        </div>

        <div className="p-2.5 bg-muted/30 border border-border/40 rounded-xl space-y-2.5">
          <label className="flex items-center justify-between cursor-pointer">
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={useGpu}
                onChange={(e) => onUseGpuChange(e.target.checked)}
                disabled={!hasHardwareGpu}
                className="w-4 h-4 rounded border-border text-primary focus:ring-primary/20 cursor-pointer disabled:opacity-50"
              />
              <div>
                <span className="text-xs font-semibold block">Enable GPU VRAM Engine</span>
                <span className="text-[10px] text-muted-foreground">Zero-copy hardware acceleration (NVENC / QSV)</span>
              </div>
            </div>
          </label>

          {useGpu && hasHardwareGpu && (
            <div className="pt-2 border-t border-border/20 space-y-1 animate-in fade-in duration-200">
              <select
                value={selectedGpuId || selectedGpu?.id || ''}
                onChange={(e) => handleDeviceChange(e.target.value)}
                className="w-full bg-background/80 border border-border/50 rounded-lg px-2.5 py-1.5 text-xs font-medium focus:ring-1 focus:ring-primary focus:outline-none cursor-pointer"
              >
                {gpus.map((gpu) => (
                  <option key={gpu.id} value={gpu.id}>
                    {gpu.name} ({gpu.vendor})
                  </option>
                ))}
              </select>
            </div>
          )}

          {!useGpu && (
            <div className="text-[11px] text-muted-foreground/90 bg-muted/50 rounded-lg p-2 flex items-center gap-1.5 border border-border/30">
              <Cpu className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
              <span>Software CPU Encoder (libx265 / svt_av1) active.</span>
            </div>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className={`space-y-3 p-4 bg-muted/20 border border-border/40 rounded-2xl ${className}`}>
      <label className="flex items-center justify-between cursor-pointer">
        <div className="flex items-center gap-2.5">
          <Cpu className="w-4 h-4 text-primary" />
          <div>
            <span className="text-sm font-semibold block">Enable GPU Acceleration (Hardware VRAM Pipeline)</span>
            <span className="text-xs text-muted-foreground">High-throughput hardware encoding with zero host memory copies</span>
          </div>
        </div>
        <input
          type="checkbox"
          checked={useGpu}
          onChange={(e) => onUseGpuChange(e.target.checked)}
          disabled={!hasHardwareGpu}
          className="w-4 h-4 rounded border-border text-primary focus:ring-primary/20 cursor-pointer disabled:opacity-50"
        />
      </label>

      {useGpu && hasHardwareGpu && (
        <div className="pt-3 border-t border-border/20 space-y-3 animate-in fade-in duration-200">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Vendor Architecture</label>
              <div className="w-full bg-muted/60 border border-border/50 rounded-xl p-2 text-xs font-semibold text-foreground/90 flex items-center justify-between">
                <span>{selectedGpu?.vendor || 'NVIDIA'}</span>
                <span className="text-[10px] uppercase font-bold text-primary px-1.5 py-0.5 rounded bg-primary/10">Verified</span>
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Active GPU Device</label>
              <select
                value={selectedGpuId || selectedGpu?.id || ''}
                onChange={(e) => handleDeviceChange(e.target.value)}
                className="w-full bg-background border border-border/50 rounded-xl p-2 text-xs font-medium focus:ring-1 focus:ring-primary focus:outline-none cursor-pointer"
              >
                {gpus.map((gpu) => (
                  <option key={gpu.id} value={gpu.id}>
                    {gpu.name} ({gpu.vendor})
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
      )}

      {!useGpu && (
        <div className="text-xs text-muted-foreground bg-muted/40 rounded-xl p-2.5 flex items-center gap-2 border border-border/30">
          <Cpu className="w-4 h-4 text-muted-foreground shrink-0" />
          <span>Using Host CPU Software Encoder. Frame rates will be slower than hardware encoding.</span>
        </div>
      )}
    </div>
  )
})
