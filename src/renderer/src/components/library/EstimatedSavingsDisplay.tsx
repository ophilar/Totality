import React from 'react'

export interface EstimatedSavingsDisplayProps {
  bytes?: number | null
  className?: string
}

export const EstimatedSavingsDisplay: React.FC<EstimatedSavingsDisplayProps> = ({
  bytes,
  className = '',
}) => {
  if (bytes == null) {
    return <span className={`text-xs text-muted-foreground font-mono ${className}`}>--</span>
  }

  const value = bytes >= 1024 ** 3
    ? `${(bytes / 1024 ** 3).toFixed(1)} GB`
    : `${(bytes / 1024 ** 2).toFixed(1)} MB`

  return (
    <span className={`text-xs font-medium text-orange-500 font-mono ${className}`} title={`Estimated savings: ${value}`}>
      {value}
    </span>
  )
}
