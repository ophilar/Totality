import re
with open("src/renderer/src/components/library/MusicView.tsx", "r") as f:
    content = f.read()

# Virtualized Track List
tracks_list_pattern = re.compile(r"""<VirtualList\s+height=\{Math\.max\(400, window\.innerHeight - 280\)\}\s+itemCount=\{filteredTracks\.length\}\s+itemSize=\{40\}\s+width="100%"\s+className="scrollbar-visible"\s+onItemsRendered=\{[\s\S]*?\}\s+itemData=\{[\s\S]*?\}\s*>\s*\{[\s\S]*?\}\s*</VirtualList>""")

virtuoso_tracks_list = """<Virtuoso
                style={{ height: Math.max(400, window.innerHeight - 280) }}
                useWindowScroll={!scrollElement}
                customScrollParent={scrollElement || undefined}
                data={filteredTracks}
                className="scrollbar-visible"
                endReached={onLoadMoreTracks}
                itemContent={(index, track) => {
                  const albumInfo = track.album_id ? albumInfoMap.get(track.album_id) : undefined
                  const artistName = track.artist_id
                    ? artistNameMap.get(track.artist_id)
                    : albumInfo?.artistName
                  return (
                    <div style={{ height: 40 }}>
                      <TrackListItem
                        track={track}
                        index={index + 1}
                        artistName={artistName}
                        albumTitle={albumInfo?.title}
                        columnWidths={trackColumnWidths}
                        onClickQuality={() => {
                          const LOSSLESS_CODECS = ['flac', 'alac', 'wav', 'aiff', 'pcm', 'dsd', 'ape', 'wavpack', 'wv']
                          const codecLower = (track.audio_codec || '').toLowerCase()
                          const isLossless = track.is_lossless || LOSSLESS_CODECS.some(c => codecLower.includes(c))
                          const bitrateKbps = track.audio_bitrate || 0
                          const sampleRate = track.sample_rate || 0
                          const bitDepth = track.bit_depth || 16
                          const isAAC = codecLower.includes('aac')

                          let qualityTier: 'ultra' | 'high' | 'medium' | 'low' | null = null
                          if (isLossless && (bitDepth >= 24 || sampleRate > 48000)) qualityTier = 'ultra'
                          else if (isLossless) qualityTier = 'high'
                          else if (isAAC && bitrateKbps >= 128) qualityTier = 'medium'
                          else if (!isAAC && bitrateKbps >= 160) qualityTier = 'medium'
                          else if (bitrateKbps > 0) qualityTier = 'low'
                          else if (codecLower.includes('mp3') || codecLower.includes('aac') || codecLower.includes('ogg')) qualityTier = 'medium'

                          setSelectedTrackForQuality({
                            title: track.title,
                            codec: track.audio_codec,
                            bitrate: track.audio_bitrate,
                            sample_rate: track.sample_rate,
                            bit_depth: track.bit_depth,
                            is_lossless: track.is_lossless,
                            qualityTier,
                            artist_name: artistName,
                            album_title: albumInfo?.title
                          })
                        }}
                      />
                    </div>
                  )
                }}
              />"""

if tracks_list_pattern.search(content):
    content = tracks_list_pattern.sub(virtuoso_tracks_list, content)
    print("Replaced tracks virtual list.")
else:
    print("Tracks virtual list not found.")

with open("src/renderer/src/components/library/MusicView.tsx", "w") as f:
    f.write(content)
