import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { Disc3, RefreshCw, Copy, Check, CircleFadingArrowUp, MoreVertical, X, EyeOff } from 'lucide-react'
import { AddToWishlistButton } from '../../wishlist/AddToWishlistButton'
import type { MusicAlbum, MusicTrack, AlbumCompletenessData, MissingTrack } from '../types'

export function MusicAlbumDetails({
  selectedAlbum,
  selectedArtist,
  albumCompleteness,
  tracks,
  onBack,
  onAnalyzeAlbum,
  onRescanTrack
}: {
  selectedAlbum: MusicAlbum
  selectedArtist: any
  albumCompleteness: AlbumCompletenessData | null
  tracks: MusicTrack[]
  onBack: () => void
  onAnalyzeAlbum: (albumId: number) => Promise<void>
  onRescanTrack?: (track: MusicTrack) => Promise<void>
}) {
  const [isAnalyzingAlbum, setIsAnalyzingAlbum] = useState(false)
  const [copiedTitle, setCopiedTitle] = useState(false)
  const [trackMenuOpen, setTrackMenuOpen] = useState<string | number | null>(null)
  const [rescanningTrackId, setRescanningTrackId] = useState<string | number | null>(null)
  const trackMenuRef = useRef<HTMLDivElement>(null)

  const [selectedTrackForQuality, setSelectedTrackForQuality] = useState<{
    title: string
    codec?: string
    bitrate?: number
    sample_rate?: number
    bit_depth?: number
    is_lossless?: boolean
    qualityTier: string | null
    artist_name?: string
    album_title?: string
  } | null>(null)

  // Click-outside and Escape key handler for track menu
  useEffect(() => {
    if (trackMenuOpen === null) return
    const handleClickOutside = (event: MouseEvent) => {
      if (trackMenuRef.current && !trackMenuRef.current.contains(event.target as Node)) setTrackMenuOpen(null)
    }
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setTrackMenuOpen(null)
    }
    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [trackMenuOpen])

  const handleAnalyzeAlbum = async (albumId: number) => {
    setIsAnalyzingAlbum(true)
    try {
      await onAnalyzeAlbum(albumId)
    } finally {
      setIsAnalyzingAlbum(false)
    }
  }

  const handleTrackRescan = async (trackId: string | number, originalTrack: MusicTrack | undefined) => {
    if (!originalTrack || !onRescanTrack) return
    setTrackMenuOpen(null)
    setRescanningTrackId(trackId)
    try {
      await onRescanTrack(originalTrack)
    } finally {
      setRescanningTrackId(null)
    }
  }

  // Parse missing tracks
  let missingTracks: MissingTrack[] = []
  if (albumCompleteness) {
    try {
      missingTracks = JSON.parse(albumCompleteness.missing_tracks || '[]')
    } catch { /* ignore */ }
  }

  type UnifiedTrack = {
    id: string | number
    title: string
    track_number?: number
    disc_number?: number
    duration_ms?: number
    codec?: string
    bitrate?: number
    sample_rate?: number
    bit_depth?: number
    is_hi_res?: boolean
    is_lossless?: boolean
    isMissing: boolean
    musicbrainz_id?: string
    source_id?: string
    library_id?: string
    file_path?: string
    originalTrack?: MusicTrack
  }

  type QualityTier = 'ultra' | 'high' | 'high-lossy' | 'medium' | 'low' | null
  const LOSSLESS_CODECS = ['flac', 'alac', 'wav', 'aiff', 'pcm', 'dsd', 'ape', 'wavpack', 'wv']
  const isLosslessCodec = (codec?: string): boolean => {
    if (!codec) return false
    return LOSSLESS_CODECS.some(c => codec.toLowerCase().includes(c))
  }
  const isAACCodec = (codec?: string): boolean => codec?.toLowerCase().includes('aac') ?? false

  const getQualityTier = (track: UnifiedTrack): QualityTier => {
    if (track.isMissing) return null
    const bitrateKbps = track.bitrate || 0
    const sampleRate = track.sample_rate || 0
    const bitDepth = track.bit_depth || 16
    const isLossless = track.is_lossless || isLosslessCodec(track.codec)
    if (isLossless && (bitDepth >= 24 || sampleRate > 48000)) return 'ultra'
    if (isLossless) return 'high'
    if (bitrateKbps >= 256) return 'high-lossy'
    if (isAACCodec(track.codec)) {
      if (bitrateKbps >= 128) return 'medium'
    } else if (bitrateKbps >= 160) {
      return 'medium'
    }
    if (bitrateKbps > 0) return 'low'
    if (track.codec) {
      const cl = track.codec.toLowerCase()
      if (cl.includes('mp3') || cl.includes('aac') || cl.includes('ogg')) return 'medium'
    }
    return null
  }

  const qualityTierConfig: Record<string, { label: string; class: string; title: string }> = {
    'ultra': { label: 'Ultra', class: 'bg-foreground text-background', title: 'Hi-Res lossless: 24-bit or >48kHz sample rate' },
    'high': { label: 'High', class: 'bg-foreground text-background', title: 'CD-quality lossless: FLAC/ALAC/WAV at 16-bit/44.1-48kHz' },
    'high-lossy': { label: 'High', class: 'bg-foreground text-background', title: 'High bitrate lossy: 256+ kbps' },
    'medium': { label: 'Medium', class: 'bg-foreground text-background', title: 'Transparent lossy: MP3 >=160kbps or AAC >=128kbps' },
    'low': { label: 'Low', class: 'bg-foreground text-background', title: 'Low bitrate lossy: below transparent threshold' },
  }

  const unifiedTracks: UnifiedTrack[] = [
    ...tracks.map(t => ({
      id: t.id ?? `owned-${t.provider_id}`,
      title: t.title,
      track_number: t.track_number,
      disc_number: t.disc_number,
      duration_ms: t.duration,
      codec: t.audio_codec,
      bitrate: t.audio_bitrate,
      sample_rate: t.sample_rate,
      bit_depth: t.bit_depth,
      is_hi_res: t.is_hi_res,
      is_lossless: t.is_lossless,
      isMissing: false,
      source_id: t.source_id,
      library_id: t.library_id,
      file_path: t.file_path,
      originalTrack: t
    })),
    ...missingTracks.map((t, idx) => ({
      id: t.musicbrainz_id || `missing-${idx}`,
      title: t.title,
      track_number: t.track_number,
      disc_number: t.disc_number,
      duration_ms: t.duration_ms,
      codec: undefined,
      bitrate: undefined,
      is_hi_res: undefined,
      is_lossless: undefined,
      isMissing: true,
      musicbrainz_id: t.musicbrainz_id
    }))
  ]

  unifiedTracks.sort((a, b) => {
    const discA = a.disc_number || 1
    const discB = b.disc_number || 1
    if (discA !== discB) return discA - discB
    return (a.track_number || 999) - (b.track_number || 999)
  })

  return (
    <div className="space-y-6">
      <button onClick={onBack} className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
        Back to {selectedArtist ? selectedArtist.name : 'Albums'}
      </button>

      <div className="flex items-start gap-6">
        <div className="w-44 aspect-square bg-muted rounded-lg overflow-hidden shrink-0 shadow-lg shadow-black/30">
          {selectedAlbum.thumb_url ? (
            <img src={selectedAlbum.thumb_url} alt={selectedAlbum.title} className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <Disc3 className="w-16 h-16 text-muted-foreground" />
            </div>
          )}
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-1.5">
            <h2 className="text-3xl font-bold">{selectedAlbum.title}</h2>
            <button
              onClick={() => { navigator.clipboard.writeText(selectedAlbum.title); setCopiedTitle(true); setTimeout(() => setCopiedTitle(false), 1500) }}
              className="shrink-0 p-1 text-muted-foreground hover:text-foreground transition-colors"
              title="Copy title"
            >
              {copiedTitle ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
            </button>
          </div>
          <p className="text-lg text-muted-foreground">{selectedAlbum.artist_name}</p>
          {selectedAlbum.year && <p className="text-sm text-muted-foreground mt-1">{selectedAlbum.year}</p>}
          <div className="flex flex-wrap gap-2 mt-3">
            {(() => {
              const codec = (selectedAlbum.best_audio_codec || '').toLowerCase()
              const isLossless = LOSSLESS_CODECS.some(c => codec.includes(c))
              const isHiRes = isLossless && ((selectedAlbum.best_bit_depth || 0) > 16 || (selectedAlbum.best_sample_rate || 0) > 48000)
              return (
                <>
                  {isHiRes && <span className="px-2 py-1 text-xs font-bold bg-purple-600 text-white rounded">Hi-Res</span>}
                  {isLossless && !isHiRes && <span className="px-2 py-1 text-xs font-bold bg-green-600 text-white rounded">Lossless</span>}
                  {(selectedAlbum.best_bit_depth ?? 0) > 16 && <span className="px-2 py-1 text-xs font-bold bg-orange-600 text-white rounded">{selectedAlbum.best_bit_depth}-bit</span>}
                </>
              )
            })()}
            {selectedAlbum.album_type && selectedAlbum.album_type !== 'album' && (
              <span className="px-2 py-1 text-xs font-bold bg-gray-600 text-white rounded capitalize">{selectedAlbum.album_type}</span>
            )}
          </div>
          <p className="text-sm text-muted-foreground mt-3">
            {selectedAlbum.track_count}{albumCompleteness ? ` of ${albumCompleteness.total_tracks}` : ''} tracks
            {selectedAlbum.duration_ms && <> • {Math.floor(selectedAlbum.duration_ms / 60000)} min</>}
          </p>
          <button
            onClick={() => selectedAlbum.id && handleAnalyzeAlbum(selectedAlbum.id)}
            disabled={isAnalyzingAlbum}
            className="mt-3 flex items-center gap-2 px-3 py-1.5 text-sm bg-primary text-primary-foreground hover:bg-primary/90 rounded-md transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${isAnalyzingAlbum ? 'animate-spin' : ''}`} />
            {isAnalyzingAlbum ? 'Analyzing...' : 'Analyze for missing tracks'}
          </button>
        </div>
      </div>

      <div className="divide-y divide-border/50">
        {unifiedTracks.map((track) => {
          const qualityTier = getQualityTier(track)
          const tierConfig = qualityTier ? qualityTierConfig[qualityTier] : null
          return (
            <div
              key={track.id}
              className={`flex items-center gap-4 py-3 px-2 transition-colors group ${track.isMissing ? 'opacity-40' : 'hover:bg-muted/30 cursor-pointer'}`}
              onClick={() => {
                if (!track.isMissing) {
                  setSelectedTrackForQuality({
                    title: track.title,
                    codec: track.codec,
                    bitrate: track.bitrate,
                    sample_rate: track.sample_rate,
                    bit_depth: track.bit_depth,
                    is_lossless: track.is_lossless,
                    qualityTier: qualityTier,
                    artist_name: selectedAlbum.artist_name,
                    album_title: selectedAlbum.title
                  })
                }
              }}
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className={`text-sm font-semibold shrink-0 ${track.isMissing ? 'text-muted-foreground/50' : 'text-muted-foreground'}`}>{track.track_number || '-'}</span>
                  <h4 className={`font-semibold truncate ${track.isMissing ? 'text-muted-foreground' : ''}`}>{track.title}</h4>
                </div>
                <div className={`flex items-center gap-1 text-xs mt-0.5 ${track.isMissing ? 'text-muted-foreground/50' : 'text-muted-foreground'}`}>
                  <span>
                    {[
                      track.duration_ms ? `${Math.floor(track.duration_ms / 60000)}:${String(Math.floor((track.duration_ms % 60000) / 1000)).padStart(2, '0')}` : null,
                      !track.isMissing && track.codec ? track.codec.toUpperCase() : null,
                      !track.isMissing && track.bitrate ? `${Math.round(track.bitrate)} kbps` : null,
                    ].filter(Boolean).join(' • ')}
                  </span>
                  {tierConfig && qualityTier === 'low' && <span title={tierConfig.title}><CircleFadingArrowUp className="w-4 h-4 text-red-500 shrink-0" /></span>}
                </div>
              </div>
              {!track.isMissing && track.file_path && onRescanTrack && (
                <div className="relative shrink-0" ref={trackMenuOpen === track.id ? trackMenuRef : undefined}>
                  <button onClick={(e) => { e.stopPropagation(); setTrackMenuOpen(trackMenuOpen === track.id ? null : track.id) }} className="p-1.5 text-muted-foreground hover:text-foreground transition-colors">
                    {rescanningTrackId === track.id ? <RefreshCw className="w-4 h-4 animate-spin" /> : <MoreVertical className="w-4 h-4" />}
                  </button>
                  {trackMenuOpen === track.id && rescanningTrackId !== track.id && (
                    <div className="absolute top-8 right-0 bg-card border border-border rounded-md shadow-lg py-1 min-w-[140px] z-50">
                      <button onClick={(e) => { e.stopPropagation(); handleTrackRescan(track.id, track.originalTrack) }} className="w-full px-3 py-1.5 text-left text-sm hover:bg-muted flex items-center gap-2">
                        <RefreshCw className="w-3.5 h-3.5" />
                        Rescan File
                      </button>
                    </div>
                  )}
                </div>
              )}
              {track.isMissing && (
                <div className="shrink-0">
                  <AddToWishlistButton
                    mediaType="track"
                    title={track.title}
                    musicbrainzId={track.musicbrainz_id}
                    artistName={selectedAlbum.artist_name}
                    albumTitle={selectedAlbum.title}
                    posterUrl={selectedAlbum.thumb_url || undefined}
                    compact
                  />
                </div>
              )}
            </div>
          )
        })}
        {unifiedTracks.length === 0 && <div className="py-8 text-center text-muted-foreground">No tracks found</div>}
      </div>

      {selectedTrackForQuality && (() => {
        const tier = selectedTrackForQuality.qualityTier
        const bitrateKbps = selectedTrackForQuality.bitrate || 0
        const isLossy = !selectedTrackForQuality.is_lossless
        const isHighLossy = isLossy && bitrateKbps >= 256
        const tierLabel = isHighLossy ? 'High' : tier ? tier.charAt(0).toUpperCase() + tier.slice(1) : 'Unknown'
        const tierDescription = tier === 'ultra' ? 'Hi-Res Lossless' : tier === 'high' ? 'CD-Quality Lossless' : isHighLossy ? 'High Bitrate Lossy' : tier === 'medium' ? 'Transparent Lossy' : tier === 'low' ? 'Low Bitrate Lossy' : 'Unknown'
        const sampleRate = selectedTrackForQuality.sample_rate || 44100
        const bitDepth = selectedTrackForQuality.bit_depth || 16
        const tierScore = tier === 'ultra' ? 100 : tier === 'high' ? Math.round(70 + Math.min((sampleRate / 48000), 1) * 15 + Math.min((bitDepth / 24), 1) * 15) : isHighLossy ? Math.min(Math.round(90 + (bitrateKbps - 256) / 64 * 10), 100) : tier === 'medium' ? Math.round(40 + ((bitrateKbps - 128) / (256 - 128)) * 50) : tier === 'low' ? Math.round((bitrateKbps / 192) * 40) : 0
        const codec = (selectedTrackForQuality.codec || '').toLowerCase()
        const isAAC = codec.includes('aac')
        const bitrateLow = !selectedTrackForQuality.is_lossless && selectedTrackForQuality.bitrate && (isAAC ? selectedTrackForQuality.bitrate < 128 : selectedTrackForQuality.bitrate < 160)
        const issueText = tier === 'low' ? `${Math.round(selectedTrackForQuality.bitrate || 0)} kbps may have audible artifacts. Consider 256+ kbps for transparent quality, or lossless for archival.` : tier === 'medium' ? `Good for everyday listening. Lossless (FLAC) available for critical listening or archival.` : null

        return createPortal(
          <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[200] p-6" onClick={() => setSelectedTrackForQuality(null)}>
            <div className="bg-card rounded-xl w-full max-w-lg overflow-hidden shadow-2xl border border-border" onClick={(e) => e.stopPropagation()}>
              <div className="flex gap-4 p-4 border-b border-border/30 bg-sidebar-gradient rounded-t-xl">
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h2 className="text-lg font-medium truncate">{selectedTrackForQuality.title}</h2>
                      {(selectedTrackForQuality.artist_name || selectedTrackForQuality.album_title) && (
                        <p className="text-sm text-muted-foreground truncate">
                          {[selectedTrackForQuality.artist_name, selectedTrackForQuality.album_title].filter(Boolean).join(' · ')}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {(tier === 'low' || tier === 'medium') && (
                        <>
                          <AddToWishlistButton mediaType="track" title={selectedTrackForQuality.title} artistName={selectedTrackForQuality.artist_name} albumTitle={selectedTrackForQuality.album_title} reason="upgrade" compact />
                          <button onClick={() => setSelectedTrackForQuality(null)} className="p-1 text-muted-foreground hover:text-foreground transition-colors" title="Dismiss"><EyeOff className="w-4 h-4" /></button>
                        </>
                      )}
                      <button onClick={() => setSelectedTrackForQuality(null)} className="text-muted-foreground hover:text-foreground p-1"><X className="w-5 h-5" /></button>
                    </div>
                  </div>
                </div>
              </div>
              <div className="p-4 space-y-4">
                <div className="rounded-lg p-3">
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex items-center gap-4 bg-muted/30 -ml-3 -mt-3 -mb-3 px-4 py-3 rounded-l-lg">
                      <div className="text-center">
                        <div className="text-2xl font-bold">{tierLabel}</div>
                        <div className="text-xs font-medium text-muted-foreground">{tierDescription}</div>
                      </div>
                      <div className="h-10 w-px bg-border" />
                      <div className="text-center">
                        <div className="text-2xl font-bold">{tierScore}</div>
                        <div className="text-xs font-medium text-muted-foreground">Score</div>
                      </div>
                    </div>
                    <div className="flex-1 flex items-center gap-4">
                      <div className="flex-1">
                        <div className="flex items-baseline gap-1.5"><span className="text-sm text-muted-foreground">Quality</span><span className="text-sm font-medium tabular-nums">{tierScore}</span></div>
                        <div className="h-1 bg-muted rounded-full overflow-hidden mt-1"><div className="h-full bg-primary transition-all" style={{ width: `${tierScore}%` }} /></div>
                        <div className="text-sm text-muted-foreground mt-0.5">
                          {selectedTrackForQuality.is_lossless ? `${selectedTrackForQuality.bit_depth || 16}-bit / ${((selectedTrackForQuality.sample_rate || 44100) / 1000).toFixed(1)} kHz` : `${Math.round(selectedTrackForQuality.bitrate || 0)} kbps`}
                        </div>
                      </div>
                      {(selectedTrackForQuality.bit_depth ?? 0) >= 24 && <span className="px-2 py-0.5 text-xs font-medium rounded bg-purple-500/20 text-purple-400">Hi-Res</span>}
                    </div>
                  </div>
                  {issueText && <div className="mt-3 pt-3 border-t border-border"><div className="text-sm text-muted-foreground">{issueText}</div></div>}
                </div>
                <div className="bg-muted/30 rounded-lg p-3">
                  <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Audio Specs</h3>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
                    <div className="flex justify-between"><span className="text-muted-foreground">Codec</span><span className="font-medium uppercase">{selectedTrackForQuality.codec || 'Unknown'}</span></div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Bitrate</span>
                      <span className="font-medium flex items-center">{selectedTrackForQuality.bitrate ? `${Math.round(selectedTrackForQuality.bitrate)} kbps` : 'N/A'}{bitrateLow && <span className="inline-block w-2 h-2 rounded-full bg-red-500 ml-1.5" title="Below quality threshold" />}</span>
                    </div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Sample Rate</span><span className="font-medium">{selectedTrackForQuality.sample_rate ? `${(selectedTrackForQuality.sample_rate / 1000).toFixed(1)} kHz` : 'N/A'}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Bit Depth</span><span className="font-medium">{selectedTrackForQuality.bit_depth ? `${selectedTrackForQuality.bit_depth}-bit` : 'N/A'}</span></div>
                  </div>
                </div>
              </div>
            </div>
          </div>,
          document.body
        )
      })()}
    </div>
  )
}
