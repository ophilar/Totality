import re
with open("src/renderer/src/components/library/MusicView.tsx", "r") as f:
    content = f.read()

# Albums Grid when selectedArtist is active
albums_selected_pattern = re.compile(r"""<div\s+className="grid gap-6"\s+style=\{\{\s*gridTemplateColumns:\s*`repeat\(auto-fill,\s*\$\{posterMinWidth\}px\)`\s*\}\}\s*>\s*\{filteredAlbums\.map\(album\s*=>\s*\(\s*<AlbumCard[\s\S]*?/>\s*\)\)\}\s*</div>""")

virtuoso_albums_selected = """<VirtuosoGrid
              style={{ height: '100%' }}
              data={filteredAlbums}
              useWindowScroll={!scrollElement}
              customScrollParent={scrollElement || undefined}
              listClassName="grid gap-6"
              itemClassName="focus-poster-only"
              components={{
                List: React.forwardRef(({ style, children, className }, ref) => (
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
            />"""

if albums_selected_pattern.search(content):
    content = albums_selected_pattern.sub(virtuoso_albums_selected, content)
    print("Replaced selected artist albums grid.")
else:
    print("Selected artist albums grid not found.")

with open("src/renderer/src/components/library/MusicView.tsx", "w") as f:
    f.write(content)
