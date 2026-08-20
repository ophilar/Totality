/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { TVShowDetails } from '@/components/library/tv/TVShowDetails'
import { ShowTranscodeModal } from '@/components/library/ShowTranscodeModal'
import { ToastProvider } from '@/contexts/ToastContext'
import React from 'react'

import type { TVShow, TVShowSummary } from '@/components/library/types'

// Mock react-virtuoso
vi.mock('react-virtuoso', () => ({
  Virtuoso: ({ data, itemContent }: { data?: unknown[]; itemContent: (index: number, item: unknown) => React.ReactNode }) => (
    <div data-testid="virtuoso-list">
      {data?.map((item, index) => (
        <div key={index}>{itemContent(index, item)}</div>
      ))}
    </div>
  ),
}))

describe('TVShowDetails & ShowTranscodeModal Optimization Flow', () => {
  beforeEach(() => {
    Object.assign(window, {
      electronAPI: {
        log: { error: vi.fn(), info: vi.fn() },
        getSetting: vi.fn().mockResolvedValue(''),
        getCapabilities: vi.fn().mockResolvedValue({
          detectedAt: '2026-08-19T22:00:00Z',
          ffmpeg: true,
          gpus: [
            { id: 'gpu-nv-1', name: 'NVIDIA GeForce RTX 5070 Ti', vendor: 'NVIDIA' }
          ],
          selectedGpuId: 'gpu-nv-1',
          vendors: ['NVIDIA', 'Software'],
          encoders: ['nvenc_av1', 'nvenc_h265', 'x265'],
          verifiedEncoders: ['nvenc_av1', 'nvenc_h265'],
          probeFailures: [],
          engines: ['ffmpeg']
        }),
        setSelectedGpu: vi.fn().mockResolvedValue({ selectedGpuId: 'gpu-nv-1' }),
        tmdbGetTVShowDetails: vi.fn().mockResolvedValue({ overview: 'Test show overview' }),
        preflightShow: vi.fn().mockResolvedValue({
          preflightId: 'pref-123',
          batchId: 'batch-123',
          compatible: true,
          episodeCount: 5,
          episodes: []
        }),
        queueShow: vi.fn().mockResolvedValue({
          batchId: 'batch-123',
          queuedMediaItemIds: [1, 2, 3, 4, 5]
        })
      }
    })
  })

  const mockShowData: TVShow = {
    title: 'Star Trek: Strange New Worlds',
    poster_url: 'https://image.tmdb.org/poster.jpg',
    seasons: new Map([
      [
        1,
        {
          seasonNumber: 1,
          episodes: [
            {
              id: 101,
              title: 'Strange New Worlds',
              episode_number: 1,
              season_number: 1,
              source_id: 'src_local',
              file_path: 'H:/Media/STSNW/S01E01.mkv',
              resolution: '1080p',
              video_codec: 'h264'
            }
          ]
        }
      ]
    ])
  }

  it('renders "Optimize Series" button in TVShowDetails and triggers onTranscodeShow', () => {
    const handleTranscodeShow = vi.fn()

    render(
      <TVShowDetails
        selectedShow="Star Trek: Strange New Worlds"
        selectedShowData={mockShowData}
        selectedShowLoading={false}
        seriesCompleteness={new Map()}
        onBack={vi.fn()}
        onAnalyzeSeries={vi.fn()}
        filterItem={() => true}
        onSelectEpisode={vi.fn()}
        expandedRecommendations={new Set()}
        onToggleOptimize={vi.fn()}
        onMissingItemClick={vi.fn()}
        onTranscodeShow={handleTranscodeShow}
      />
    )

    const optimizeButton = screen.getByRole('button', { name: /optimize series/i })
    expect(optimizeButton).toBeTruthy()

    fireEvent.click(optimizeButton)
    expect(handleTranscodeShow).toHaveBeenCalledTimes(1)
    expect(handleTranscodeShow).toHaveBeenCalledWith(
      expect.objectContaining({
        series_title: 'Star Trek: Strange New Worlds',
        source_id: 'src_local'
      })
    )
  })

  it('renders ShowTranscodeModal with preset choices and triggers preflight + queue', async () => {
    const handleClose = vi.fn()
    const mockSummary: TVShowSummary = {
      series_title: 'Star Trek: Strange New Worlds',
      source_id: 'src_local',
      season_count: 1,
      episode_count: 1
    }

    render(
      <ToastProvider>
        <ShowTranscodeModal show={mockSummary} onClose={handleClose} />
      </ToastProvider>
    )

    expect(screen.getByText('Batch Optimize Series')).toBeTruthy()
    expect(screen.getByText('AV1')).toBeTruthy()
    expect(screen.getByText('HEVC (H.265)')).toBeTruthy()

    const queueButton = screen.getByRole('button', { name: /preflight & queue series/i })
    expect(queueButton).toBeTruthy()

    fireEvent.click(queueButton)

    await vi.waitFor(() => {
      expect(window.electronAPI.preflightShow).toHaveBeenCalledTimes(1)
      expect(window.electronAPI.queueShow).toHaveBeenCalledWith('pref-123')
    })

    // Verify transition to Live Series Optimization monitoring mode
    await vi.waitFor(() => {
      expect(screen.getByText('Live Series Optimization')).toBeTruthy()
      expect(screen.getByText('Run in Background')).toBeTruthy()
    })
  })
})
