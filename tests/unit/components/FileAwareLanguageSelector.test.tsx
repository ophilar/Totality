/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import React from 'react'
import { ShowTranscodeModal } from '@/components/library/ShowTranscodeModal'
import { TVShowDetails } from '@/components/library/tv/TVShowDetails'
import { formatLanguage } from '@/components/library/mediaUtils'
import { ToastProvider } from '@/contexts/ToastContext'
import type { TVShow, TVShowSummary } from '@/components/library/types'

// Mock react-virtuoso for TVShowDetails
vi.mock('react-virtuoso', () => ({
  Virtuoso: ({ data, itemContent }: { data?: unknown[]; itemContent: (index: number, item: unknown) => React.ReactNode }) => (
    <div data-testid="virtuoso-list">
      {data?.map((item, index) => (
        <div key={index}>{itemContent(index, item)}</div>
      ))}
    </div>
  ),
}))

describe('File-Aware Audio Language Detection with Provider Defaults', () => {
  afterEach(() => {
    cleanup()
  })

  beforeEach(() => {
    Object.assign(window, {
      electronAPI: {
        log: { error: vi.fn(), info: vi.fn() },
        getSetting: vi.fn().mockResolvedValue(''),
        getCapabilities: vi.fn().mockResolvedValue({
          detectedAt: '2026-08-25T22:00:00Z',
          ffmpeg: true,
          gpus: [],
          selectedGpuId: '',
          vendors: [],
          encoders: [],
          verifiedEncoders: [],
          probeFailures: [],
          engines: ['ffmpeg']
        }),
        seriesGetAudioLanguages: vi.fn().mockResolvedValue(['ja', 'en', 'und']),
        seriesGetEpisodes: vi.fn().mockResolvedValue([
          { id: 1, title: 'Ep 1', original_language: 'ja', audio_language: 'ja' }
        ]),
        preflightShow: vi.fn().mockResolvedValue({ compatible: true, preflightId: 'p1', episodes: [] }),
        queueShow: vi.fn().mockResolvedValue({ queuedMediaItemIds: [1] }),
        tmdbGetTVShowDetails: vi.fn().mockResolvedValue({ overview: 'Test overview' })
      }
    })
  })

  describe('formatLanguage helper', () => {
    it('formats ISO-639-1 (2-letter) codes to localized names', () => {
      expect(formatLanguage('ja')).toBe('Japanese')
      expect(formatLanguage('en')).toBe('English')
      expect(formatLanguage('de')).toBe('German')
      expect(formatLanguage('fr')).toBe('French')
    })

    it('formats ISO-639-2 (3-letter) codes to localized names', () => {
      expect(formatLanguage('jpn')).toBe('Japanese')
      expect(formatLanguage('eng')).toBe('English')
      expect(formatLanguage('deu')).toBe('German')
      expect(formatLanguage('fra')).toBe('French')
    })

    it('formats undetermined / untagged "und" code', () => {
      expect(formatLanguage('und')).toBe('Undetermined / Untagged')
    })

    it('handles null, undefined, or unknown codes gracefully', () => {
      expect(formatLanguage(null)).toBe('Unknown')
      expect(formatLanguage(undefined)).toBe('Unknown')
      expect(formatLanguage('')).toBe('Unknown')
    })
  })

  describe('ShowTranscodeModal File-Aware Language Selector', () => {
    it('dynamically populates dropdown with in-file audio languages under "Available in files" optgroup', async () => {
      const show: TVShowSummary = {
        series_title: 'Attack on Titan',
        source_id: 'src-1',
        season_count: 4,
        episode_count: 87
      }

      render(
        <ToastProvider>
          <ShowTranscodeModal show={show} onClose={vi.fn()} />
        </ToastProvider>
      )

      await waitFor(() => {
        expect(window.electronAPI.seriesGetAudioLanguages).toHaveBeenCalledWith('Attack on Titan', 'src-1')
      })

      const select = (await screen.findByLabelText(/original language/i)) as HTMLSelectElement
      expect(select).toBeTruthy()

      // Check for "Available in files" optgroup
      const optgroups = Array.from(select.querySelectorAll('optgroup'))
      const availableOptgroup = optgroups.find(og => og.label === 'Available in files')
      expect(availableOptgroup).toBeTruthy()

      const options = Array.from(availableOptgroup!.querySelectorAll('option')).map(o => o.textContent)
      // Contains Japanese, English, and Undetermined
      expect(options.some(t => t?.includes('Japanese') && t?.includes('Provider Default'))).toBe(true)
      expect(options.some(t => t?.includes('English'))).toBe(true)
      expect(options.some(t => t?.includes('Undetermined / Untagged (und)'))).toBe(true)
    })

    it('pre-selects the provider canonical original language and marks it clearly with Provider Default', async () => {
      const show: TVShowSummary = {
        series_title: 'Attack on Titan',
        source_id: 'src-1',
        season_count: 4,
        episode_count: 87
      }

      render(
        <ToastProvider>
          <ShowTranscodeModal show={show} onClose={vi.fn()} />
        </ToastProvider>
      )

      await waitFor(() => {
        const select = screen.getByLabelText(/original language/i) as HTMLSelectElement
        expect(select.value).toBe('ja')
      })

      const selectedOption = screen.getByRole('option', { name: /Japanese \(ja\) \(Provider Default: Japanese\)/i })
      expect(selectedOption).toBeTruthy()
    })

    it('falls back to standard language list when no in-file languages are detected', async () => {
      ;(window.electronAPI.seriesGetAudioLanguages as ReturnType<typeof vi.fn>).mockResolvedValue([])
      ;(window.electronAPI.seriesGetEpisodes as ReturnType<typeof vi.fn>).mockResolvedValue([
        { id: 1, title: 'Ep 1', original_language: 'fr' }
      ])

      const show: TVShowSummary = {
        series_title: 'Lupin',
        source_id: 'src-1',
        season_count: 2,
        episode_count: 10
      }

      render(
        <ToastProvider>
          <ShowTranscodeModal show={show} onClose={vi.fn()} />
        </ToastProvider>
      )

      await waitFor(() => {
        const select = screen.getByLabelText(/original language/i) as HTMLSelectElement
        expect(select.value).toBe('fr')
      })

      const frenchOption = screen.getByRole('option', { name: /French \(fr\) \(Provider Default: French\)/i })
      expect(frenchOption).toBeTruthy()
    })
  })

  describe('TVShowDetails Language Surfacing', () => {
    it('surfaces original language and detected file audio languages in metadata header', async () => {
      const mockShowData: TVShow = {
        title: 'Attack on Titan',
        poster_url: 'https://image.tmdb.org/poster.jpg',
        seasons: new Map([
          [
            1,
            {
              seasonNumber: 1,
              episodes: [
                {
                  id: 101,
                  title: 'To You, in 2000 Years',
                  episode_number: 1,
                  season_number: 1,
                  source_id: 'src-1',
                  file_path: 'H:/Media/AOT/S01E01.mkv',
                  resolution: '1080p',
                  video_codec: 'h264',
                  original_language: 'ja'
                }
              ]
            }
          ]
        ])
      }

      render(
        <TVShowDetails
          selectedShow="Attack on Titan"
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
        />
      )

      await waitFor(() => {
        expect(screen.getByText(/Original:\s*Japanese/i)).toBeTruthy()
      })

      await waitFor(() => {
        expect(screen.getByText(/Audio:\s*Japanese,\s*English,\s*Undetermined \/ Untagged/i)).toBeTruthy()
      })
    })
  })
})
