import { describe, expect, it } from 'vitest'
import {
  calculateTrackByteSize,
  _aggregateShowOptimizationMetrics,
  calculateDryRunMetrics,
  type TrackStreamInfo,
} from '@main/services/ShowOptimizationMetricsService'
import {
  LanguageDecisionService,
  type _AudioTrackForDecision,
} from '@main/services/LanguageDecisionService'

describe('RealDryRunOptimizationCalculations', () => {
  describe('calculateTrackByteSize', () => {
    it('calculates exact track byte size from NUMBER_OF_BYTES tag', () => {
      const stream: TrackStreamInfo = {
        index: 1,
        codec_name: 'ac3',
        channels: 6,
        tags: {
          NUMBER_OF_BYTES: '524288000',
        },
      }
      const bytes = calculateTrackByteSize(stream, 3600)
      expect(bytes).toBe(524288000)
    })

    it('calculates exact track byte size from NUMBER_OF_BYTES-eng tag fallback', () => {
      const stream: TrackStreamInfo = {
        index: 2,
        codec_name: 'eac3',
        channels: 6,
        tags: {
          'NUMBER_OF_BYTES-eng': '314572800',
        },
      }
      const bytes = calculateTrackByteSize(stream, 3600)
      expect(bytes).toBe(314572800)
    })

    it('calculates exact track byte size from bit_rate * duration / 8 when NUMBER_OF_BYTES is absent', () => {
      const stream: TrackStreamInfo = {
        index: 1,
        codec_name: 'ac3',
        bit_rate: '640000',
        channels: 6,
      }
      const durationSeconds = 3600 // 1 hour
      // (640000 bps * 3600 s) / 8 = 288,000,000 bytes
      const bytes = calculateTrackByteSize(stream, durationSeconds)
      expect(bytes).toBe(288000000)
    })

    it('calculates exact track byte size when bit_rate is a numeric value', () => {
      const stream: TrackStreamInfo = {
        index: 1,
        codec: 'aac',
        bit_rate: 192000,
        channels: 2,
      }
      const durationSeconds = 1800 // 30 minutes
      // (192000 bps * 1800 s) / 8 = 43,200,000 bytes
      const bytes = calculateTrackByteSize(stream, durationSeconds)
      expect(bytes).toBe(43200000)
    })

    it('falls back to proportional container audio slice when track bitrate is absent', () => {
      const stream: TrackStreamInfo = {
        index: 1,
        codec_name: 'ac3',
        channels: 6,
      }
      const durationSeconds = 3600
      const containerContext = {
        totalBitrate: 10000000, // 10 Mbps container
        totalStreams: 4,
        fileSize: 4500000000,
      }
      const bytes = calculateTrackByteSize(stream, durationSeconds, containerContext)
      expect(bytes).toBeGreaterThan(0)
      // Proportional slice based on channels / total container streams
      expect(bytes).toBe(Math.round(((10000000 * 3600) / 8) * (6 / 4)))
    })

    it('returns 0 if no size, bitrate, or container info is available', () => {
      const stream: TrackStreamInfo = {
        index: 1,
        codec_name: 'unknown',
      }
      const bytes = calculateTrackByteSize(stream)
      expect(bytes).toBe(0)
    })
  })

  describe('LanguageDecisionService.decideAudioStream', () => {
    const service = new LanguageDecisionService()

    it('retains audio track matching original language', () => {
      const stream = {
        index: 1,
        codec: 'ac3',
        language: 'jpn',
        channels: 6,
        reliableTag: true,
      }
      const decision = service.decideAudioStream(stream, 'ja')
      expect(decision.action).toBe('retain')
      expect(decision.decision).toBe('retain')
      expect(decision.rationale).toMatch(/original language/i)
    })

    it('retains commentary, audio description, and accessibility tracks regardless of language', () => {
      const commentaryStream = {
        index: 2,
        codec: 'aac',
        language: 'fra',
        title: 'Director Commentary',
        isCommentary: true,
        channels: 2,
      }
      const adStream = {
        index: 3,
        codec: 'aac',
        language: 'deu',
        title: 'Audio Description',
        isAudioDescription: true,
        channels: 2,
      }
      const accessibilityStream = {
        index: 4,
        codec: 'aac',
        language: 'spa',
        title: 'Hearing Impaired',
        isAccessibility: true,
        channels: 2,
      }

      expect(service.decideAudioStream(commentaryStream, 'ja').action).toBe('retain')
      expect(service.decideAudioStream(adStream, 'ja').action).toBe('retain')
      expect(service.decideAudioStream(accessibilityStream, 'ja').action).toBe('retain')
    })

    it('marks unwanted dubbed audio tracks for removal', () => {
      const dubStream = {
        index: 2,
        codec: 'ac3',
        language: 'deu',
        channels: 6,
        reliableTag: true,
      }
      const decision = service.decideAudioStream(dubStream, 'ja')
      expect(decision.action).toBe('remove')
      expect(decision.decision).toBe('remove')
      expect(decision.rationale).toMatch(/unwanted dubbed audio/i)
    })

    it('flags tracks with missing or unreliable tags for review', () => {
      const unknownStream = {
        index: 3,
        codec: 'ac3',
        language: undefined,
        channels: 2,
      }
      const decision = service.decideAudioStream(unknownStream, 'ja')
      expect(decision.action).toBe('review-required')
      expect(decision.decision).toBe('review-required')
    })
  })

  describe('calculateDryRunMetrics & aggregateShowOptimizationMetrics', () => {
    it('aggregates multi-episode show dry run metrics with exact math', () => {
      const episodes = [
        {
          sizeBytes: 4000000000, // 4 GB
          recoverableBytes: 600000000, // 600 MB removable audio
          efficiency: 85,
          audioStreams: [
            { index: 1, codec: 'dts', language: 'en', channels: 6, bit_rate: '1509000', tags: { NUMBER_OF_BYTES: '679050000' } },
            { index: 2, codec: 'ac3', language: 'de', channels: 6, bit_rate: '640000', tags: { NUMBER_OF_BYTES: '288000000' } },
            { index: 3, codec: 'ac3', language: 'fr', channels: 6, bit_rate: '640000', tags: { NUMBER_OF_BYTES: '288000000' } },
          ],
          durationSeconds: 3600,
        },
        {
          sizeBytes: 6000000000, // 6 GB
          recoverableBytes: 900000000, // 900 MB removable audio
          efficiency: 90,
          audioStreams: [
            { index: 1, codec: 'truehd', language: 'en', channels: 8, bit_rate: '4000000', tags: { NUMBER_OF_BYTES: '1800000000' } },
            { index: 2, codec: 'ac3', language: 'es', channels: 6, bit_rate: '640000', tags: { NUMBER_OF_BYTES: '288000000' } },
          ],
          durationSeconds: 3600,
        },
        {
          sizeBytes: 2000000000, // 2 GB unparsed / unscored
          recoverableBytes: null,
          efficiency: null,
          audioStreams: [],
          durationSeconds: 3600,
        },
      ]

      const result = calculateDryRunMetrics(episodes, 'en')

      expect(result.totalBytes).toBe(12000000000)
      // Removable tracks in ep 1: de (288,000,000) + fr (288,000,000) = 576,000,000
      // Removable tracks in ep 2: es (288,000,000) = 288,000,000
      // Total recoverable: 864,000,000 bytes
      expect(result.recoverableBytes).toBe(864000000)
      // Percentage: (864,000,000 / 12,000,000,000) * 100 = 7.2%
      expect(result.percentageSavings).toBeCloseTo(7.2)
      expect(result.totalEpisodes).toBe(3)
      expect(result.scoredEpisodes).toBe(2)
      expect(result.unscoredEpisodes).toBe(1)
      // Size-weighted efficiency for scored episodes: (85 * 4GB + 90 * 6GB) / 10GB = (340 + 540) / 10 = 88
      expect(result.weightedEfficiency).toBe(88)
      expect(result.trackDecisions.length).toBe(5)

      // Verify track decisions
      const deTrack = result.trackDecisions.find(t => t.language === 'de' || t.languageTag === 'de')
      expect(deTrack).toBeDefined()
      expect(deTrack?.decision).toBe('remove')
      expect(deTrack?.estimatedBytes).toBe(288000000)

      const enTrack = result.trackDecisions.find(t => (t.language === 'en' || t.languageTag === 'en') && t.codec === 'dts')
      expect(enTrack).toBeDefined()
      expect(enTrack?.decision).toBe('retain')
      expect(enTrack?.estimatedBytes).toBe(679050000)
    })

    it('handles 0 total size gracefully without dividing by zero', () => {
      const result = calculateDryRunMetrics([], 'en')
      expect(result.totalBytes).toBe(0)
      expect(result.recoverableBytes).toBe(0)
      expect(result.percentageSavings).toBe(0)
      expect(result.totalEpisodes).toBe(0)
      expect(result.scoredEpisodes).toBe(0)
      expect(result.unscoredEpisodes).toBe(0)
      expect(result.weightedEfficiency).toBeNull()
      expect(result.trackDecisions).toEqual([])
    })

    it('does not double-count video debt for episodes without audio streams', () => {
      const result = calculateDryRunMetrics([
        { sizeBytes: 2_000_000_000, recoverableBytes: 300_000_000, audioStreams: [] },
      ], 'en')

      expect(result.recoverableBytes).toBe(0)
      expect(result.videoDebtBytes).toBe(300_000_000)
      expect(result.totalCombinedSavingsBytes).toBe(300_000_000)
    })
  })
})
