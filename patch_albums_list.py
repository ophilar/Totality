import re
with open("src/renderer/src/components/library/MusicView.tsx", "r") as f:
    content = f.read()

# Virtualized Album List
albums_list_pattern = re.compile(r"""<VirtualList\s+height=\{Math\.max\(400, window\.innerHeight - 280\)\}\s+itemCount=\{allFilteredAlbums\.length\}\s+itemSize=\{104\}\s+width="100%"\s+className="scrollbar-visible"\s+itemData=\{\{\s*albums: allFilteredAlbums,\s*onSelectAlbum,\s*showSourceBadge,\s*allAlbumCompleteness\s*\}\}\s+onItemsRendered=\{[\s\S]*?\}\s*>\s*\{[\s\S]*?\}\s*</VirtualList>""")

virtuoso_albums_list = """<Virtuoso
                style={{ height: Math.max(400, window.innerHeight - 280) }}
                useWindowScroll={!scrollElement}
                customScrollParent={scrollElement || undefined}
                data={allFilteredAlbums}
                className="scrollbar-visible"
                endReached={onLoadMoreAlbums}
                itemContent={(index, album) => (
                  <div style={{ height: 104 }}>
                    <AlbumListItem
                      album={album}
                      onClick={() => onSelectAlbum(album)}
                      showArtist={true}
                      showSourceBadge={showSourceBadge}
                      completeness={album.id ? allAlbumCompleteness.get(album.id) : undefined}
                    />
                  </div>
                )}
              />"""

if albums_list_pattern.search(content):
    content = albums_list_pattern.sub(virtuoso_albums_list, content)
    print("Replaced albums virtual list.")
else:
    print("Albums virtual list not found.")

with open("src/renderer/src/components/library/MusicView.tsx", "w") as f:
    f.write(content)
