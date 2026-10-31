import React from 'react'
import { formatOptimizationBytes } from './transcoding/optimizationResults'

export interface EstimatedSavingsDisplayProps {
  bytes?: number | null
  className?: string
}

export const EstimatedSavingsDisplay: React.FC<EstimatedSavingsDisplayProps> = ({
  bytes,
  className = '',
}) => {
  if (bytes == null) {
    return <span className={`text-xs text-muted-foreground ${className}`}>Not measured</span>
  }

  const value = formatOptimizationBytes(bytes)

  return (
    <span className={`text-xs font-medium text-orange-500 font-mono ${className}`}>
      {value}
    </span>
  )
}
