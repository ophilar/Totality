import { describe, it, expect } from 'vitest'
import { JellyfinItemMapper } from '../../src/main/providers/jellyfin-emby/JellyfinItemMapper'
import { JellyfinApiClient } from '../../src/main/providers/jellyfin-emby/JellyfinApiClient'

describe('JellyfinItemMapper', () => {
  const client = new JellyfinApiClient({
    serverUrl: 'http://localhost:8096',
    sourceId: 's1',
    providerType: 'jellyfin',
    authHeaderName: 'Authorization',
    clientName: 'Totality',
    clientVersion: '1.0.0'
  })
  
  const mapper = new JellyfinItemMapper('s1', 'jellyfin', client)

  const mockJellyfinMovie: any = {
    Id: 'm1',
    Name: 'The Matrix',
    Type: 'Movie',
    ProductionYear: 1999,
    SortName: 'Matrix, The',
    ProviderIds: { Imdb: 'tt0133093', Tmdb: '603' },
    ImageTags: { Primary: 'tag1' },
    MediaSources: [{
      Id: 'ms1',
      Path: '/path/to/The Matrix (1999).mkv',
      Size: 1000000000,
      Container: 'mkv',
      RunTimeTicks: 81600000000, // 136 mins
      Bitrate: 10000000,
      MediaStreams: [
        { Type: 'Video', Index: 0, Codec: 'h264', Width: 1920, Height: 1080, RealFrameRate: 23.976, BitDepth: 8, VideoRange: 'SDR' },
        { Type: 'Audio', Index: 1, Codec: 'ac3', Channels: 6, BitRate: 640000, Language: 'eng', Title: 'Surround 5.1' }
      ]
    }]
  }

  it('should map Jellyfin movie to MediaMetadata', () => {
    const metadata = mapper.convertToMediaMetadata(mockJellyfinMovie)
    expect(metadata.title).toBe('The Matrix')
    expect(metadata.year).toBe(1999)
    expect(metadata.resolution).toBe('1080p')
    expect(metadata.audioCodec).toBe('AC3')
    expect(metadata.audioChannels).toBe(6)
    expect(metadata.imdbId).toBe('tt0133093')
    expect(metadata.tmdbId).toBe(603)
  })

  it('should map Jellyfin movie to MediaItem with versions', async () => {
    const result = await mapper.convertToMediaItem(mockJellyfinMovie)
    expect(result).not.toBeNull()
    const { mediaItem, versions } = result!
    
    expect(mediaItem.title).toBe('The Matrix')
    expect(versions.length).toBe(1)
    expect(versions[0].resolution).toBe('1080p')
    expect(versions[0].video_codec).toBe('H.264')
    expect(versions[0].audio_codec).toBe('AC3')
  })

  it('should correctly map library types', () => {
    expect(mapper.mapLibraryType('movies')).toBe('movie')
    expect(mapper.mapLibraryType('tvshows')).toBe('show')
    expect(mapper.mapLibraryType('music')).toBe('music')
    expect(mapper.mapLibraryType('unknown')).toBe('unknown')
  })
})
