import React, { useState, useEffect, useRef } from 'react'
import { VirtuosoGrid } from 'react-virtuoso'
import { Disc3, User, RefreshCw, Pencil, ChevronDown, ChevronUp, Copy, Check } from 'lucide-react'
import { AlbumCard } from './AlbumCard'
import { AlbumListItem } from './AlbumListItem'
import { MissingAlbumCard } from './MissingAlbumCard'
import { MissingAlbumListItem } from './MissingAlbumListItem'
import type { MusicArtist, MusicAlbum, ArtistCompletenessData, MissingAlbum, AlbumCompletenessData } from '../types'

export function MusicArtistDetails({
  selectedArtist,
  filteredAlbums,
  viewType,
  showSourceBadge,
  allAlbumCompleteness,
  onSelectAlbum,
  onAnalyzeAlbum,
  onFixAlbumMatch,
  artistCompleteness,
  onAnalyzeArtist,
  onFixArtistMatch,
  onBack,
  posterMinWidth,
  scrollElement,
  includeEps,
  includeSingles,
  onDismissMissingAlbum
}: {
  selectedArtist: MusicArtist
  filteredAlbums: MusicAlbum[]
  viewType: 'grid' | 'list'
  showSourceBadge: boolean
  allAlbumCompleteness: Map<number, AlbumCompletenessData>
  onSelectAlbum: (album: MusicAlbum) => void
  onAnalyzeAlbum: (albumId: number) => Promise<void>
  onFixAlbumMatch?: (albumId: number, albumTitle: string, artistName: string) => void
  artistCompleteness: Map<string, ArtistCompletenessData>
  onAnalyzeArtist: (artistId: number) => Promise<void>
  onFixArtistMatch?: (artistId: number, artistName: string) => void
  onBack: () => void
  posterMinWidth: number
  scrollElement?: HTMLElement | null
  includeEps: boolean
  includeSingles: boolean
  onDismissMissingAlbum?: (album: MissingAlbum, artistName: string, artistMusicbrainzId?: string) => Promise<void>
}) {
  const [isAnalyzingArtist, setIsAnalyzingArtist] = useState(false)
  const [bioExpanded, setBioExpanded] = useState(false)
  const [copiedTitle, setCopiedTitle] = useState(false)
  const artistMenuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setBioExpanded(false)
    setCopiedTitle(false)
  }, [selectedArtist])

  const handleAnalyzeArtist = async (artistId: number) => {
    setIsAnalyzingArtist(true)
    try {
      await onAnalyzeArtist(artistId)
    } finally {
      setIsAnalyzingArtist(false)
    }
  }

  return (
    <div className="space-y-6">
      <button
        onClick={onBack}
        className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
        Back to Artists
      </button>

      <div className="flex gap-6 mb-6">
        <div className="w-44 h-44 bg-muted rounded-lg overflow-hidden shrink-0 shadow-lg shadow-black/30">
          {selectedArtist.thumb_url ? (
            <img src={selectedArtist.thumb_url} alt={selectedArtist.name} className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <User className="w-20 h-20 text-muted-foreground" />
            </div>
          )}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <h3 className="text-3xl font-bold">{selectedArtist.name}</h3>
            <button
              onClick={() => { navigator.clipboard.writeText(selectedArtist.name); setCopiedTitle(true); setTimeout(() => setCopiedTitle(false), 1500) }}
              className="shrink-0 p-1 text-muted-foreground hover:text-foreground transition-colors"
              title="Copy title"
            >
              {copiedTitle ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
            </button>
          </div>

          <div className="flex items-center gap-2 mt-1 text-sm text-muted-foreground">
            {selectedArtist.country && <><span>{selectedArtist.country}</span><span>•</span></>}
            {selectedArtist.genres && (
              <>
                <span>{(() => { try { const g = JSON.parse(selectedArtist.genres); return Array.isArray(g) ? g.join(', ') : selectedArtist.genres } catch { return selectedArtist.genres } })()}</span>
                <span>•</span>
              </>
            )}
            <span>{selectedArtist.album_count} albums</span>
            <span>•</span>
            <span>{selectedArtist.track_count} tracks</span>
          </div>

          {artistCompleteness.has(selectedArtist.name) && (
            <p className="text-sm text-muted-foreground mt-1">
              {artistCompleteness.get(selectedArtist.name)!.owned_albums} of {artistCompleteness.get(selectedArtist.name)!.total_albums} albums in discography
            </p>
          )}

          <div className="flex items-center gap-3 mt-3" ref={artistMenuRef}>
            <button
              onClick={() => { if (selectedArtist.id !== undefined) handleAnalyzeArtist(selectedArtist.id) }}
              disabled={isAnalyzingArtist}
              className="flex items-center gap-2 px-3 py-1.5 text-sm bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isAnalyzingArtist ? 'animate-spin' : ''}`} />
              {isAnalyzingArtist ? 'Analyzing...' : 'Analyze Completeness'}
            </button>
            {onFixArtistMatch && (
              <button
                onClick={() => { if (selectedArtist.id !== undefined) onFixArtistMatch(selectedArtist.id, selectedArtist.name) }}
                className="p-2 text-muted-foreground hover:text-foreground hover:bg-muted rounded-md transition-colors"
                title="Fix Match"
              >
                <Pencil className="w-4 h-4" />
              </button>
            )}
          </div>

          {selectedArtist.biography && (
            <div className="mt-3 max-w-2xl">
              <p className={`text-sm text-muted-foreground leading-relaxed ${bioExpanded ? '' : 'line-clamp-3'}`}>
                {selectedArtist.biography}
              </p>
              <button
                onClick={() => setBioExpanded(!bioExpanded)}
                className="flex items-center gap-1 text-sm text-primary hover:text-primary/80 mt-1 transition-colors"
              >
                {bioExpanded ? <><span>Less</span><ChevronUp className="w-4 h-4" /></> : <><span>More</span><ChevronDown className="w-4 h-4" /></>}
              </button>
            </div>
          )}
        </div>
      </div>

      <div>
        <h3 className="text-lg font-semibold mb-4">Your Albums</h3>
        {filteredAlbums.length === 0 ? (
          <div className="p-12 text-center">
            <Disc3 className="w-12 h-12 mx-auto text-muted-foreground mb-2" />
            <p className="text-muted-foreground">No albums found</p>
          </div>
        ) : viewType === 'list' ? (
          <div className="space-y-2">
            {filteredAlbums.map(album => (
              <AlbumListItem
                key={album.id}
                album={album}
                onClick={() => onSelectAlbum(album)}
                showArtist={false}
                showSourceBadge={showSourceBadge}
                completeness={album.id ? allAlbumCompleteness.get(album.id) : undefined}
              />
            ))}
          </div>
        ) : (
          <VirtuosoGrid
            style={{ height: '100%' }}
            data={filteredAlbums}
            useWindowScroll={!scrollElement}
            customScrollParent={scrollElement || undefined}
            listClassName="grid gap-6"
            itemClassName="focus-poster-only"
            components={{
              List: React.forwardRef<HTMLDivElement, any>(({ style, children, className }, ref) => (
                <div
                  ref={ref}
                  className={className}
                  style={{ ...style, gridTemplateColumns: `repeat(auto-fill, minmax(${posterMinWidth}px, 1fr))` }}
                >
                  {children}
                </div>
              )),
              Item: ({ children, ...props }) => <div {...props}>{children}</div>
            }}
            itemContent={(_index, album) => (
              <AlbumCard
                key={album.id}
                album={album}
                onClick={() => onSelectAlbum(album)}
                showArtist={false}
                showSourceBadge={showSourceBadge}
                onAnalyze={onAnalyzeAlbum}
                onFixMatch={onFixAlbumMatch && album.id ? () => onFixAlbumMatch(album.id!, album.title, album.artist_name || '') : undefined}
                completeness={album.id ? allAlbumCompleteness.get(album.id) : undefined}
              />
            )}
          />
        )}
      </div>

      {artistCompleteness.has(selectedArtist.name) && (() => {
        const completeness = artistCompleteness.get(selectedArtist.name)!
        let missingAlbums: MissingAlbum[] = []
        let missingEps: MissingAlbum[] = []
        let missingSingles: MissingAlbum[] = []
        try {
          missingAlbums = JSON.parse(completeness.missing_albums || '[]')
          missingEps = JSON.parse(completeness.missing_eps || '[]')
          missingSingles = JSON.parse(completeness.missing_singles || '[]')
        } catch { /* ignore */ }

        const allMissing = [
          ...missingAlbums,
          ...(includeEps ? missingEps : []),
          ...(includeSingles ? missingSingles : []),
        ]
        if (allMissing.length === 0) return null

        return (
          <div className="mt-8">
            <h3 className="text-lg font-semibold mb-4">Missing ({allMissing.length})</h3>
            {viewType === 'list' ? (
              <div className="space-y-2">
                {allMissing.map((album, idx) => (
                  <MissingAlbumListItem
                    key={album.musicbrainz_id || idx}
                    album={album}
                    artistName={selectedArtist.name}
                    onDismiss={onDismissMissingAlbum ? () => onDismissMissingAlbum(album, selectedArtist.name, selectedArtist.musicbrainz_id) : undefined}
                  />
                ))}
              </div>
            ) : (
              <VirtuosoGrid
                style={{ height: '100%' }}
                data={allMissing}
                useWindowScroll={!scrollElement}
                customScrollParent={scrollElement || undefined}
                listClassName="grid gap-6"
                itemClassName="focus-poster-only"
                components={{
                  List: React.forwardRef<HTMLDivElement, any>(({ style, children, className }, ref) => (
                    <div
                      ref={ref}
                      className={className}
                      style={{ ...style, gridTemplateColumns: `repeat(auto-fill, minmax(${posterMinWidth}px, 1fr))` }}
                    >
                      {children}
                    </div>
                  )),
                  Item: ({ children, ...props }) => <div {...props}>{children}</div>
                }}
                itemContent={(index, album) => (
                  <MissingAlbumCard
                    key={album.musicbrainz_id || index}
                    album={album}
                    artistName={selectedArtist.name}
                    onDismiss={onDismissMissingAlbum ? () => onDismissMissingAlbum(album, selectedArtist.name, selectedArtist.musicbrainz_id) : undefined}
                  />
                )}
              />
            )}
          </div>
        )
      })()}
    </div>
  )
}
