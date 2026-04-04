import React from 'react'

/**
 * Render inline markdown: bold, italic, inline code
 */
export function InlineMarkdown({ text }: { text: string }) {
  // Bold
  let parts: (string | React.ReactNode)[] = [text]

  const processFormat = (
    currentParts: (string | React.ReactNode)[],
    regex: RegExp,
    Tag: keyof React.JSX.IntrinsicElements,
    className?: string,
  ) => {
    const nextParts: (string | React.ReactNode)[] = []
    for (const part of currentParts) {
      if (typeof part !== 'string') {
        nextParts.push(part)
        continue
      }

      const segments = part.split(regex)
      for (let i = 0; i < segments.length; i++) {
        if (i % 2 === 1) {
          nextParts.push(
            React.createElement(Tag as any, { key: `fmt-${i}-${Math.random()}`, className }, segments[i]),
          )
        } else if (segments[i]) {
          nextParts.push(segments[i])
        }
      }
    }
    return nextParts
  }

  // Code
  parts = processFormat(parts, /`([^`]+)`/g, 'code', 'bg-background/80 px-1 rounded text-[0.9em]')
  // Bold
  parts = processFormat(parts, /\*\*([^*]+)\*\*/g, 'strong')
  // Italic
  parts = processFormat(parts, /\*([^*]+)\*/g, 'em')

  return <>{parts}</>
}

interface SimpleMarkdownProps {
  text: string
  className?: string
  onCopyCode?: (content: string) => void
  renderCodeBlock?: (content: string, language?: string) => React.ReactNode
}

/**
 * Simple markdown renderer for AI-generated text.
 * Handles: bold, italic, code blocks, inline code, lists, headings, and line breaks.
 */
export function SimpleMarkdown({ text, className = '', renderCodeBlock }: SimpleMarkdownProps) {
  const lines = text.split('\n')
  const elements: React.ReactNode[] = []
  let inCodeBlock = false
  let codeBlockContent: string[] = []
  let codeBlockLanguage: string | undefined

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    // Code block start/end
    if (line.startsWith('```')) {
      if (inCodeBlock) {
        if (renderCodeBlock) {
          elements.push(renderCodeBlock(codeBlockContent.join('\n'), codeBlockLanguage))
        } else {
          elements.push(
            <pre key={`code-${i}`} className="bg-background/50 rounded p-2 text-xs overflow-x-auto my-1">
              <code>{codeBlockContent.join('\n')}</code>
            </pre>,
          )
        }
        codeBlockContent = []
        codeBlockLanguage = undefined
        inCodeBlock = false
      } else {
        inCodeBlock = true
        codeBlockLanguage = line.slice(3).trim() || undefined
      }
      continue
    }

    if (inCodeBlock) {
      codeBlockContent.push(line)
      continue
    }

    // Empty line = paragraph break
    if (line.trim() === '') {
      elements.push(<br key={`br-${i}`} />)
      continue
    }

    // Headings
    const headingMatch = line.match(/^(#{1,4})\s+(.+)/)
    if (headingMatch) {
      const level = headingMatch[1].length
      const content = headingMatch[2]
      const Tag = `h${Math.min(level + 2, 6)}` as any
      elements.push(
        <Tag key={`h-${i}`} className="font-semibold mt-2 mb-1">
          <InlineMarkdown text={content} />
        </Tag>,
      )
      continue
    }

    // Lists
    const listMatch = line.match(/^(\s*)([-*]|\d+\.)\s+(.+)/)
    if (listMatch) {
      const content = listMatch[3]
      elements.push(
        <div key={`li-${i}`} className="flex gap-1.5 ml-2">
          <span className="text-muted-foreground shrink-0">•</span>
          <span><InlineMarkdown text={content} /></span>
        </div>,
      )
      continue
    }

    // Plain text line
    elements.push(<div key={`p-${i}`} className="my-0.5"><InlineMarkdown text={line} /></div>)
  }

  return <div className={className}>{elements}</div>
}
