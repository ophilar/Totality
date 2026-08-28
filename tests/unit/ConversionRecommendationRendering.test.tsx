/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, beforeEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { ConversionRecommendation } from '@/components/library/ConversionRecommendation'
import type { MediaItem } from '@/components/library/types'
import type { OptimizationDecision } from '@main/services/OptimizationDecisionService'

const decision = (overrides: Partial<OptimizationDecision> = {}): OptimizationDecision => ({
  primaryAction: 'no-action',
  trackRemoval: {
    status: 'blocked',
    estimatedSavingsBytes: null,
    reason: 'Insufficient language evidence',
    retainedTrackIndexes: [],
    removableTrackIndexes: [],
    reviewRequiredTrackIndexes: [],
    tracks: [],
    originalLanguage: null,
    confidence: 'none',
    evidenceSources: [],
  },
  audioTranscode: {
    status: 'unavailable',
    estimatedSavingsBytes: null,
    reason: 'Audio estimate unavailable',
  },
  videoTranscode: {
    status: 'unavailable',
    estimatedSavingsBytes: null,
    reason: 'Video estimate unavailable',
  },
  ...overrides,
})

const item = { id: 901, title: 'Evidence Movie', type: 'movie' } as MediaItem

describe('ConversionRecommendation evidence rendering', () => {
  beforeEach(() => {
    vi.mocked(window.electronAPI.optimizationGetDecision).mockReset()
  })

  it('labels savings as estimated when an executable recommendation has a byte estimate', async () => {
    vi.mocked(window.electronAPI.optimizationGetDecision).mockResolvedValue(decision({
      primaryAction: 'transcode-video',
      videoTranscode: { status: 'executable', estimatedSavingsBytes: 2048, reason: 'Measured analysis supports a video transcode estimate' },
    }))

    render(<ConversionRecommendation item={item} />)

    await waitFor(() => expect(screen.getByText(/Estimated savings/)).toBeTruthy())
    expect(screen.getByRole('button', { name: 'Transcode video' })).toBeTruthy()
    expect(screen.getByText(/2 KB/)).toBeTruthy()
  })

  it('labels missing savings as insufficient evidence and exposes no optimization action', async () => {
    vi.mocked(window.electronAPI.optimizationGetDecision).mockResolvedValue(decision())

    render(<ConversionRecommendation item={{ ...item, id: 902 }} />)

    await waitFor(() => expect(screen.getAllByText('Insufficient evidence').length).toBeGreaterThan(0))
    expect(screen.queryByRole('button', { name: /audio tracks|transcode/i })).toBeNull()
    expect(screen.getByText('No executable disk optimization is available.')).toBeTruthy()
  })
})
