/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import { LibraryProvider, useLibrary } from '../../src/renderer/src/contexts/LibraryContext'
import React from 'react'

function LibraryTabController() {
  const { view, setView } = useLibrary()
  return React.createElement('div', null,
    React.createElement('span', null, `Current View: ${view}`),
    React.createElement('button', { onClick: () => setView('tv') }, 'Go To TV'),
    React.createElement('button', { onClick: () => setView('music') }, 'Go To Music'),
    React.createElement('button', { onClick: () => setView('movies') }, 'Go To Movies')
  )
}

describe('Library UI Routing Integrity', () => {
  beforeAll(() => {
    // Provide a real-ish bridge for settings
    const settings = new Map<string, string>()
    ;(window as any).electronAPI = {
      getSetting: (key: string) => Promise.resolve(settings.get(key) || null),
      setSetting: (key: string, val: string) => {
        settings.set(key, val)
        return Promise.resolve(true)
      }
    }
  })

  it('should synchronize media view state across components via LibraryContext', async () => {
    render(
      React.createElement(LibraryProvider, null,
        React.createElement(LibraryTabController)
      )
    )

    // Initial state should be movies (default)
    expect(screen.getByText('Current View: movies')).toBeTruthy()

    // Switch to TV
    await act(async () => {
      screen.getByText('Go To TV').click()
    })
    expect(screen.getByText('Current View: tv')).toBeTruthy()

    // Switch to Music
    await act(async () => {
      screen.getByText('Go To Music').click()
    })
    expect(screen.getByText('Current View: music')).toBeTruthy()

    // Switch back to Movies
    await act(async () => {
      screen.getByText('Go To Movies').click()
    })
    expect(screen.getByText('Current View: movies')).toBeTruthy()
  })
})
