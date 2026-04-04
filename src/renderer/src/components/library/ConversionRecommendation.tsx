import { useState, useEffect, useMemo } from 'react'
import { Sparkles, Loader2, AlertCircle, Copy, Check, Info, Zap } from 'lucide-react'
import type { MediaItem } from './types'

interface CompressionAdvice {
  summary: string
  av1: {
    ffmpeg: string
    handbrake: string
    tuning_explanation: string
  }
  hevc: {
    ffmpeg: string
    handbrake: string
    tuning_explanation: string
  }
  audio_strategy: string
  warnings: string[]
}

export function ConversionRecommendation({ item, compact = false }: { item: MediaItem, compact?: boolean }) {
  const [copied, setCopied] = useState<string | null>(null)
  const [isAiLoading, setIsAiLoading] = useState(false)
  const [aiAdvice, setAiAdvice] = useState<CompressionAdvice | null>(null)
  const [aiError, setAiError] = useState<string | null>(null)
  const [aiConfigured, setAiConfigured] = useState<boolean>(false)
  const [mode, setMode] = useState<'standard' | 'ai'>('standard')
  
  useEffect(() => {
    window.electronAPI.aiIsConfigured().then(setAiConfigured)
  }, [])

  // Visibility logic: Only show for items that are inefficient or have significant storage debt
  const isInefficient = useMemo(() => {
    const score = item.efficiency_score
    const debt = item.storage_debt_bytes
    const debtThreshold = item.type === 'movie' ? 5 * 1024 * 1024 * 1024 : 2 * 1024 * 1024 * 1024
    return (score !== null && score !== undefined && score > 0 && score < 60) || 
           (debt !== null && debt !== undefined && debt > debtThreshold)
  }, [item.efficiency_score, item.storage_debt_bytes, item.type])

  // Restore Heuristic logic
  const heuristics = useMemo(() => {
    const is4K = item.resolution?.includes('4K') || item.resolution?.includes('2160p')
    const isFilm = (item as any).genres?.toLowerCase().includes('drama') || (item as any).genres?.toLowerCase().includes('history')
    
    const av1RF = is4K ? 22 : 24
    const h265RF = is4K ? 24 : 20
    
    const av1Params = `tune=0:enable-overlays=1${isFilm ? ':film-grain=20' : ''}`
    const x265Params = `aq-mode=3:no-open-gop=1${isFilm ? ':psy-rd=2.0' : ''}`

    return {
      av1: {
        ffmpeg: `ffmpeg -i input.mkv -c:v libsvtav1 -crf ${av1RF} -preset 6 -pix_fmt yuv420p10le -svtav1-params ${av1Params} -c:a libopus -b:a 128k output.mkv`,
        handbrake: `Encoder: AV1 10-bit (SVT), RF: ${av1RF}, Preset: 6, Advanced: ${av1Params}`
      },
      hevc: {
        ffmpeg: `ffmpeg -i input.mkv -c:v libx265 -crf ${h265RF} -preset slow -pix_fmt yuv420p10le -x265-params ${x265Params} -c:a copy output.mp4`,
        handbrake: `Encoder: H.265 10-bit (x265), RF: ${h265RF}, Preset: Slow, Advanced: ${x265Params}`
      }
    }
  }, [item.resolution, (item as any).genres])

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text)
    setCopied(id)
    setTimeout(() => setCopied(null), 2000)
  }

  const handleAiAnalyze = async () => {
    if (!item.id) return
    setIsAiLoading(true)
    setAiError(null)
    setMode('ai')
    
    try {
      const result = await window.electronAPI.aiCompressionAdvice({ mediaId: item.id, requestId: `compression-${item.id}` })
      // Clean potential markdown code blocks if the AI ignored the "JSON ONLY" instruction
      let jsonStr = result.text.trim()
      if (jsonStr.startsWith('```json')) {
        jsonStr = jsonStr.replace(/^```json/, '').replace(/```$/, '').trim()
      } else if (jsonStr.startsWith('```')) {
        jsonStr = jsonStr.replace(/^```/, '').replace(/```$/, '').trim()
      }
      
      const parsed = JSON.parse(jsonStr) as CompressionAdvice
      setAiAdvice(parsed)
      setIsAiLoading(false)
    } catch (error: any) {
      console.error('AI Analysis failed:', error)
      setAiError(error.message || 'Failed to get AI recommendation')
      setIsAiLoading(false)
    }
  }

  if (!isInefficient) return null

  const baseClasses = compact ? "mt-2 p-2 text-[10px]" : "mt-4 p-4 text-xs"

  return (
    <div className={`${baseClasses} bg-primary/5 rounded-md border border-primary/20 space-y-3 overflow-hidden animate-in fade-in slide-in-from-top-1`}>
      {/* Header & Mode Toggles */}
      <div className="flex items-center justify-between border-b border-primary/10 pb-2">
        <div className="flex items-center gap-4">
          <button 
            onClick={() => setMode('standard')}
            className={`flex items-center gap-1.5 transition-colors ${mode === 'standard' ? 'text-primary font-bold underline underline-offset-4' : 'text-muted-foreground hover:text-foreground'}`}
          >
            <Zap className="w-3.5 h-3.5" />
            Standard
          </button>
          
          <button 
            onClick={aiAdvice ? () => setMode('ai') : handleAiAnalyze}
            disabled={!aiConfigured || isAiLoading}
            className={`flex items-center gap-1.5 transition-colors ${mode === 'ai' ? 'text-primary font-bold underline underline-offset-4' : 'text-muted-foreground hover:text-foreground'} disabled:opacity-50`}
          >
            {isAiLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
            High Precision
          </button>
        </div>

        {item.storage_debt_bytes && (
          <span className="text-[10px] text-muted-foreground bg-primary/10 px-1.5 py-0.5 rounded font-mono">
            WASTE: {Math.round(item.storage_debt_bytes / (1024 * 1024 * 1024))}GB
          </span>
        )}
      </div>

      {mode === 'standard' ? (
        <div className="space-y-4 animate-in fade-in duration-300">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-bold text-primary flex items-center gap-1 uppercase tracking-tight">
                Recommended: AV1 (Best Size)
              </span>
            </div>
            <div className="space-y-1">
              <div className="flex items-center justify-between group/cmd bg-black/20 p-1.5 rounded border border-white/5">
                <code className="text-muted-foreground truncate flex-1 mr-2">{heuristics.av1.ffmpeg}</code>
                <button onClick={() => copyToClipboard(heuristics.av1.ffmpeg, 'h-av1-f')} className="p-1 hover:text-primary transition-colors">
                  {copied === 'h-av1-f' ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                </button>
              </div>
              <div className="text-muted-foreground italic truncate px-1 opacity-70">{heuristics.av1.handbrake}</div>
            </div>
          </div>
          
          <div className="space-y-2">
            <span className="font-bold text-muted-foreground flex items-center gap-1 uppercase tracking-tight">
              Compatibility: H.265 (HEVC)
            </span>
            <div className="space-y-1">
              <div className="flex items-center justify-between group/cmd bg-black/20 p-1.5 rounded border border-white/5">
                <code className="text-muted-foreground truncate flex-1 mr-2">{heuristics.hevc.ffmpeg}</code>
                <button onClick={() => copyToClipboard(heuristics.hevc.ffmpeg, 'h-hevc-f')} className="p-1 hover:text-primary transition-colors">
                  {copied === 'h-hevc-f' ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                </button>
              </div>
              <div className="text-muted-foreground italic truncate px-1 opacity-70">{heuristics.hevc.handbrake}</div>
            </div>
          </div>
        </div>
      ) : aiError ? (
        <div className="py-4 flex flex-col items-center gap-3 text-destructive animate-in shake">
          <AlertCircle className="w-6 h-6" />
          <div className="text-center">
            <p className="font-medium">AI analysis failed</p>
            <p className="text-[10px] opacity-70">{aiError}</p>
          </div>
          <button onClick={handleAiAnalyze} className="text-[10px] underline hover:no-underline font-medium">Try again</button>
        </div>
      ) : isAiLoading ? (
        <div className="py-8 flex flex-col items-center justify-center gap-3 text-muted-foreground">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
          <div className="text-center">
            <p className="font-medium text-foreground">Gemini is performing bit-depth and codec audit...</p>
            <p className="text-[10px] opacity-70">Calculating optimal CRF for {item.resolution} source</p>
          </div>
        </div>
      ) : aiAdvice ? (
        <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-500">
          <div className="bg-primary/10 p-2.5 rounded border border-primary/20 text-muted-foreground leading-snug">
            <div className="flex items-center gap-1.5 text-primary mb-1 font-bold uppercase tracking-widest text-[9px]">
              <Info className="w-3 h-3" />
              AI Insight
            </div>
            {aiAdvice.summary}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* AV1 Card */}
            <div className="space-y-2">
              <div className="font-bold text-primary flex items-center gap-1 uppercase tracking-tight">
                AI Tuned AV1
              </div>
              <div className="bg-black/40 p-2 rounded border border-white/5 relative group">
                <code className="text-[10px] text-muted-foreground block break-all leading-relaxed pr-6">
                  {aiAdvice.av1.ffmpeg}
                </code>
                <button 
                  onClick={() => copyToClipboard(aiAdvice.av1.ffmpeg, 'ai-av1')}
                  className="absolute top-1.5 right-1.5 p-1 bg-background/80 hover:bg-primary/20 rounded border border-border/50 opacity-0 group-hover:opacity-100 transition-all shadow-sm"
                >
                  {copied === 'ai-av1' ? <Check className="w-3 h-3 text-primary" /> : <Copy className="w-3 h-3" />}
                </button>
              </div>
              <p className="text-[10px] text-muted-foreground italic leading-relaxed px-1">
                {aiAdvice.av1.tuning_explanation}
              </p>
            </div>

            {/* HEVC Card */}
            <div className="space-y-2">
              <div className="font-bold text-muted-foreground flex items-center gap-1 uppercase tracking-tight">
                AI Tuned HEVC
              </div>
              <div className="bg-black/40 p-2 rounded border border-white/5 relative group">
                <code className="text-[10px] text-muted-foreground block break-all leading-relaxed pr-6">
                  {aiAdvice.hevc.ffmpeg}
                </code>
                <button 
                  onClick={() => copyToClipboard(aiAdvice.hevc.ffmpeg, 'ai-hevc')}
                  className="absolute top-1.5 right-1.5 p-1 bg-background/80 hover:bg-primary/20 rounded border border-border/50 opacity-0 group-hover:opacity-100 transition-all shadow-sm"
                >
                  {copied === 'ai-hevc' ? <Check className="w-3 h-3 text-primary" /> : <Copy className="w-3 h-3" />}
                </button>
              </div>
              <p className="text-[10px] text-muted-foreground italic leading-relaxed px-1">
                {aiAdvice.hevc.tuning_explanation}
              </p>
            </div>
          </div>

          <div className="pt-2 border-t border-white/5 grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <span className="text-[9px] font-bold text-muted-foreground uppercase tracking-widest block mb-1">Audio Strategy</span>
              <p className="text-[10px] text-muted-foreground">{aiAdvice.audio_strategy}</p>
            </div>
            {aiAdvice.warnings.length > 0 && (
              <div>
                <span className="text-[9px] font-bold text-amber-500 uppercase tracking-widest block mb-1">Warnings</span>
                {aiAdvice.warnings.map((w, i) => (
                  <p key={i} className="text-[10px] text-amber-500/80 leading-tight">• {w}</p>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : null}
      
      <div className="pt-2 border-t border-primary/10 flex items-center gap-1.5 text-[9px] text-muted-foreground">
        <Info className="w-3 h-3" />
        <span>Parameters focus on reducing storage footprint while targeting visual transparency.</span>
      </div>
    </div>
  )
}
