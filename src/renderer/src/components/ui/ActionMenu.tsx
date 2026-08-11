import { useState, useCallback } from 'react'
import { MoreVertical, RefreshCw } from 'lucide-react'
import { useMenuClose } from '@/hooks/useMenuClose'

export interface MenuItem {
  id: string
  label: string
  icon?: React.ComponentType<{ className?: string }>
  onClick: (e: React.MouseEvent) => void | Promise<void>
  disabled?: boolean
  className?: string
}

export interface ActionMenuProps {
  items: MenuItem[]
  isWorking?: boolean
  buttonClassName?: string
  menuPosition?: 'left' | 'right'
}

export function ActionMenu({ items, isWorking = false, buttonClassName, menuPosition = 'right' }: ActionMenuProps) {
  const [isOpen, setIsOpen] = useState(false)
  const menuRef = useMenuClose({ isOpen, onClose: useCallback(() => setIsOpen(false), []) })

  return (
    <div ref={menuRef} className="relative z-20" onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          if (!isWorking) {
            setIsOpen(!isOpen)
          }
        }}
        className={buttonClassName || "w-7 h-7 rounded-full bg-black/60 hover:bg-black/80 flex items-center justify-center text-white opacity-0 group-hover:opacity-100 transition-opacity"}
      >
        {isWorking ? <RefreshCw className="w-4 h-4 animate-spin" /> : <MoreVertical className="w-4 h-4" />}
      </button>

      {isOpen && !isWorking && (
        <div className={`absolute top-8 ${menuPosition === 'left' ? 'left-0' : 'right-0'} bg-card border border-border rounded-md shadow-lg py-1 min-w-[160px] z-30`}>
          {items.map((item) => {
            const Icon = item.icon
            return (
              <button
                key={item.id}
                type="button"
                disabled={item.disabled}
                onClick={async (e) => {
                  e.stopPropagation()
                  setIsOpen(false)
                  await item.onClick(e)
                }}
                className={`w-full px-3 py-1.5 text-left text-sm hover:bg-muted flex items-center gap-2 ${item.className || ''}`}
              >
                {Icon && <Icon className="w-3.5 h-3.5" />}
                {item.label}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
