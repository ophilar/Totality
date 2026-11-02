import React from 'react'
import { RefreshCw } from 'lucide-react'

export interface LibraryEmptyStateProps {
  isScanning: boolean
  scanProgress?: {
    phase: string
    currentItem?: string
  }
  totalCount: number
  icon: React.ComponentType<{ className?: string }>
  title: string
  description: string
}

export function LibraryEmptyState({
  isScanning,
  scanProgress,
  totalCount,
  icon: Icon,
  title,
  description
}: LibraryEmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center text-center p-12 animate-in fade-in duration-700">
      {isScanning ? (
        <div className="flex flex-col items-center">
          <div className="relative mb-6">
            <RefreshCw className="w-16 h-16 text-primary animate-spin" />
            <div className="absolute inset-0 flex items-center justify-center">
              <Icon className="w-6 h-6 text-primary/50" />
            </div>
          </div>
          <p className="text-primary text-xl font-bold tracking-tight">Scan in Progress</p>
          <p className="text-sm text-muted-foreground/70 mt-2 max-w-xs leading-relaxed">
            {scanProgress ? (
              <>
                Found <span className="text-foreground font-semibold">{totalCount}</span> items so far...
                <br />
                Currently <span className="text-primary font-medium">{scanProgress.phase}</span>
                {scanProgress.currentItem && (
                  <span className="block mt-1 italic text-[10px] truncate max-w-[200px] mx-auto opacity-80">
                    {scanProgress.currentItem}
                  </span>
                )}
              </>
            ) : (
              'Discovering items in your libraries...'
            )}
          </p>
        </div>
      ) : (
        <>
          <Icon className="w-24 h-24 text-muted-foreground/40 mb-6" />
          <p className="text-muted-foreground text-xl font-medium">{title}</p>
          <p className="text-sm text-muted-foreground/70 mt-2 max-w-xs leading-relaxed">{description}</p>
        </>
      )}
    </div>
  )
}
