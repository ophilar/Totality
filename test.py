import re
with open("src/renderer/src/components/library/MusicView.tsx", "r") as f:
    content = f.read()

# Replace artists grid
# <div className="grid gap-6" style={{ gridTemplateColumns: `repeat(auto-fill, ${posterMinWidth}px)` }}>
#   {artists.map(artist => (...))}
# </div>
artists_grid_pattern = re.compile(r"""<div\s+className="grid gap-6"\s+style=\{\{\s*gridTemplateColumns:\s*`repeat\(auto-fill,\s*\$\{posterMinWidth\}px\)`\s*\}\}\s*>\s*\{artists\.map\(artist\s*=>\s*\(\s*<div\s+key=\{artist\.id\}\s+data-title=\{artist\.name\}>\s*<ArtistCard[\s\S]*?/>\s*</div>\s*\)\)\}\s*</div>""")

virtuoso_artists_grid = """<VirtuosoGrid
              style={{ height: '100%' }}
              data={artists}
              useWindowScroll={!scrollElement}
              customScrollParent={scrollElement || undefined}
              endReached={onLoadMoreArtists}
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
              itemContent={(index, artist) => (
                <div key={artist.id} data-title={artist.name}>
                  <ArtistCard
                    artist={artist}
                    onClick={() => onSelectArtist(artist)}
                    showSourceBadge={showSourceBadge}
                    onFixMatch={onFixArtistMatch ? () => onFixArtistMatch(artist.id, artist.name) : undefined}
                    onAnalyzeCompleteness={onAnalyzeArtist}
                  />
                </div>
              )}
            />"""

if artists_grid_pattern.search(content):
    content = artists_grid_pattern.sub(virtuoso_artists_grid, content)
    print("Replaced artists grid.")
else:
    print("Artists grid not found.")

with open("src/renderer/src/components/library/MusicView.tsx", "w") as f:
    f.write(content)
