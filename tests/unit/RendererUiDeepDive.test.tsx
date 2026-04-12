/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { QualityBadges } from '../../src/renderer/src/components/library/QualityBadges'
import { ToastContainer } from '../../src/renderer/src/components/ui/Toast'
import { ToastProvider, useToast } from '../../src/renderer/src/contexts/ToastContext'
import { SimpleMarkdown } from '../../src/renderer/src/components/ui/SimpleMarkdown'
import React from 'react'

// Helper component to trigger toasts
function ToastTrigger() {
  const { addToast } = useToast()
  return React.createElement('button', { 
    onClick: () => addToast({ title: 'Test Toast', type: 'success' }) 
  }, 'Trigger')
}

describe('Renderer UI Components', () => {
  describe('Toast System', () => {
    it('should render and remove toasts', async () => {
      render(
        React.createElement(ToastProvider, null, 
          React.createElement(ToastContainer),
          React.createElement(ToastTrigger)
        )
      )

      const btn = screen.getByText('Trigger')
      fireEvent.click(btn)

      expect(screen.getByText('Test Toast')).toBeTruthy()

      const closeBtn = screen.getByLabelText('Close toast')
      fireEvent.click(closeBtn)

      // Wait for animation
      await act(async () => {
        await new Promise(r => setTimeout(r, 300))
      })

      expect(screen.queryByText('Test Toast')).toBeNull()
    })
  })

  describe('SimpleMarkdown', () => {
    it('should render basic markdown patterns', () => {
      const text = '# Header\n**Bold**\n- List Item'
      render(React.createElement(SimpleMarkdown, { text }))
      
      expect(screen.getByText('Header')).toBeTruthy()
      expect(screen.getByText('Bold')).toBeTruthy()
      expect(screen.getByText('List Item')).toBeTruthy()
    })
  })

  describe('QualityBadges (Extended)', () => {
    it('should render Dolby Vision badge', () => {
      const item: any = { hdr_format: 'Dolby Vision' }
      render(React.createElement(QualityBadges, { item }))
      expect(screen.getByText('Dolby Vision')).toBeTruthy()
    })

    it('should render HFR badge', () => {
      const item: any = { video_frame_rate: 60 }
      render(React.createElement(QualityBadges, { item }))
      expect(screen.getByText('60fps')).toBeTruthy()
    })
  })
})
