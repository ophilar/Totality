
/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect } from 'vitest'
import { parseMissingMovies, parseMissingEpisodes, groupEpisodesBySeason } from '../../src/renderer/src/components/dashboard/dashboardUtils'
import { formatDuration, formatBitrate, formatFileSize, isLosslessCodec, getTrackQualityTier } from '../../src/renderer/src/components/library/mediaUtils'

describe('DashboardUtils (Renderer)', () => {
  describe('parseMissingMovies', () => {
    it('should parse valid JSON missing movies', () => {
      const data = {
        missing_movies: JSON.stringify([{ title: 'Movie 1', tmdb_id: 1 }, { title: 'Movie 2' }])
      }
      const parsed = parseMissingMovies(data as any)
      expect(parsed.length).toBe(2)
      expect(parsed[0].title).toBe('Movie 1')
    })

    it('should return empty array for invalid JSON', () => {
      const data = { missing_movies: 'invalid' }
      expect(parseMissingMovies(data as any)).toEqual([])
    })
  })

  describe('groupEpisodesBySeason', () => {
    it('should group episodes correctly', () => {
      const data = {
        missing_episodes: JSON.stringify([
          { season_number: 1, episode_number: 1 },
          { season_number: 1, episode_number: 2 },
          { season_number: 2, episode_number: 1 }
        ]),
        missing_seasons: JSON.stringify([2])
      }
      const groups = groupEpisodesBySeason(data as any)
      expect(groups.length).toBe(2)
      expect(groups[0].seasonNumber).toBe(1)
      expect(groups[0].isWholeSeason).toBe(false)
      expect(groups[1].seasonNumber).toBe(2)
      expect(groups[1].isWholeSeason).toBe(true)
    })
  })
})

describe('MediaUtils (Renderer)', () => {
  describe('formatDuration', () => {
    it('should format milliseconds to MM:SS', () => {
      expect(formatDuration(65000)).toBe('1:05')
      expect(formatDuration(1000)).toBe('0:01')
    })

    it('should format milliseconds to HH:MM:SS', () => {
      expect(formatDuration(3665000)).toBe('1:01:05')
    })

    it('should handle missing input', () => {
      expect(formatDuration()).toBe('--:--')
    })
  })

  describe('formatBitrate', () => {
    it('should format bps to kbps and Mbps', () => {
      expect(formatBitrate(320)).toBe('320 kbps')
      expect(formatBitrate(1500)).toBe('1.5 Mbps')
    })
  })

  describe('formatFileSize', () => {
    it('should format bytes to KB, MB, and GB', () => {
      expect(formatFileSize(1024)).toBe('1 KB')
      expect(formatFileSize(1048576)).toBe('1.0 MB')
      expect(formatFileSize(1073741824)).toBe('1.00 GB')
    })
  })

  describe('isLosslessCodec', () => {
    it('should detect lossless codecs', () => {
      expect(isLosslessCodec('FLAC')).toBe(true)
      expect(isLosslessCodec('mp3')).toBe(false)
    })
  })

  describe('getTrackQualityTier', () => {
    it('should return ultra for high-res lossless', () => {
      expect(getTrackQualityTier('flac', 24, 96000)).toBe('ultra')
    })

    it('should return high for standard lossless', () => {
      expect(getTrackQualityTier('flac', 16, 44100)).toBe('high')
    })

    it('should return medium for high bitrate lossy', () => {
      expect(getTrackQualityTier('mp3', undefined, undefined, 320)).toBe('medium')
    })
  })
})
