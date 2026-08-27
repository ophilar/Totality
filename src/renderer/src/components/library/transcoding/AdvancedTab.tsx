import { useState, useEffect } from 'react'
import { 
  Sliders, 
  Settings2, 
  Bookmark, 
  Save, 
  Trash2, 
  Copy, 
  Layers,
  Sparkles
} from 'lucide-react'
import { useToast } from '@/contexts/ToastContext'
import type { TranscodeOptions, TranscodingParams, GpuInfo, Availability, PresetTemplate } from './types'
import { TranscodingDeviceSelector } from './TranscodingDeviceSelector'

export interface AdvancedTabProps {
  options: TranscodeOptions
  setOptions: React.Dispatch<React.SetStateAction<TranscodeOptions>>
  params: TranscodingParams | null
  gpus: GpuInfo[]
  availability: Availability | null
}

const TEMPLATES_STORAGE_KEY = 'totality_transcode_templates'

export function AdvancedTab({
  options,
  setOptions,
  params,
  gpus,
  availability
}: AdvancedTabProps) {
  const { addToast } = useToast()
  const [templates, setTemplates] = useState<PresetTemplate[]>([])
  const [selectedTemplateName, setSelectedTemplateName] = useState<string>('')
  const [newTemplateName, setNewTemplateName] = useState<string>('')
  const [showSaveInput, setShowSaveInput] = useState(false)

  // Load saved templates from localStorage
  useEffect(() => {
    try {
      const stored = localStorage.getItem(TEMPLATES_STORAGE_KEY)
      if (stored) {
        queueMicrotask(() => { setTemplates(JSON.parse(stored)) })
      }
    } catch (e) {
      console.error('Failed to load templates:', e)
    }
  }, [])

  const saveTemplatesToStorage = (updated: PresetTemplate[]) => {
    setTemplates(updated)
    localStorage.setItem(TEMPLATES_STORAGE_KEY, JSON.stringify(updated))
  }

  const handleSaveTemplate = () => {
    if (!newTemplateName.trim()) {
      addToast({ title: 'Please enter a template name', type: 'error' })
      return
    }
    const name = newTemplateName.trim()
    const existingIndex = templates.findIndex(t => t.name.toLowerCase() === name.toLowerCase())
    const newTemplate: PresetTemplate = { name, options: { ...options } }
    
    let updated: PresetTemplate[] = []
    if (existingIndex >= 0) {
      updated = [...templates]
      updated[existingIndex] = newTemplate
    } else {
      updated = [...templates, newTemplate]
    }

    saveTemplatesToStorage(updated)
    setSelectedTemplateName(name)
    setNewTemplateName('')
    setShowSaveInput(false)
    addToast({ title: `Template "${name}" saved`, type: 'success' })
  }

  const handleLoadTemplate = (name: string) => {
    setSelectedTemplateName(name)
    const found = templates.find(t => t.name === name)
    if (found) {
      setOptions({ ...found.options })
      addToast({ title: `Loaded template "${name}"`, type: 'info' })
    }
  }

  const handleDeleteTemplate = (name: string) => {
    const updated = templates.filter(t => t.name !== name)
    saveTemplatesToStorage(updated)
    if (selectedTemplateName === name) {
      setSelectedTemplateName('')
    }
    addToast({ title: `Deleted template "${name}"`, type: 'info' })
  }

  const copyCommand = () => {
    if (!params) return
    const cmd = `ffmpeg ${(params.ffmpegArgs || []).join(' ')}`
    navigator.clipboard.writeText(cmd)
    addToast({ title: 'Command copied to clipboard!', type: 'success' })
  }

  // CQ Quality Visual Label Helper
  const getCqVisualLabel = (crf: number) => {
    if (crf <= 16) {
      return { text: 'Near Lossless / Archival (CQ 10-16)', color: 'text-emerald-400', badgeBg: 'bg-emerald-500/15 border-emerald-500/30' }
    } else if (crf <= 22) {
      return { text: 'High Quality / Transparent (CQ 17-22)', color: 'text-primary', badgeBg: 'bg-primary/15 border-primary/30' }
    } else if (crf <= 27) {
      return { text: 'Balanced / Medium Bitrate (CQ 23-27)', color: 'text-amber-400', badgeBg: 'bg-amber-500/15 border-amber-500/30' }
    } else {
      return { text: 'High Compression / Small File (CQ 28-35)', color: 'text-orange-400', badgeBg: 'bg-orange-500/15 border-orange-500/30' }
    }
  }

  const qualityInfo = getCqVisualLabel(options.crf)

  return (
    <div className="space-y-6 custom-scrollbar">
      {/* Preset Template Manager Bar */}
      <div className="bg-muted/20 border border-border/40 rounded-2xl p-4 space-y-3">
        <div className="flex items-center justify-between">
          <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground/80 flex items-center gap-1.5">
            <Bookmark className="w-3.5 h-3.5 text-primary" />
            Saved Configuration Templates
          </label>
          <button
            type="button"
            onClick={() => setShowSaveInput(!showSaveInput)}
            className="flex items-center gap-1 text-[11px] font-bold text-primary hover:underline"
          >
            <Save className="w-3 h-3" />
            Save Current State as Template
          </button>
        </div>

        {showSaveInput && (
          <div className="flex gap-2 animate-in slide-in-from-top-1 duration-200">
            <input
              type="text"
              placeholder="Template name (e.g. 4K High Quality NVENC)"
              value={newTemplateName}
              onChange={(e) => setNewTemplateName(e.target.value)}
              className="flex-1 px-3 py-1.5 bg-background border border-border/50 rounded-xl text-xs focus:outline-hidden focus:ring-1 focus:ring-primary"
            />
            <button
              type="button"
              onClick={handleSaveTemplate}
              className="px-3 py-1.5 bg-primary text-primary-foreground font-bold text-xs rounded-xl hover:opacity-90 transition-all"
            >
              Save
            </button>
          </div>
        )}

        {templates.length > 0 ? (
          <div className="flex items-center gap-2">
            <select
              value={selectedTemplateName}
              onChange={(e) => handleLoadTemplate(e.target.value)}
              className="flex-1 bg-muted/80 border border-border/50 rounded-xl px-3 py-2 text-xs font-medium focus:outline-hidden focus:ring-1 focus:ring-primary"
            >
              <option value="">Select a saved template…</option>
              {templates.map(t => (
                <option key={t.name} value={t.name}>{t.name}</option>
              ))}
            </select>
            {selectedTemplateName && (
              <button
                type="button"
                onClick={() => handleDeleteTemplate(selectedTemplateName)}
                className="p-2 text-red-400 hover:text-red-500 hover:bg-red-500/10 rounded-xl transition-all"
                title="Delete selected template"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            )}
          </div>
        ) : (
          <p className="text-[11px] text-muted-foreground italic">No custom templates saved yet.</p>
        )}
      </div>

      {/* Grid Section 1: Engine & Target Codec */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Engine Selector */}
        <div className="space-y-2">
          <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground/70 flex items-center gap-1.5">
            <Settings2 className="w-3.5 h-3.5 text-primary" />
            Transcoding Engine
          </label>
          <select 
            value={options.transcodingEngine}
            onChange={(e) => setOptions(prev => ({ ...prev, transcodingEngine: e.target.value as TranscodeOptions['transcodingEngine'] }))}
            className="w-full bg-muted border border-border/50 rounded-xl p-2.5 text-sm font-medium outline-hidden focus:border-primary transition-all"
          >
            {availability?.ffmpeg && <option value="ffmpeg">FFmpeg (Zero-Copy VRAM Pipeline)</option>}
          </select>
        </div>

        {/* Target Codec */}
        <div className="space-y-2">
          <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground/70 flex items-center gap-1.5">
            <Layers className="w-3.5 h-3.5 text-primary" />
            Target Codec
          </label>
          <select 
            value={options.targetCodec}
            onChange={(e) => setOptions(prev => ({ ...prev, targetCodec: e.target.value as TranscodeOptions['targetCodec'] }))}
            className="w-full bg-muted border border-border/50 rounded-xl p-2.5 text-sm font-medium outline-hidden focus:border-primary transition-all"
          >
            <option value="av1">AV1</option>
            <option value="hevc">HEVC (H.265)</option>
          </select>
        </div>
      </div>

      {/* Canonical Transcoding Device Selector */}
      <TranscodingDeviceSelector
        useGpu={options.useGpu}
        onUseGpuChange={(useGpu) => setOptions(prev => ({ ...prev, useGpu }))}
        selectedGpuId={options.gpuId}
        onSelectedGpuIdChange={(gpuId) => setOptions(prev => ({ ...prev, gpuId, useGpu: Boolean(gpuId) }))}
        gpus={gpus}
        variant="expanded"
      />

      {/* Quality CQ Slider with Visual Feedback */}
      <div className="space-y-3 p-4 bg-muted/20 border border-border/40 rounded-2xl">
        <div className="flex items-center justify-between">
          <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
            <Sliders className="w-3.5 h-3.5 text-primary" />
            Constant Quality Target (CQ / CRF: {options.crf})
          </label>
          <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full border ${qualityInfo.badgeBg} ${qualityInfo.color}`}>
            {qualityInfo.text}
          </span>
        </div>

        <input 
          type="range"
          min={10}
          max={35}
          step={1}
          value={options.crf}
          onChange={(e) => setOptions(prev => ({ ...prev, crf: parseInt(e.target.value) }))}
          className="w-full h-2 bg-muted rounded-lg appearance-none cursor-pointer accent-primary"
        />

        <div className="flex justify-between text-[10px] text-muted-foreground/70 font-mono">
          <span>CQ 10 (Archival / Large)</span>
          <span>CQ 20 (Balanced HQ)</span>
          <span>CQ 35 (Max Compression)</span>
        </div>
      </div>

      {/* Preset Speed / Optimization Level */}
      <div className="space-y-2">
        <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground/70">
          Hardware Encoding Preset
        </label>
        <select 
          value={options.preset}
          onChange={(e) => setOptions(prev => ({ ...prev, preset: e.target.value }))}
          className="w-full bg-muted border border-border/50 rounded-xl p-2.5 text-sm font-medium outline-hidden focus:border-primary"
        >
          <optgroup label="NVIDIA NVENC Presets">
            <option value="p7">P7 (Slowest / Highest Quality)</option>
            <option value="p6">P6 (Recommended HQ)</option>
            <option value="p5">P5 (Medium / Balanced)</option>
            <option value="p4">P4 (Fast)</option>
            <option value="p3">P3 (Faster)</option>
            <option value="p2">P2 (Very Fast)</option>
            <option value="p1">P1 (Fastest / Lowest Quality)</option>
          </optgroup>
          <optgroup label="CPU Software Presets">
            <option value="slow">Slow</option>
            <option value="medium">Medium</option>
            <option value="fast">Fast</option>
            <option value="veryfast">Very Fast</option>
          </optgroup>
        </select>
      </div>

      {/* Output Mode Selection */}
      <div className="space-y-2">
        <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground/70">
          Output Mode
        </label>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <button
            type="button"
            onClick={() => setOptions(prev => ({ ...prev, outputMode: 'replace' }))}
            className={`p-3 rounded-xl border text-left transition-all ${
              options.outputMode === 'replace'
                ? 'bg-primary/10 border-primary shadow-sm ring-1 ring-primary'
                : 'bg-muted/30 border-border/40 text-muted-foreground hover:text-foreground'
            }`}
          >
            <span className="text-xs font-bold text-foreground block mb-0.5">Direct Replace</span>
            <p className="text-[11px] text-muted-foreground leading-snug">In-place replacement with zero residual storage footprint.</p>
          </button>

          <button
            type="button"
            onClick={() => setOptions(prev => ({ ...prev, outputMode: 'quarantine-replace' }))}
            className={`p-3 rounded-xl border text-left transition-all ${
              options.outputMode === 'quarantine-replace'
                ? 'bg-primary/10 border-primary shadow-sm ring-1 ring-primary'
                : 'bg-muted/30 border-border/40 text-muted-foreground hover:text-foreground'
            }`}
          >
            <span className="text-xs font-bold text-foreground block mb-0.5">Quarantine & Replace</span>
            <p className="text-[11px] text-muted-foreground leading-snug">Replaces original and retains timestamped backup.</p>
          </button>

          <button
            type="button"
            onClick={() => setOptions(prev => ({ ...prev, outputMode: 'copy' }))}
            className={`p-3 rounded-xl border text-left transition-all ${
              options.outputMode === 'copy'
                ? 'bg-primary/10 border-primary shadow-sm ring-1 ring-primary'
                : 'bg-muted/30 border-border/40 text-muted-foreground hover:text-foreground'
            }`}
          >
            <span className="text-xs font-bold text-foreground block mb-0.5">Create Sibling Copy</span>
            <p className="text-[11px] text-muted-foreground leading-snug">Outputs alongside original file as a duplicate.</p>
          </button>
        </div>
      </div>

      {/* Custom FFmpeg Arguments */}
      <div className="space-y-2">
        <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground/70">
          Custom Additional FFmpeg Arguments
        </label>
        <input 
          type="text"
          placeholder="e.g. -tune hq -spatial-aq 1"
          value={options.customArgs}
          onChange={(e) => setOptions(prev => ({ ...prev, customArgs: e.target.value }))}
          className="w-full bg-muted border border-border/50 rounded-xl p-2.5 text-xs font-mono outline-hidden focus:border-primary"
        />
      </div>

      {/* CLI Command Live Preview */}
      {params && params.ffmpegArgs && (
        <div className="bg-black/40 border border-border/40 rounded-2xl p-4 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
              <Sparkles className="w-3 h-3 text-primary" />
              Live FFmpeg Command String
            </span>
            <button
              onClick={copyCommand}
              className="flex items-center gap-1 text-[11px] font-bold text-primary hover:underline"
            >
              <Copy className="w-3 h-3" />
              Copy CLI
            </button>
          </div>
          <pre className="text-[11px] font-mono text-muted-foreground bg-muted/20 p-2.5 rounded-xl overflow-x-auto whitespace-pre-wrap break-all border border-border/20 max-h-28">
            ffmpeg {params.ffmpegArgs.join(' ')}
          </pre>
        </div>
      )}
    </div>
  )
}
