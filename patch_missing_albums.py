import re
with open("src/renderer/src/components/library/MusicView.tsx", "r") as f:
    content = f.read()

# Missing Albums Grid
missing_albums_pattern = re.compile(r"""<div\s+className="grid gap-6"\s+style=\{\{\s*gridTemplateColumns:\s*`repeat\(auto-fill,\s*\$\{posterMinWidth\}px\)`\s*\}\}\s*>\s*\{allMissing\.map\(\(album,\s*idx\)\s*=>\s*\(\s*<MissingAlbumCard[\s\S]*?/>\s*\)\)\}\s*</div>""")

virtuoso_missing_albums = """<VirtuosoGrid
                  style={{ height: '100%' }}
                  data={allMissing}
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
                    <MissingAlbumCard
                      key={album.musicbrainz_id || index}
                      album={album}
                      artistName={selectedArtist.name}
                    />
                  )}
                />"""

if missing_albums_pattern.search(content):
    content = missing_albums_pattern.sub(virtuoso_missing_albums, content)
    print("Replaced missing albums grid.")
else:
    print("Missing albums grid not found.")

with open("src/renderer/src/components/library/MusicView.tsx", "w") as f:
    f.write(content)
