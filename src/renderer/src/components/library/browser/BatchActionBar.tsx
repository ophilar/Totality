
import React from 'react'
import { X, EyeOff, Zap, Star, Trash2 } from 'lucide-react'

interface BatchActionBarProps {
  selectedCount: number
  onClear: () => void
  onDismiss: () => void
  onTranscode: () => void
  onAddToWishlist: () => void
  onDelete?: () => void
}

export const BatchActionBar: React.FC<BatchActionBarProps> = ({
  selectedCount,
  onClear,
  onDismiss,
  onTranscode,
  onAddToWishlist,
  onDelete
}) => {
  if (selectedCount === 0) return null

  return (
    <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-50 animate-in fade-in slide-in-from-bottom-4 duration-300">
      <div className="bg-black/90 backdrop-blur-md border border-white/10 rounded-full shadow-2xl px-2 py-2 flex items-center gap-2">
        <div className="flex items-center gap-3 px-4 border-r border-white/10">
          <span className="text-sm font-medium text-white">{selectedCount} items selected</span>
          <button 
            onClick={onClear}
            className="p-1 hover:bg-white/10 rounded-full transition-colors text-white/60 hover:text-white"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex items-center gap-1 pr-2">
          <button
            onClick={onDismiss}
            className="flex items-center gap-2 px-4 py-2 hover:bg-white/10 rounded-full transition-colors text-sm text-white/80 hover:text-white"
          >
            <EyeOff className="w-4 h-4" />
            <span>Dismiss</span>
          </button>

          <button
            onClick={onTranscode}
            className="flex items-center gap-2 px-4 py-2 hover:bg-white/10 rounded-full transition-colors text-sm text-white/80 hover:text-white"
          >
            <Zap className="w-4 h-4" />
            <span>Transcode</span>
          </button>

          <button
            onClick={onAddToWishlist}
            className="flex items-center gap-2 px-4 py-2 hover:bg-white/10 rounded-full transition-colors text-sm text-white/80 hover:text-white"
          >
            <Star className="w-4 h-4" />
            <span>Wishlist</span>
          </button>

          {onDelete && (
            <button
              onClick={onDelete}
              className="flex items-center gap-2 px-4 py-2 hover:bg-red-500/20 rounded-full transition-colors text-sm text-red-400 hover:text-red-300"
            >
              <Trash2 className="w-4 h-4" />
              <span>Delete</span>
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
