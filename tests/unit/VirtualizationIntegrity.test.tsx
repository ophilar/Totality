/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import React, { useState } from 'react'

// Mock sub-components that receive scrollElement
const MockChild = vi.fn(({ scrollElement }: { scrollElement: HTMLElement | null }) => {
  return <div data-testid="child">{scrollElement ? 'CONNECTED' : 'DISCONNECTED'}</div>
})

function Parent() {
  const [scrollElement, setScrollElement] = useState<HTMLDivElement | null>(null)
  
  return (
    <div className="h-screen overflow-auto">
      <div ref={setScrollElement} data-testid="scroll-container">
        <MockChild scrollElement={scrollElement} />
      </div>
    </div>
  )
}

describe('UI Virtualization Integrity', () => {
  it('should reactive-bind the scroll element after mount', async () => {
    render(<Parent />)

    // On first pass, it might be null, but React should re-render immediately after ref is set
    await waitFor(() => {
      expect(screen.getByTestId('child').textContent).toBe('CONNECTED')
    })
    
    // Verify the mock was called with a real element
    const lastCall = MockChild.mock.calls[MockChild.mock.calls.length - 1][0]
    expect(lastCall.scrollElement).toBeInstanceOf(HTMLElement)
  })
})
