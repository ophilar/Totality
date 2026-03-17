import re
with open("src/renderer/src/components/library/MusicView.tsx", "r") as f:
    content = f.read()

# Albums Grid
albums_grid_pattern = re.compile(r"""<div\s+className="grid gap-6"\s+style=\{\{\s*gridTemplateColumns:\s*`repeat\(auto-fill,\s*\$\{posterMinWidth\}px\)`\s*\}\}\s*>\s*\{allFilteredAlbums\.map\(album\s*=>\s*\(\s*<div\s+key=\{album\.id\}\s+data-title=\{album\.title\}>\s*<AlbumCard[\s\S]*?/>\s*</div>\s*\)\)\}\s*</div>""")

virtuoso_albums_grid = """<VirtuosoGrid
              style={{ height: '100%' }}
              data={allFilteredAlbums}
              useWindowScroll={!scrollElement}
              customScrollParent={scrollElement || undefined}
              endReached={onLoadMoreAlbums}
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
                <div key={album.id} data-title={album.title}>
                  <AlbumCard
                    album={album}
                    onClick={() => onSelectAlbum(album)}
                    showArtist={true}
                    showSourceBadge={showSourceBadge}
                    onAnalyze={onAnalyzeAlbum}
                    onFixMatch={onFixAlbumMatch && album.id ? () => onFixAlbumMatch(album.id!, album.title, album.artist_name || '') : undefined}
                    completeness={album.id ? allAlbumCompleteness.get(album.id) : undefined}
                  />
                </div>
              )}
            />"""

if albums_grid_pattern.search(content):
    content = albums_grid_pattern.sub(virtuoso_albums_grid, content)
    print("Replaced albums grid.")
else:
    print("Albums grid not found.")

with open("src/renderer/src/components/library/MusicView.tsx", "w") as f:
    f.write(content)
