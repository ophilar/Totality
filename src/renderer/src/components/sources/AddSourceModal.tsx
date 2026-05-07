/**
 * AddSourceModal Component
 *
 * Modal for adding a new media source with provider-specific auth flows.
 */

import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { Server, HardDrive, Music } from 'lucide-react'
import { useSources } from '@/contexts/SourceContext'
import { ProviderType } from '@main/types/database'
import { PROVIDERS, SUPPORTED_PROVIDERS } from '@main/constants/providers'
import { useFocusTrap } from '@/hooks/useFocusTrap'
import { PlexAuthFlow } from '@/components/sources/PlexAuthFlow'
import { JellyfinAuthFlow } from '@/components/sources/JellyfinAuthFlow'
import { KodiConnectionFlow } from '@/components/sources/KodiConnectionFlow'
import { LocalFolderFlow } from '@/components/sources/LocalFolderFlow'
import { MediaMonkeyFlow } from '@/components/sources/MediaMonkeyFlow'

interface AddSourceModalProps {
  onClose: () => void
  onSuccess: () => void
}

export function AddSourceModal({ onClose, onSuccess }: AddSourceModalProps) {
  const { supportedProviders } = useSources()
  const [selectedProvider, setSelectedProvider] = useState<ProviderType | null>(null)
  const [focusedIndex, setFocusedIndex] = useState(0)
  const buttonRefs = useRef<(HTMLButtonElement | null)[]>([])
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const modalRef = useRef<HTMLDivElement>(null!)

  // Focus trap and modal registration
  useFocusTrap(true, modalRef as React.RefObject<HTMLElement>, false)

  // Use SSOT for available providers
  const availableProviders = useMemo(() => {
    return SUPPORTED_PROVIDERS.filter(p => 
      supportedProviders.includes(p.type) && 
      [ProviderType.Plex, ProviderType.Jellyfin, ProviderType.Emby, ProviderType.Kodi, ProviderType.Local, ProviderType.MediaMonkey].includes(p.type)
    )
  }, [supportedProviders])

  // Auto-focus first button when modal opens
  useEffect(() => {
    if (!selectedProvider && buttonRefs.current[0]) {
      buttonRefs.current[0]?.focus()
    }
  }, [selectedProvider, availableProviders])

  // Handle keyboard navigation in provider list
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (selectedProvider) return

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        setFocusedIndex(prev => {
          const next = Math.min(prev + 1, availableProviders.length - 1)
          buttonRefs.current[next]?.focus()
          return next
        })
        break
      case 'ArrowUp':
        e.preventDefault()
        setFocusedIndex(prev => {
          const next = Math.max(prev - 1, 0)
          buttonRefs.current[next]?.focus()
          return next
        })
        break
      case 'Escape':
        e.preventDefault()
        onClose()
        break
    }
  }, [selectedProvider, availableProviders.length, onClose])

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose()
  }

  const handleSuccess = () => onSuccess()

  const renderAuthFlow = () => {
    switch (selectedProvider) {
      case ProviderType.Plex:
        return <PlexAuthFlow onSuccess={handleSuccess} onBack={() => setSelectedProvider(null)} />
      case ProviderType.Jellyfin:
        return <JellyfinAuthFlow onSuccess={handleSuccess} onBack={() => setSelectedProvider(null)} />
      case ProviderType.Emby:
        return <JellyfinAuthFlow onSuccess={handleSuccess} onBack={() => setSelectedProvider(null)} isEmby />
      case ProviderType.Kodi:
        return <KodiConnectionFlow onSuccess={handleSuccess} onBack={() => setSelectedProvider(null)} />
      case ProviderType.Local:
        return <LocalFolderFlow onSuccess={handleSuccess} onBack={() => setSelectedProvider(null)} />
      case ProviderType.MediaMonkey:
        return <MediaMonkeyFlow onSuccess={handleSuccess} onBack={() => setSelectedProvider(null)} />
      default:
        return null
    }
  }

  return (
    <div
      className="fixed inset-0 bg-black/60 flex items-center justify-center z-150"
      role="dialog"
      aria-modal="true"
      aria-labelledby="add-source-modal-title"
      onClick={handleBackdropClick}
      onKeyDown={handleKeyDown}
    >
      <div ref={modalRef} className="bg-card rounded-xl shadow-xl w-full max-w-xs mx-4 max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between px-3 py-2 border-b border-border/30 bg-sidebar-gradient rounded-t-xl">
          <h2 id="add-source-modal-title" className="text-sm font-semibold">
            {selectedProvider
              ? `Add ${PROVIDERS[selectedProvider]?.name}`
              : 'Add Source'}
          </h2>
          <button
            ref={closeButtonRef}
            onClick={onClose}
            className="w-6 h-6 rounded-full hover:bg-muted flex items-center justify-center text-muted-foreground hover:text-foreground outline-hidden"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className={selectedProvider ? 'p-4' : 'p-2'}>
          {selectedProvider ? (
            renderAuthFlow()
          ) : (
            <div className="space-y-1">
              {availableProviders.map((provider, index) => (
                <button
                  key={provider.type}
                  ref={el => { buttonRefs.current[index] = el }}
                  onClick={() => setSelectedProvider(provider.type)}
                  onFocus={() => setFocusedIndex(index)}
                  className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-muted transition-colors text-left outline-hidden focus:ring-2 focus:ring-primary focus:ring-offset-2 focus:ring-offset-background ${focusedIndex === index ? 'bg-muted' : ''}`}
                >
                  <div className={`w-6 h-6 ${provider.color} rounded flex items-center justify-center text-white`}>
                    {provider.type === ProviderType.Local ? (
                      <HardDrive className="w-3.5 h-3.5" />
                    ) : provider.type === ProviderType.MediaMonkey ? (
                      <Music className="w-3.5 h-3.5" />
                    ) : (
                      <Server className="w-3.5 h-3.5" />
                    )}
                  </div>
                  <span className="text-sm">{provider.name}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
