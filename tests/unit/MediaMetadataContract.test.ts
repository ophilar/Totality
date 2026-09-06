import { describe, expect, it } from 'vitest'
import { QualityAnalyzer } from '@main/services/QualityAnalyzer'
import type { MediaItem, MusicAlbum } from '@main/types/database'

function createMediaItem(overrides: Partial<MediaItem> = {}): MediaItem {
  return {
    id: 1,
    source_id: 'source',
    source_type: 'local',
    provider_id: 'item',
    title: 'Movie',
    media_type: 'movie',
    resolution: '1080p',
    video_codec: 'h264',
    video_bitrate: 6000,
    duration: 60_000,
    audio_codec: 'aac',
    audio_channels: 2,
    audio_bitrate: 256,
    has_object_audio: false,
    ...overrides,
  } as MediaItem
}

function createMusicAlbum(overrides: Partial<MusicAlbum> = {}): MusicAlbum {
  return {
    id: 1,
    source_id: 'source',
    source_type: 'local',
    provider_id: 'album',
    artist_name: 'Artist',
    title: 'Album',
    ...overrides,
  } as MusicAlbum
}

describe('media metadata contract', () => {
  it('represents unavailable scalar metadata with null scores', async () => {
    const result = await new QualityAnalyzer().analyzeMediaItem(createMediaItem({
      video_codec: null,
      video_bitrate: null,
      audio_codec: null,
      audio_channels: null,
      audio_bitrate: null,
      has_object_audio: null,
    }))

    expect(result.bitrate_tier_score).toBeNull()
    expect(result.audio_tier_score).toBeNull()
    expect(result.tier_score).toBeNull()
    expect(result.tier_quality).toBe('UNKNOWN')
  })

  it('does not assign an efficiency multiplier to an unknown video codec', async () => {
    const result = await new QualityAnalyzer().analyzeMediaItem(createMediaItem({
      video_codec: 'unknown_codec',
      video_bitrate: 6000,
    }))

    expect(result.bitrate_tier_score).toBeNull()
    expect(result.efficiency_score).toBeNull()
  })

  it('does not fall back from an explicit empty audio-track list to primary audio fields', async () => {
    const result = await new QualityAnalyzer().analyzeMediaItem(createMediaItem({
      audio_tracks: '[]',
      audio_codec: 'truehd',
      audio_channels: 8,
      audio_bitrate: 4000,
      has_object_audio: true,
    }))

    expect(result.audio_tier_score).toBeNull()
  })

  it('rejects malformed structured audio metadata with a typed error', async () => {
    await expect(new QualityAnalyzer().analyzeMediaItem(createMediaItem({
      audio_tracks: '{not-json}',
    }))).rejects.toMatchObject({
      name: 'MediaMetadataError',
      code: 'MALFORMED_AUDIO_TRACKS',
    })
  })

  it('preserves valid zero and false track values instead of treating them as missing', async () => {
    const result = await new QualityAnalyzer().analyzeMediaItem(createMediaItem({
      video_bitrate: 0,
      original_language: 'en',
      audio_codec: 'truehd',
      audio_channels: 8,
      audio_bitrate: 4000,
      has_object_audio: true,
      audio_tracks: JSON.stringify([
        { codec: 'aac', channels: 0, bitrate: 0, hasObjectAudio: false, language: 'en' },
      ]),
    }))

    expect(result.bitrate_tier_score).toBe(0)
    expect(result.audio_tier_score).toBe(0)
    expect(result.tier_score).toBe(0)
    expect(result.tier_quality).toBe('LOW')
    expect(result.efficiency_score).toBe(0)
    expect(result.storage_debt_bytes).toBe(0)
  })

  it('keeps an album with no quality evidence unanalyzed', () => {
    const result = new QualityAnalyzer().analyzeMusicAlbum(createMusicAlbum(), [])

    expect(result.quality_tier).toBe('UNKNOWN')
    expect(result.tier_quality).toBe('UNKNOWN')
    expect(result.tier_score).toBeNull()
    expect(result.codec_score).toBeNull()
    expect(result.bitrate_score).toBeNull()
  })

  it('scores bitrate-only music evidence without inventing a codec score', () => {
    const result = new QualityAnalyzer().analyzeMusicAlbum(createMusicAlbum({ avg_audio_bitrate: 320 }), [])

    expect(result.quality_tier).toBe('LOSSY_HIGH')
    expect(result.codec_score).toBeNull()
    expect(result.bitrate_score).toBe(95)
    expect(result.tier_score).toBe(95)
    expect(result.tier_quality).toBe('HIGH')
  })
})
