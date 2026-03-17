import re
with open("src/renderer/src/components/library/MediaBrowser.tsx", "r") as f:
    content = f.read()

# Add scrollElement prop to MusicView
music_view_pattern = r'(<MusicView\s*[\s\S]*?includeEps=\{includeEps\}\s*includeSingles=\{includeSingles\})'
replacement = r'\1\n              scrollElement={scrollContainerRef.current}'
content = re.sub(music_view_pattern, replacement, content)

with open("src/renderer/src/components/library/MediaBrowser.tsx", "w") as f:
    f.write(content)
