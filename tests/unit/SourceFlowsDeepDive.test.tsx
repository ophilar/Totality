/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react'
import { AddSourceModal } from '@/components/sources/AddSourceModal'
import { LocalFolderFlow } from '@/components/sources/LocalFolderFlow'
import { PlexAuthFlow } from '@/components/sources/PlexAuthFlow'
import { setupTestDb, cleanupTestDb, setupRealIntegratedBridge } from '@tests/TestUtils'
import { ToastProvider } from '@/contexts/ToastContext'
import { SourceProvider } from '@/contexts/SourceContext'
import { ThemeProvider } from '@/contexts/ThemeContext'
import React from 'react'

describe('Source Flows Deep Dive (Integrated Stack)', () => {
  let db: any

  beforeEach(async () => {
    if (typeof window === 'undefined') {
        (global as any).window = (global as any)
    }

    // Mock matchMedia for ThemeProvider
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation(query => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(), 
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });

    db = await setupTestDb()
    const bridge = setupRealIntegratedBridge()
    
    ;(window as any).electronAPI = bridge.api
    ;(globalThis as any).electronAPI = bridge.api
  })

  afterEach(async () => {
    vi.clearAllTimers()
    await cleanupTestDb()
  })

  const renderWithProviders = (ui: React.ReactElement) => {
    return render(
      <ToastProvider>
        <SourceProvider>
          <ThemeProvider>
            {ui}
          </ThemeProvider>
        </SourceProvider>
      </ToastProvider>
    )
  }

  describe('AddSourceModal', () => {
    it('should render provider selection', async () => {
        await act(async () => {
            renderWithProviders(<AddSourceModal isOpen={true} onClose={() => {}} onSourceAdded={() => {}} />)
        })

        // Wait for providers to load
        await waitFor(() => {
            expect(screen.getByText(/Add Source/i)).toBeTruthy()
            expect(screen.getByText(/Plex/i)).toBeTruthy()
            expect(screen.getByText(/Jellyfin/i)).toBeTruthy()
            expect(screen.getByText(/Local Folder/i)).toBeTruthy()
        })
    })

    it('should switch to Local Folder flow when clicked', async () => {
        await act(async () => {
            renderWithProviders(<AddSourceModal isOpen={true} onClose={() => {}} onSourceAdded={() => {}} />)
        })

        await waitFor(() => expect(screen.getByText(/Local Folder/i)).toBeTruthy())

        const localBtn = screen.getByText(/Local Folder/i)
        await act(async () => {
            fireEvent.click(localBtn)
        })

        expect(screen.getByText(/Add Local Folder/i)).toBeTruthy()
    })
  })

  describe('LocalFolderFlow', () => {
    it('should render and validate folder selection', async () => {
        await act(async () => {
            renderWithProviders(<LocalFolderFlow onSourceAdded={() => {}} onBack={() => {}} />)
        })

        expect(screen.getByText(/Select a folder/i)).toBeTruthy()
        expect(screen.getByText(/containing your media libraries/i)).toBeTruthy()
    })
  })

  describe('PlexAuthFlow', () => {
    it('should render and handle start auth', async () => {
        await act(async () => {
            renderWithProviders(<PlexAuthFlow onSuccess={() => {}} onBack={() => {}} />)
        })

        expect(screen.getByText(/How it works:/i)).toBeTruthy()
        
        const connectBtn = screen.getByRole('button', { name: /Sign in with Plex/i })
        await act(async () => {
            fireEvent.click(connectBtn)
        })

        await waitFor(() => {
            expect(screen.getByText(/Waiting for Plex/i)).toBeTruthy()
        })
    })
  })
})
