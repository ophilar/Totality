/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { AddSourceModal } from '@/components/sources/AddSourceModal'
import { SourceProvider } from '@/contexts/SourceContext'
import { ToastProvider } from '@/contexts/ToastContext'
import { cleanupTestDb, setupRealIntegratedBridge, setupTestDb } from '@tests/TestUtils'
import React from 'react'

describe('AddSourceModal Rendering', () => {
  beforeEach(async () => {
    await setupTestDb()
    Object.assign(window, { electronAPI: setupRealIntegratedBridge().api })
  })

  afterEach(() => {
    cleanup()
    cleanupTestDb()
  })

  function renderAddSourceModal() {
    return render(
      <ToastProvider>
        <SourceProvider>
          <AddSourceModal onClose={() => {}} onSuccess={() => {}} />
        </SourceProvider>
      </ToastProvider>
    )
  }

  it('renders provider selection first', async () => {
    renderAddSourceModal()

    expect(await screen.findByText('Local Folder')).toBeTruthy()
    expect(screen.getByText('Plex')).toBeTruthy()
  })

  it('navigates to the local folder flow when selected', async () => {
    renderAddSourceModal()

    fireEvent.click(await screen.findByText('Local Folder'))

    expect(await screen.findByText('Add Local Folder')).toBeTruthy()
    expect(screen.getByText('Browse')).toBeTruthy()
  })
})
