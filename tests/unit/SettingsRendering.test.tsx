/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react'
import { SettingsPanel } from '@/components/settings/SettingsPanel'
import { setupTestDb, cleanupTestDb, setupRealIntegratedBridge } from '@tests/TestUtils'
import { registerDatabaseHandlers } from '@main/ipc/database'
import { registerSourceHandlers } from '@main/ipc/sources'
import { ToastProvider } from '@/contexts/ToastContext'
import { LibraryProvider } from '@/contexts/LibraryContext'
import { SourceProvider } from '@/contexts/SourceContext'
import React from 'react'

describe('Settings Rendering (Integrated Stack)', () => {
  let db: any

  beforeEach(async () => {
    // Explicitly define window for happy-dom if it's not correctly propagated
    if (typeof window === 'undefined') {
        (global as any).window = (global as any)
    }

    db = await setupTestDb()
    const bridge = setupRealIntegratedBridge()
    
    // Ensure both window and global have the API
    ;(window as any).electronAPI = bridge.api
    ;(globalThis as any).electronAPI = bridge.api

    registerDatabaseHandlers()
    registerSourceHandlers()
  })

  afterEach(async () => {
    await cleanupTestDb()
  })

  const renderSettings = async () => {
    let result: any
    await act(async () => {
        result = render(
            <ToastProvider>
                <LibraryProvider>
                <SourceProvider>
                    <SettingsPanel isOpen={true} onClose={() => {}} />
                </SourceProvider>
                </LibraryProvider>
            </ToastProvider>
        )
    })
    return result
  }

  it('should render the Settings title and tabs', async () => {
    await renderSettings()
    
    expect(screen.getByText('Settings')).toBeTruthy()
    expect(screen.getByText('General')).toBeTruthy()
    expect(screen.getByText('Quality')).toBeTruthy()
  })

  it('should load real settings from the database', async () => {
    // Set a specific setting in the real DB
    await db.config.setSetting('app_theme', 'dark')
    
    await renderSettings()
    
    await waitFor(() => {
        expect(screen.getByText(/General/)).toBeTruthy()
    })
  })

  it('should switch tabs when clicked', async () => {
    await renderSettings()
    
    const qualityTab = screen.getByText('Quality')
    await act(async () => {
        fireEvent.click(qualityTab)
    })
    
    await waitFor(() => {
        expect(screen.getByText(/Quality Thresholds/i)).toBeTruthy()
    })
  })
  
  it('should update real database when settings are changed', async () => {
    await renderSettings()
    
    // Expand the "Window Behavior" card first if it's not expanded by default
    // In our GeneralTab, expandedCards starts empty.
    const windowBehavior = screen.getByText(/Window Behavior/i)
    await act(async () => {
        fireEvent.click(windowBehavior)
    })

    await waitFor(() => {
        expect(screen.getByText(/Minimize to tray on close/i)).toBeTruthy()
    })
    
    // Find the toggle (it's a button with role switch)
    const toggle = screen.getByRole('switch', { name: /Minimize to tray on close/i })
    const initialState = toggle.getAttribute('aria-checked') === 'true'
    
    await act(async () => {
        fireEvent.click(toggle)
    })
    
    await waitFor(async () => {
        const updatedSetting = await db.config.getSetting('minimize_to_tray')
        expect(updatedSetting).toBe(!initialState ? 'true' : 'false')
    })
  })
})
