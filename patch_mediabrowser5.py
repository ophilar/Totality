import re
with open("src/renderer/src/components/library/MediaBrowser.tsx", "r") as f:
    content = f.read()

content = content.replace("            includeSingles={includeSingles}\n          />", "            includeSingles={includeSingles}\n            scrollElement={scrollContainerRef.current}\n          />")

with open("src/renderer/src/components/library/MediaBrowser.tsx", "w") as f:
    f.write(content)
