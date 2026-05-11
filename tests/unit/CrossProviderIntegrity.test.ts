/**
 * Cross-Provider Integrity Suite
 * 
 * Verifies that different media providers result in identical
 * internal data structures for the same physical media file.
 * 
 * MANDATE: No Mocks. No Fakes. Real Services.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { setupTestDb, cleanupTestDb } from '@tests/TestUtils'
import { ProviderType, MediaItemType } from '@main/types/database'
import { MediaTransformer } from '@main/providers/base/MediaTransformer'

describe('Cross-Provider Transformation Integrity', () => {
  beforeEach(async () => {
    await setupTestDb()
  })

  afterEach(async () => {
    await cleanupTestDb()
  })

  it('should produce identical MediaItem structures from Plex and Jellyfin raw data', () => {
    const sourceId = 'test-source'

    // 1. Raw Plex Payload
    const plexPayload = {
      ratingKey: 'plex123',
      type: 'movie',
      title: 'Interstellar',
      year: 2014,
      duration: 10141000,
      Media: [{
        id: 500,
        width: 3840,
        height: 1600,
        videoCodec: 'hevc',
        audioCodec: 'truehd',
        audioChannels: 8,
        bitrate: 65000, // Total
        container: 'mkv',
        Part: [{
          id: 900,
          file: '/data/movies/Interstellar.mkv',
          size: 80000000000,
          Stream: [
            { streamType: 1, codec: 'hevc', bitDepth: 10, colorTrc: 'smpte2084', colorPrimaries: 'bt2020', frameRate: 23.976, bitrate: 60000 }, // Video
            { streamType: 2, codec: 'truehd', audioChannelLayout: '7.1', bitrate: 5000, selected: true } // Audio
          ]
        }]
      }],
      Guid: [{ id: 'tmdb://157336' }]
    }

    // 2. Raw Jellyfin Payload
    const jellyfinPayload = {
      Id: 'jf123',
      Name: 'Interstellar',
      Type: 'Movie',
      ProductionYear: 2014,
      RunTimeTicks: 10141000 * 10000,
      Path: '/data/movies/Interstellar.mkv',
      MediaSources: [{
        Id: 'ms900',
        Path: '/data/movies/Interstellar.mkv',
        Size: 80000000000,
        Container: 'mkv',
        Bitrate: 65000000,
        MediaStreams: [
          { Type: 'Video', Codec: 'hevc', Width: 3840, Height: 1600, BitDepth: 10, VideoRange: 'HDR10', ColorSpace: 'bt2020', RealFrameRate: 23.976, BitRate: 60000000 },
          { Type: 'Audio', Codec: 'truehd', ChannelLayout: '7.1', BitRate: 5000000, IsDefault: true }
        ]
      }],
      ProviderIds: { Tmdb: '157336' }
    }

    // 3. Transform Both
    const plexResult = MediaTransformer.fromPlex(plexPayload as any, sourceId)
    const jfResult = MediaTransformer.fromJellyfin(jellyfinPayload as any, sourceId, ProviderType.Jellyfin, (id) => id)

    // 4. Integrity Assertions
    const plex = plexResult.mediaItem
    const jf = jfResult.mediaItem

    expect(plex.title).toBe(jf.title)
    expect(plex.year).toBe(jf.year)
    expect(plex.file_path).toBe(jf.file_path)
    expect(plex.file_size).toBe(jf.file_size)
    expect(plex.resolution).toBe(jf.resolution)
    expect(plex.video_codec).toBe(jf.video_codec)
    expect(plex.hdr_format).toBe(jf.hdr_format)
    expect(plex.audio_codec).toBe(jf.audio_codec)
    expect(plex.tmdb_id).toBe(jf.tmdb_id)
    
    // Versions should also match in technical metadata
    expect(plexResult.versions[0].video_bitrate).toBe(jfResult.versions[0].video_bitrate)
  })

  it('should throw IncompleteMetadataError when mandatory fields are missing (No Failsafes)', () => {
    const plexBroken = {
      ratingKey: 'bad',
      title: 'Missing Media'
      // No Media array
    }

    expect(() => {
      MediaTransformer.fromPlex(plexBroken as any, 's1')
    }).toThrow(/Missing Media/)

    const jfBroken = {
      Id: 'bad',
      Name: 'Missing Path',
      MediaSources: [] // No sources
    }

    expect(() => {
      MediaTransformer.fromJellyfin(jfBroken as any, 's1', ProviderType.Jellyfin, (id) => id)
    }).toThrow(/Missing MediaSources/)
  })
})
