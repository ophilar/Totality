import re
with open("src/renderer/src/components/library/MusicView.tsx", "r") as f:
    content = f.read()

# Add import React
if "import React" not in content:
    content = content.replace("import { useState, useEffect, useMemo, useCallback, memo, useRef } from 'react'", "import React, { useState, useEffect, useMemo, useCallback, memo, useRef } from 'react'")

# Remove sentinel refs usage that wasn't stripped properly
content = re.sub(r'<\s*div\s+ref=\{artistSentinelRef\}\s+className="h-1"\s*/>', '', content)
content = re.sub(r'<\s*div\s+ref=\{albumSentinelRef\}\s+className="h-1"\s*/>', '', content)

# Fix missing types on forwardRef
# React.forwardRef(({ style, children, className }, ref) -> React.forwardRef<HTMLDivElement, any>(({ style, children, className }, ref)
content = content.replace("React.forwardRef(({ style, children, className }, ref)", "React.forwardRef<HTMLDivElement, any>(({ style, children, className }, ref)")

# Replace (index, artist) -> (_, artist) or similarly just use it if index is unused, or just ignore TS6133 by putting it in _, or since tsconfig might have noUnusedParameters
content = content.replace("itemContent={(index, artist) => (", "itemContent={(_, artist) => (")
content = content.replace("itemContent={(index, album) => (", "itemContent={(_, album) => (")
content = content.replace("itemContent={(index, track) => {", "itemContent={(index, track) => {") # index used in track
content = content.replace("itemContent={(index, album) => {", "itemContent={(_, album) => {")

with open("src/renderer/src/components/library/MusicView.tsx", "w") as f:
    f.write(content)
