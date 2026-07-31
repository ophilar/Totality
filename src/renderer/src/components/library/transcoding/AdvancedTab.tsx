import { useState, useEffect } from 'react'
import { 
  Sliders, 
  Cpu, 
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
        setTemplates(JSON.parse(stored))
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
    const cmd = options.transcodingEngine === 'ffmpeg'
      ? `ffmpeg ${(params.ffmpegArgs || []).join(' ')}`
      : `HandBrakeCLI ${params.handbrakeArgs.join(' ')}`
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
              className="flex-1 bg-background border border-border/50 rounded-xl p-2 text-xs font-medium outline-hidden focus:border-primary transition-all"
            >
              <option value="">-- Load Saved Preset --</option>
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

      {/* Grid Section 1: Engine & GPU Vendor */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Engine Selector */}
        <div className="space-y-2">
          <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground/70 flex items-center gap-1.5">
            <Settings2 className="w-3.5 h-3.5 text-primary" />
            Transcoding Engine
          </label>
          <select 
            value={options.transcodingEngine}
            onChange={(e) => setOptions(prev => ({ ...prev, transcodingEngine: e.target.value as any }))}
            className="w-full bg-muted border border-border/50 rounded-xl p-2.5 text-sm font-medium outline-hidden focus:border-primary transition-all"
          >
            {availability?.ffmpeg && <option value="ffmpeg">FFmpeg (Zero-Copy VRAM Pipeline)</option>}
            {availability?.handbrake && <option value="handbrake">HandBrake CLI</option>}
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
            onChange={(e) => setOptions(prev => ({ ...prev, targetCodec: e.target.value as any }))}
            className="w-full bg-muted border border-border/50 rounded-xl p-2.5 text-sm font-medium outline-hidden focus:border-primary transition-all"
          >
            <option value="av1">AV1 (Most Efficient / Next-Gen)</option>
            <option value="hevc">HEVC (H.265 / High Efficiency)</option>
            <option value="h264">H.264 (Legacy Compatibility)</option>
          </select>
        </div>
      </div>

      {/* Hardware Vendor & GPU Acceleration */}
      <div className="space-y-3 p-4 bg-muted/20 border border-border/40 rounded-2xl">
        <label className="flex items-center justify-between cursor-pointer">
          <div className="flex items-center gap-2">
            <Cpu className="w-4 h-4 text-primary" />
            <span className="text-sm font-semibold">Enable GPU Acceleration (Hardware VRAM Pipeline)</span>
          </div>
          <input
            type="checkbox"
            checked={options.useGpu}
            onChange={(e) => setOptions(prev => ({ ...prev, useGpu: e.target.checked }))}
            className="w-4 h-4 rounded border-border text-primary focus:ring-primary/20"
          />
        </label>

        {options.useGpu && (
          <div className="space-y-3 pt-2 animate-in fade-in duration-200">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">GPU Vendor</label>
                <select
                  value={options.vendor || (gpus.length > 0 ? gpus[0].vendor : 'NVIDIA')}
                  onChange={(e) => setOptions(prev => ({ ...prev, vendor: e.target.value as any }))}
                  className="w-full bg-muted/80 border border-border/50 rounded-xl p-2 text-xs font-medium outline-hidden focus:border-primary"
                >
                  <option value="NVIDIA">NVIDIA (NVENC CUDA VRAM)</option>
                  <option value="Intel">Intel (QuickSync QSV)</option>
                  <option value="AMD">AMD (AMF VCE)</option>
                  <option value="Apple">Apple (VideoToolbox VT)</option>
                  <option value="Software">Software CPU Fallback</option>
                </select>
              </div>

              <div className="space-y-1.5">
                <label className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">GPU Device</label>
                <select
                  value={options.gpuId}
                  onChange={(e) => setOptions(prev => ({ ...prev, gpuId: e.target.value }))}
                  className="w-full bg-muted/80 border border-border/50 rounded-xl p-2 text-xs font-medium outline-hidden focus:border-primary"
                >
                  {gpus.length > 0 ? (
                    gpus.map(gpu => (
                      <option key={gpu.id} value={gpu.id}>
                        {gpu.name} ({gpu.vendor})
                      </option>
                    ))
                  ) : (
                    <option value="">Default GPU Adapter</option>
                  )}
                </select>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Quality CQ Slider with Visual Feedback */}
      <div className="space-y-3 p-4 bg-muted/20 border border-border/40 rounded-2xl">
        <div className="flex items-center justify-between">
          <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground/80 flex items-center gap-1.5">
            <Sliders className="w-3.5 h-3.5 text-primary" />
            Constant Quality (CQ / CRF Value: {options.crf})
          </label>
          <div className={`px-2.5 py-0.5 rounded-full border text-[11px] font-bold ${qualityInfo.badgeBg} ${qualityInfo.color}`}>
            {qualityInfo.text}
          </div>
        </div>

        <div className="space-y-2 pt-1">
          <input
            type="range"
            min="10"
            max="35"
            value={options.crf}
            onChange={(e) => setOptions(prev => ({ ...prev, crf: parseInt(e.target.value) || 20 }))}
            className="w-full h-2 bg-muted rounded-lg appearance-none cursor-pointer accent-primary"
          />
          <div className="flex justify-between text-[10px] text-muted-foreground font-mono">
            <span>10 (Max Quality)</span>
            <span>20 (Recommended)</span>
            <span>35 (Max Compression)</span>
          </div>
        </div>
      </div>

      {/* Encoder Preset & Speed */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-2">
          <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground/70">Encoder Preset / Speed</label>
          <select 
            value={options.preset}
            onChange={(e) => setOptions(prev => ({ ...prev, preset: e.target.value }))}
            className="w-full bg-muted border border-border/50 rounded-xl p-2.5 text-xs font-medium outline-hidden focus:border-primary transition-all"
          >
            {options.useGpu && options.vendor === 'NVIDIA' ? (
              <>
                <option value="p7">p7 (Highest Quality / Slowest)</option>
                <option value="p6">p6 (High Quality - Recommended)</option>
                <option value="p5">p5 (Medium Quality)</option>
                <option value="p4">p4 (Default Speed)</option>
                <option value="p3">p3 (Fast)</option>
                <option value="p2">p2 (Faster)</option>
                <option value="p1">p1 (Fastest / Lowest Quality)</option>
              </>
            ) : (
              <>
                <option value="ultrafast">Ultrafast</option>
                <option value="superfast">Superfast</option>
                <option value="veryfast">Veryfast</option>
                <option value="faster">Faster</option>
                <option value="fast">Fast</option>
                <option value="medium">Medium (Recommended)</option>
                <option value="slow">Slow</option>
                <option value="slower">Slower</option>
                <option value="veryslow">Veryslow</option>
              </>
            )}
          </select>
        </div>

        {/* Encoder Driver Selection */}
        <div className="space-y-2">
          <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground/70">Specific Video Encoder</label>
          <select 
            value={options.encoder}
            onChange={(e) => setOptions(prev => ({ ...prev, encoder: e.target.value }))}
            className="w-full bg-muted border border-border/50 rounded-xl p-2.5 text-xs font-medium outline-hidden focus:border-primary transition-all"
          >
            <option value="">Auto (Recommended)</option>
            <option value="nvenc_av1">AV1 NVENC (NVIDIA GPU)</option>
            <option value="qsv_av1">AV1 QSV (Intel GPU)</option>
            <option value="svt_av1">SVT-AV1 10-bit (CPU)</option>
            <option value="nvenc_h265">HEVC NVENC (NVIDIA GPU)</option>
            <option value="qsv_h265">HEVC QSV (Intel GPU)</option>
            <option value="x265">x265 10-bit (CPU)</option>
          </select>
        </div>
      </div>

      {/* Streams & Destination Mode */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Streams Controls */}
        <div className="space-y-3 p-3 bg-muted/20 border border-border/30 rounded-xl">
          <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Stream Passthrough</span>
          <label className="flex items-center gap-2.5 text-xs text-muted-foreground hover:text-foreground cursor-pointer">
            <input
              type="checkbox"
              checked={options.preserveSubtitles}
              onChange={(e) => setOptions(prev => ({ ...prev, preserveSubtitles: e.target.checked }))}
              className="w-4 h-4 rounded border-border text-primary"
            />
            <span>Preserve all internal subtitle tracks</span>
          </label>
          <label className="flex items-center gap-2.5 text-xs text-muted-foreground hover:text-foreground cursor-pointer">
            <input
              type="checkbox"
              checked={options.preserveAllAudio}
              onChange={(e) => setOptions(prev => ({ ...prev, preserveAllAudio: e.target.checked }))}
              className="w-4 h-4 rounded border-border text-primary"
            />
            <span>Preserve all audio tracks & channels</span>
          </label>
        </div>

        {/* File Mode */}
        <div className="space-y-3 p-3 bg-muted/20 border border-border/30 rounded-xl">
          <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Destination Output Mode</span>
          <div className="flex gap-2">
            <button 
              type="button"
              onClick={() => setOptions(prev => ({ ...prev, overwriteOriginal: false }))}
              className={`flex-1 p-2 rounded-xl border text-xs font-bold transition-all ${
                !options.overwriteOriginal
                  ? 'bg-primary/10 border-primary text-primary'
                  : 'bg-muted border-border/50 text-muted-foreground'
              }`}
            >
              Create Copy
            </button>
            <button 
              type="button"
              onClick={() => setOptions(prev => ({ ...prev, overwriteOriginal: true }))}
              className={`flex-1 p-2 rounded-xl border text-xs font-bold transition-all ${
                options.overwriteOriginal
                  ? 'bg-orange-500/10 border-orange-500 text-orange-500'
                  : 'bg-muted border-border/50 text-muted-foreground'
              }`}
            >
              Overwrite Original
            </button>
          </div>
        </div>
      </div>

      {/* Target Size Limit & Custom Arguments */}
      <div className="space-y-4 p-4 bg-muted/20 border border-border/40 rounded-2xl">
        <div className="space-y-2">
          <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground/70">Custom CLI Arguments</label>
          <input 
            type="text" 
            placeholder="e.g. -spatial-aq 1 -temporal-aq 1" 
            value={options.customArgs}
            onChange={(e) => setOptions(prev => ({ ...prev, customArgs: e.target.value }))}
            className="w-full bg-muted border border-border/50 rounded-xl p-2.5 text-xs outline-hidden focus:border-primary transition-all font-mono"
          />
        </div>

        <div className="space-y-2">
          <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground/70">Target Filesize Constraint</label>
          <input
            type="text"
            value={options.targetSize}
            onChange={(e) => setOptions(prev => ({ ...prev, targetSize: e.target.value }))}
            placeholder="e.g., ai-recommended, 500MB, 2GB"
            className="w-full px-3 py-2 bg-muted border border-border/50 rounded-xl text-xs font-mono focus:outline-hidden focus:border-primary"
          />
        </div>
      </div>

      {/* Strategy Summary & Copy CLI button */}
      {params && (
        <div className="bg-primary/5 border border-primary/20 rounded-2xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-primary uppercase tracking-wider flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5" />
              Generated CLI Pipeline Summary
            </span>
            <button
              onClick={copyCommand}
              className="flex items-center gap-1 px-2.5 py-1 bg-muted hover:bg-muted/80 text-[11px] font-bold text-muted-foreground hover:text-foreground rounded-lg border border-border/30 transition-all"
            >
              <Copy className="w-3 h-3" />
              Copy CLI Command
            </button>
          </div>
          <p className="text-xs text-foreground/90 font-medium leading-relaxed">
            {params.summary}
          </p>
          <div className="bg-black/40 p-2.5 rounded-xl border border-primary/10 font-mono text-[10px] text-muted-foreground break-all">
            {options.transcodingEngine === 'ffmpeg' ? (
              <>ffmpeg ... {(params.ffmpegArgs || []).join(' ')}</>
            ) : (
              <>HandBrakeCLI ... {params.handbrakeArgs.join(' ')}</>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
