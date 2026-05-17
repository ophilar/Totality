/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react'
import { ServicesTab } from '@/components/settings/tabs/ServicesTab'
import { DataManagementTab } from '@/components/settings/tabs/DataManagementTab'
import { TroubleshootTab } from '@/components/settings/tabs/TroubleshootTab'
import { OnboardingWizard } from '@/components/onboarding/OnboardingWizard'
import { setupTestDb, cleanupTestDb, setupRealIntegratedBridge } from '@tests/TestUtils'
import { ToastProvider } from '@/contexts/ToastContext'
import { SourceProvider } from '@/contexts/SourceContext'
import { ThemeProvider } from '@/contexts/ThemeContext'
import React from 'react'

describe('Settings Tabs Deep Dive (Integrated Stack)', () => {
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

  describe('ServicesTab', () => {
    it('should render and expand service cards', async () => {
        await act(async () => {
            renderWithProviders(<ServicesTab />)
        })

        expect(screen.getByText(/Configure external services/i)).toBeTruthy()
        
        const tmdbCard = screen.getByText(/TMDB API/i)
        await act(async () => {
            fireEvent.click(tmdbCard)
        })

        expect(screen.getByPlaceholderText(/Enter your TMDB API key/i)).toBeTruthy()
    })
  })

  describe('DataManagementTab', () => {
    it('should render and show database location', async () => {
        await act(async () => {
            renderWithProviders(<DataManagementTab />)
        })

        expect(screen.getByText(/Database Location/i)).toBeTruthy()
        expect(screen.getByText(/Working Document/i)).toBeTruthy()
    })
  })

  describe('TroubleshootTab', () => {
    it('should render logs and toggles', async () => {
        await act(async () => {
            renderWithProviders(<TroubleshootTab />)
        })

        expect(screen.getByText(/Application Logs/i)).toBeTruthy()
        expect(screen.getAllByText(/Verbose/i).length).toBeGreaterThan(0)
    })
  })

  describe('OnboardingWizard', () => {
    it('should render and navigate pages', async () => {
        const onComplete = vi.fn()
        const onAddSource = vi.fn()

        await act(async () => {
            renderWithProviders(<OnboardingWizard onComplete={onComplete} onAddSource={onAddSource} />)
        })

        expect(screen.getByText(/Welcome to Totality/i)).toBeTruthy()
        
        const nextBtn = screen.getByText(/Get Started/i)
        await act(async () => {
            fireEvent.click(nextBtn)
        })

        expect(screen.getByText(/Quality Audit/i)).toBeTruthy()
    })
  })
})
