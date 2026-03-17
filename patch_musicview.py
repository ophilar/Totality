import re

with open("src/renderer/src/components/library/MusicView.tsx", "r") as f:
    content = f.read()

# Replace import
content = content.replace("import { FixedSizeList as VirtualList } from 'react-window'", "import { Virtuoso, VirtuosoGrid } from 'react-virtuoso'")

# Add scrollElement to props definition
content = re.sub(r'  includeSingles: boolean\n\}\)', r'  includeSingles: boolean\n  scrollElement?: HTMLElement | null\n})', content)

# Add scrollElement to props list
content = re.sub(r'  includeEps,\n  includeSingles\n\}: \{', r'  includeEps,\n  includeSingles,\n  scrollElement\n}: {', content)

# Remove albumSentinelRef and artistSentinelRef hooks entirely, replacing with just Virtuoso's endReached.
# Actually, I'll just remove the IntersectionObserver code.
intersection_observer_code = r"""  // IntersectionObserver for artist grid infinite scroll
  useEffect\(\(\) => \{
    if \(\!artistSentinelRef\.current \|\| musicViewMode \!\=\= 'artists'\) return
    const observer = new IntersectionObserver\(
      \(entries\) => \{
        if \(entries\[0\]\.isIntersecting\) \{
          onLoadMoreArtists\(\)
        \}
      \},
      \{ rootMargin: '400px' \}
    \)
    observer\.observe\(artistSentinelRef\.current\)
    return \(\) => observer\.disconnect\(\)
  \}, \[onLoadMoreArtists, musicViewMode\]\)

  // IntersectionObserver for album grid infinite scroll
  useEffect\(\(\) => \{
    if \(\!albumSentinelRef\.current \|\| musicViewMode \!\=\= 'albums' \|\| viewType \!\=\= 'grid'\) return
    const observer = new IntersectionObserver\(
      \(entries\) => \{
        if \(entries\[0\]\.isIntersecting\) \{
          onLoadMoreAlbums\(\)
        \}
      \},
      \{ rootMargin: '400px' \}
    \)
    observer\.observe\(albumSentinelRef\.current\)
    return \(\) => observer\.disconnect\(\)
  \}, \[onLoadMoreAlbums, musicViewMode, viewType\]\)"""

content = re.sub(intersection_observer_code, '', content)

# Remove the sentinel refs
content = content.replace("const albumSentinelRef = useRef<HTMLDivElement>(null)\n", "")
content = content.replace("const artistSentinelRef = useRef<HTMLDivElement>(null)\n", "")

with open("src/renderer/src/components/library/MusicView.tsx", "w") as f:
    f.write(content)
