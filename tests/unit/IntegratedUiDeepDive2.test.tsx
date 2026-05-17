/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react'
import { TVShowDetails } from '@/components/library/tv/TVShowDetails'
import { CompletenessPanel } from '@/components/library/CompletenessPanel'
import { MusicAlbumDetails } from '@/components/library/music/MusicAlbumDetails'
import { AboutModal } from '@/components/ui/AboutModal'
import { setupTestDb, cleanupTestDb, setupRealIntegratedBridge } from '@tests/TestUtils'
import { ToastProvider } from '@/contexts/ToastContext'
import { SourceProvider } from '@/contexts/SourceContext'
import { ThemeProvider } from '@/contexts/ThemeContext'
import React from 'react'

describe('Renderer UI Deep Dive 2 (Integrated Stack)', () => {
  let db: any

  beforeEach(async () => {
    if (typeof window === 'undefined') {
        (global as any).window = (global as any)
    }
    
    // Mock matchMedia for ThemeProvider
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation(query => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(), 
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });

    db = await setupTestDb()
    const bridge = setupRealIntegratedBridge()
    
    ;(window as any).electronAPI = bridge.api
    ;(globalThis as any).electronAPI = bridge.api
  })

  afterEach(async () => {
    vi.clearAllTimers()
    await cleanupTestDb()
  })

  const renderWithProviders = (ui: React.ReactElement) => {
    return render(
      <ToastProvider>
        <SourceProvider>
          <ThemeProvider>
            {ui}
          </ThemeProvider>
        </SourceProvider>
      </ToastProvider>
    )
  }

  describe('TVShowDetails', () => {
    it('should render show details and seasons', async () => {
      const seasonsMap = new Map()
      seasonsMap.set(1, { seasonNumber: 1, episode_count: 7, episodes: [] })
      seasonsMap.set(2, { seasonNumber: 2, episode_count: 13, episodes: [] })

      const showData: any = {
        title: 'Breaking Bad',
        seasons: seasonsMap
      }
      
      const completenessMap = new Map()
      completenessMap.set('Breaking Bad', {
        total_seasons: 5,
        total_episodes: 62,
        owned_seasons: 2,
        owned_episodes: 20,
        completeness_percentage: 32
      })

      await act(async () => {
        renderWithProviders(
            <TVShowDetails 
                selectedShow="Breaking Bad"
                selectedShowData={showData}
                selectedShowLoading={false}
                seriesCompleteness={completenessMap}
                onBack={() => {}}
                onAnalyzeSeries={() => {}}
                onSelectSeason={() => {}}
                onMissingItemClick={() => {}}
                posterMinWidth={200}
            />
        )
      })

      expect(screen.getByText('Breaking Bad')).toBeTruthy()
      expect(screen.getByText(/Season 1/i)).toBeTruthy()
    })
  })

  describe('CompletenessPanel', () => {
    it('should render stats and handle analysis triggers', async () => {
      await db.sources.upsertSource({ 
        source_id: 's1', source_type: 'local', display_name: 'Local', is_enabled: 1, connection_config: '{}' 
      })
      await db.sources.setLibrariesEnabled('s1', [
          { id: 'l1', name: 'TV Shows', type: 'show', enabled: true }
      ])
      await db.config.setSetting('tmdb_api_key', 'test-key')

      const seriesStats = {
        totalSeries: 10,
        completeSeries: 5,
        incompleteSeries: 5,
        totalMissingEpisodes: 50,
        averageCompleteness: 50
      }

      await act(async () => {
        renderWithProviders(
            <CompletenessPanel 
                isOpen={true}
                onClose={() => {}}
                seriesStats={seriesStats}
                collectionStats={null}
                musicStats={null}
                onAnalyzeSeries={async () => {}}
                onAnalyzeCollections={async () => {}}
                onAnalyzeMusic={async () => {}}
                onCancel={async () => {}}
                isAnalyzing={false}
                analysisProgress={null}
                analysisType={null}
                onDataRefresh={() => {}}
                hasTV={true}
                hasMovies={true}
                hasMusic={false}
                libraries={[{ id: 'l1', name: 'TV Shows', type: 'show' }]}
            />
        )
      })

      await waitFor(() => {
          expect(screen.getByRole('complementary').querySelector('h2')?.textContent).toContain('Completeness')
          expect(screen.getByText('10')).toBeTruthy() 
      })
    })
  })

  describe('MusicAlbumDetails', () => {
    it('should render album info and tracks', async () => {
      const album: any = {
        id: 1,
        title: 'The Dark Side of the Moon',
        artist_name: 'Pink Floyd',
        year: 1973,
        track_count: 10
      }
      
      const tracks: any[] = [
        { id: 101, title: 'Speak to Me', duration: 90, audio_codec: 'flac', bitrate: 1000 },
      ]

      await act(async () => {
        renderWithProviders(
            <MusicAlbumDetails 
                selectedAlbum={album}
                selectedArtist={null}
                albumCompleteness={null}
                tracks={tracks}
                tracksLoading={false}
                onBack={() => {}}
                onAnalyzeAlbum={async () => {}}
            />
        )
      })

      expect(screen.getByText('The Dark Side of the Moon')).toBeTruthy()
      expect(screen.getByText('Speak to Me')).toBeTruthy()
    })
  })

  describe('AboutModal', () => {
    it('should render and switch tabs', async () => {
        await act(async () => {
            renderWithProviders(<AboutModal isOpen={true} onClose={() => {}} />)
        })

        expect(screen.getByText(/About Totality/i)).toBeTruthy()
        
        const creditsTab = screen.getByText(/Credits/i)
        await act(async () => {
            fireEvent.click(creditsTab)
        })

        expect(screen.getByText(/The Movie Database/i)).toBeTruthy()
    })
  })
})
