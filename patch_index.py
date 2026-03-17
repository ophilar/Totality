import re
with open("src/renderer/src/components/library/MusicView.tsx", "r") as f:
    content = f.read()

content = content.replace("itemContent={(index, artist) => (", "itemContent={(_index, artist) => (")
content = content.replace("itemContent={(index, album) => (", "itemContent={(_index, album) => (")

# Revert the MissingAlbumCard one so it actually uses index correctly:
content = content.replace("itemContent={(_index, album) => (\n                    <MissingAlbumCard\n                      key={album.musicbrainz_id || index}", "itemContent={(index, album) => (\n                    <MissingAlbumCard\n                      key={album.musicbrainz_id || index}")

with open("src/renderer/src/components/library/MusicView.tsx", "w") as f:
    f.write(content)
