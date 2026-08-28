/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { TVShowDetails } from '@/components/library/tv/TVShowDetails'
import { ShowTranscodeModal } from '@/components/library/ShowTranscodeModal'
import { ToastProvider } from '@/contexts/ToastContext'
import React, { act } from 'react'

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
        seriesGetEpisodes: vi.fn().mockResolvedValue([
          { id: 101, title: 'Episode 1', original_language: 'ja' }
        ]),
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

  afterEach(() => {
    cleanup()
  })

  async function renderShowTranscodeModal(show: TVShowSummary, onClose: () => void) {
    await act(async () => {
      render(
        <ToastProvider>
          <ShowTranscodeModal show={show} onClose={onClose} />
        </ToastProvider>
      )
      await Promise.resolve()
    })
  }

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

    await renderShowTranscodeModal(mockSummary, handleClose)

    expect(screen.getByText('Batch Optimize Series')).toBeTruthy()
    expect(screen.getByText('AV1')).toBeTruthy()
    expect(screen.getByText('HEVC (H.265)')).toBeTruthy()

    // Verify original language dropdown
    await vi.waitFor(() => {
      const languageSelect = screen.getByRole('combobox', { name: /original language/i }) as HTMLSelectElement
      expect(languageSelect).toBeTruthy()
      expect(languageSelect.value).toBe('ja')
    })

    const queueButton = screen.getByRole('button', { name: /preflight & queue series/i })
    expect(queueButton).toBeTruthy()

    await act(async () => {
      fireEvent.click(queueButton)
      await Promise.resolve()
    })

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

  it('allows selecting optimization modes (Smart, Remux Only, Full Transcode) and configures subtitle whitelist', async () => {
    const handleClose = vi.fn()
    const mockSummary: TVShowSummary = {
      series_title: 'Star Trek: Strange New Worlds',
      source_id: 'src_local',
      season_count: 1,
      episode_count: 1
    }

    await renderShowTranscodeModal(mockSummary, handleClose)

    // Wait for language to be auto-detected
    await vi.waitFor(() => {
      const languageSelect = screen.getByRole('combobox', { name: /original language/i }) as HTMLSelectElement
      expect(languageSelect.value).toBe('ja')
    })

    // Verify optimization strategy options
    expect(screen.getByText('Smart')).toBeTruthy()
    expect(screen.getByText('Audio & Subs Prune')).toBeTruthy()
    expect(screen.getByText('Full Transcode')).toBeTruthy()

    // Select Remux Only mode
    const remuxButton = screen.getByRole('button', { name: /Audio & Subs Prune/i })
    await act(async () => {
      fireEvent.click(remuxButton)
    })

    // Codec and GPU selection should be bypassed in remux only mode
    expect(screen.queryByText('Target Video Codec')).toBeNull()

    // Subtitle whitelist should be present with tags
    expect(screen.getByText(/Subtitle Language Whitelist/i)).toBeTruthy()
    expect(screen.getByText(/English \(eng\)/i)).toBeTruthy()

    // Add preset tag for Japanese
    const jpnPreset = screen.getByRole('button', { name: /^jpn/i })
    await act(async () => {
      fireEvent.click(jpnPreset)
    })

    const queueButton = screen.getByRole('button', { name: /preflight & queue series/i })
    await act(async () => {
      fireEvent.click(queueButton)
      await Promise.resolve()
    })

    await vi.waitFor(() => {
      expect(window.electronAPI.preflightShow).toHaveBeenCalledWith(
        expect.objectContaining({
          options: expect.objectContaining({
            optimizationMode: 'remux_only',
            streamSelection: expect.objectContaining({
              subtitleLanguageWhitelist: expect.arrayContaining(['eng', 'heb', 'spa', 'jpn'])
            })
          })
        })
      )
    })
  })

  it('renders preflight preview with TRaSH Source Tier and Advisory Badges before queueing', async () => {
    ;(window.electronAPI.preflightShow as ReturnType<typeof vi.fn>).mockResolvedValue({
      preflightId: 'pref-preview-1',
      batchId: 'batch-preview-1',
      compatible: true,
      episodeCount: 3,
      episodes: [
        {
          mediaItemId: 101,
          label: 'S01E01 - Strange New Worlds',
          compatible: true,
          hdrFormat: 'HDR10',
          sourceSize: 15000000000,
          sourceTier: 'Remux',
          recommendedAction: 'video_transcode',
          adviceReason: 'High bitrate AVC Remux benefits from video transcoding.'
        },
        {
          mediaItemId: 102,
          label: 'S01E02 - Children of the Comet',
          compatible: true,
          hdrFormat: 'SDR',
          sourceSize: 4500000000,
          sourceTier: 'WEB-DL',
          recommendedAction: 'stream_pruning',
          adviceReason: 'WEB-DL with secondary dub bloat. Stream pruning preserves video quality.'
        },
        {
          mediaItemId: 103,
          label: 'S01E03 - Ghosts of Illyria',
          compatible: true,
          hdrFormat: 'SDR',
          sourceSize: 2000000000,
          sourceTier: 'WEB-DL',
          recommendedAction: 'already_optimized',
          adviceReason: 'Already optimized efficient release.'
        }
      ]
    })

    const handleClose = vi.fn()
    const mockSummary: TVShowSummary = {
      series_title: 'Star Trek: Strange New Worlds',
      source_id: 'src_local',
      season_count: 1,
      episode_count: 3
    }

    await renderShowTranscodeModal(mockSummary, handleClose)

    // Wait for language to be auto-detected
    await vi.waitFor(() => {
      const languageSelect = screen.getByRole('combobox', { name: /original language/i }) as HTMLSelectElement
      expect(languageSelect.value).toBe('ja')
    })

    // Click Preview Plan
    const previewButton = screen.getByRole('button', { name: /preview plan/i })
    expect(previewButton).toBeTruthy()
    await act(async () => {
      fireEvent.click(previewButton)
      await Promise.resolve()
    })

    // Verify transition to Preview Plan screen
    await vi.waitFor(() => {
      expect(screen.getByText('Preflight Optimization Plan')).toBeTruthy()
      expect(screen.getByText('3 episodes analyzed; only evidenced actions can be queued')).toBeTruthy()
    })

    // Verify TRaSH Source Tier Badges
    expect(screen.getByText('Remux')).toBeTruthy()
    expect(screen.getAllByText('WEB-DL').length).toBe(2)

    // Verify TRaSH Advisory Badges
    expect(screen.getAllByText(/Video Transcode/i).length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText(/Lossless Stream Copy/i).length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText(/Already Optimized/i).length).toBeGreaterThanOrEqual(1)

    // Verify Advice Reasons
    expect(screen.getByText(/High bitrate AVC Remux benefits from video transcoding/i)).toBeTruthy()
    expect(screen.getByText(/Stream pruning preserves video quality/i)).toBeTruthy()

    // Click Queue All Episodes
    const queueEpisodesButton = screen.getByRole('button', { name: /queue all episodes \(3\)/i })
    expect(queueEpisodesButton).toBeTruthy()
    await act(async () => {
      fireEvent.click(queueEpisodesButton)
      await Promise.resolve()
    })

    await vi.waitFor(() => {
      expect(window.electronAPI.queueShow).toHaveBeenCalledWith('pref-preview-1')
      expect(screen.getByText('Live Series Optimization')).toBeTruthy()
    })
  })
})
