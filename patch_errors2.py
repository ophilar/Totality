import re
with open("src/renderer/src/components/library/MusicView.tsx", "r") as f:
    content = f.read()

content = content.replace("itemContent={(_, album) => (\n                    <MissingAlbumCard\n                      key={album.musicbrainz_id || index}", "itemContent={(index, album) => (\n                    <MissingAlbumCard\n                      key={album.musicbrainz_id || index}")

content = content.replace("itemContent={(_, album) => (", "itemContent={(index, album) => (")
content = content.replace("itemContent={(_, artist) => (", "itemContent={(index, artist) => (")
content = content.replace("itemContent={(_, track) => {", "itemContent={(index, track) => {")

with open("src/renderer/src/components/library/MusicView.tsx", "w") as f:
    f.write(content)
