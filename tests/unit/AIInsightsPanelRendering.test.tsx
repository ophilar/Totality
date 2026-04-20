/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { AIInsightsPanel } from '../../src/renderer/src/components/library/AIInsightsPanel'
import React from 'react'

// Mock SimpleMarkdown
vi.mock('../ui/SimpleMarkdown', () => ({
  SimpleMarkdown: ({ text }: { text: string }) => <div data-testid="markdown">{text}</div>,
}))

// Mock window.electronAPI
const mockElectronAPI = {
  aiIsConfigured: vi.fn().mockResolvedValue(true),
  aiQualityReport: vi.fn().mockResolvedValue({}),
  aiUpgradePriorities: vi.fn().mockResolvedValue({}),
  aiCompletenessInsights: vi.fn().mockResolvedValue({}),
  aiWishlistAdvice: vi.fn().mockResolvedValue({}),
  onAiAnalysisStreamDelta: vi.fn().mockReturnValue(() => {}),
  onAiAnalysisStreamComplete: vi.fn().mockReturnValue(() => {}),
  onSettingsChanged: vi.fn().mockReturnValue(() => {}),
}
vi.stubGlobal('window', { electronAPI: mockElectronAPI })

describe('AIInsightsPanel Rendering', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should not render when closed', () => {
    render(<AIInsightsPanel isOpen={false} onClose={() => {}} />)
    expect(screen.queryByText('AI Insights')).toBeNull()
  })

  it('should render selection list when configured and open', async () => {
    render(<AIInsightsPanel isOpen={true} onClose={() => {}} />)
    
    expect(await screen.findByText('Quality Report')).toBeTruthy()
    expect(screen.getByText('Upgrade Priorities')).toBeTruthy()
  })

  it('should show "not configured" state', async () => {
    mockElectronAPI.aiIsConfigured.mockResolvedValueOnce(false)
    
    render(<AIInsightsPanel isOpen={true} onClose={() => {}} />)
    
    expect(await screen.findByText('Gemini AI not configured')).toBeTruthy()
  })

  it('should call generation API when report selected', async () => {
    render(<AIInsightsPanel isOpen={true} onClose={() => {}} />)
    
    const btn = await screen.findByText('Quality Report')
    fireEvent.click(btn)
    
    expect(mockElectronAPI.aiQualityReport).toHaveBeenCalled()
    expect(screen.getByText('Analyzing your library...')).toBeTruthy()
  })

  it('should handle streaming deltas', async () => {
    let deltaCallback: any
    mockElectronAPI.onAiAnalysisStreamDelta.mockImplementation((cb) => {
      deltaCallback = cb
      return () => {}
    })

    let capturedRequestId: string | null = null
    mockElectronAPI.aiQualityReport.mockImplementation(async ({ requestId }: { requestId: string }) => {
      capturedRequestId = requestId
      return {}
    })

    render(<AIInsightsPanel isOpen={true} onClose={() => {}} />)
    
    const btn = await screen.findByText('Quality Report')
    
    // Select report to get active request ID
    fireEvent.click(btn)
    
    // Simulate delta with the correct requestId
    await act(async () => {
      deltaCallback({ requestId: capturedRequestId, delta: 'Hello World' })
    })
    
    expect(screen.getByText(/Hello World/)).toBeTruthy()
  })
})
