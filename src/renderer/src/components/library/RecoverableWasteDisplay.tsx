import React from 'react'
import { formatBytes } from './mediaUtils'

export interface RecoverableWasteDisplayProps {
  bytes?: number | null
  className?: string
}

export const RecoverableWasteDisplay: React.FC<RecoverableWasteDisplayProps> = ({
  bytes,
  className = ''
}) => {
  if (bytes == null) {
    return (
      <span className={`text-xs text-muted-foreground font-mono ${className}`} title="Recoverable waste unavailable">
        --
      </span>
    )
  }

  if (bytes <= 0) {
    return (
      <span className={`text-xs text-muted-foreground font-medium ${className}`}>
        None
      </span>
    )
  }

  return (
    <span className={`text-xs font-medium text-orange-500 font-mono ${className}`} title={`Recoverable waste: ${formatBytes(bytes)}`}>
      {formatBytes(bytes)}
    </span>
  )
}
