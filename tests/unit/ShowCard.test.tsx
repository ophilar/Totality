/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import React from 'react'
import { ShowCard } from '@/components/library/tv/ShowCard'
import type { TVShowSummary } from '@/components/library/types'

describe('ShowCard', () => {
  const baseShow: TVShowSummary = {
    series_title: 'Severance',
    episode_count: 9,
    season_count: 1,
    total_episodes: 9,
    total_seasons: 1,
    total_size: 15 * 1024 * 1024 * 1024,
    weighted_efficiency: null,
    total_recoverable_bytes: undefined,
    evidence_status: undefined,
  }

  it('re-renders when weighted_efficiency updates on the show prop', () => {
    const { rerender } = render(
      <ShowCard
        show={baseShow}
        onClick={vi.fn()}
      />
    )

    // Initially efficiency is null, so it renders '--'
    expect(screen.getAllByText('--').length).toBeGreaterThan(0)

    // Pass a new show object with updated weighted_efficiency
    const updatedShow: TVShowSummary = {
      ...baseShow,
      weighted_efficiency: 85,
    }

    rerender(
      <ShowCard
        show={updatedShow}
        onClick={vi.fn()}
      />
    )

    expect(screen.getByText('85%')).toBeDefined()
  })

  it('re-renders when total_recoverable_bytes updates on the show prop', () => {
    const { rerender } = render(
      <ShowCard
        show={baseShow}
        onClick={vi.fn()}
      />
    )

    const updatedShow: TVShowSummary = {
      ...baseShow,
      total_recoverable_bytes: 5 * 1024 * 1024 * 1024,
    }

    rerender(
      <ShowCard
        show={updatedShow}
        onClick={vi.fn()}
      />
    )

    expect(screen.getByText('5 GB')).toBeDefined()
  })

  it('re-renders when evidence_status updates on the show prop', () => {
    const { rerender } = render(
      <ShowCard
        show={baseShow}
        onClick={vi.fn()}
      />
    )

    const updatedShow: TVShowSummary = {
      ...baseShow,
      evidence_status: 'measured',
    }

    rerender(
      <ShowCard
        show={updatedShow}
        onClick={vi.fn()}
      />
    )

    expect(screen.getByText('Measured')).toBeDefined()
  })

  it('triggers onAnalyzeSeries from menu action', async () => {
    const onAnalyzeSeries = vi.fn().mockResolvedValue(undefined)

    render(
      <ShowCard
        show={baseShow}
        onClick={vi.fn()}
        onAnalyzeSeries={onAnalyzeSeries}
      />
    )

    const menuButton = screen.getByRole('button')
    fireEvent.click(menuButton)

    const analyzeOption = screen.getByText('Analyze Series')
    expect(analyzeOption).toBeDefined()
    await fireEvent.click(analyzeOption)
    expect(onAnalyzeSeries).toHaveBeenCalledTimes(1)
  })

  it('triggers onTranscodeShow from menu action without calling onAnalyzeSeries', () => {
    const onAnalyzeSeries = vi.fn()
    const onTranscodeShow = vi.fn()

    render(
      <ShowCard
        show={baseShow}
        onClick={vi.fn()}
        onAnalyzeSeries={onAnalyzeSeries}
        onTranscodeShow={onTranscodeShow}
      />
    )

    const menuButton = screen.getByRole('button')
    fireEvent.click(menuButton)

    const optimizeOption = screen.getByText('Optimize Series')
    expect(optimizeOption).toBeDefined()
    fireEvent.click(optimizeOption)
    expect(onTranscodeShow).toHaveBeenCalledTimes(1)
    expect(onAnalyzeSeries).not.toHaveBeenCalled()
  })
})
