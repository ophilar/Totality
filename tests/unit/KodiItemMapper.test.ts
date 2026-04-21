import { describe, it, expect } from 'vitest'
import { KodiItemMapper } from '../../src/main/providers/kodi/KodiItemMapper'
import { KodiRpcClient } from '../../src/main/providers/kodi/KodiRpcClient'

describe('KodiItemMapper', () => {
  const client = new KodiRpcClient({
    host: 'localhost',
    port: 8080,
    sourceId: 's1'
  })
  
  const mapper = new KodiItemMapper('s1', client)

  const mockKodiMovie: any = {
    movieid: 1,
    title: 'Inception',
    file: '/movies/Inception (2010).mkv',
    year: 2010,
    runtime: 148,
    plot: 'A thief who steals corporate secrets...',
    imdbnumber: 'tt1375666',
    art: { poster: 'image://poster-path/' },
    streamdetails: {
      video: [{ codec: 'h264', width: 1920, height: 1080, duration: 8880 }],
      audio: [{ codec: 'dts', channels: 6, language: 'eng' }],
      subtitle: [{ language: 'eng' }]
    }
  }

  it('should map Kodi movie to MediaMetadata', () => {
    const metadata = mapper.convertToMediaMetadata(mockKodiMovie, 'movie')
    expect(metadata.title).toBe('Inception')
    expect(metadata.year).toBe(2010)
    expect(metadata.resolution).toBe('1080p')
    expect(metadata.audioCodec).toBe('dts')
    expect(metadata.audioChannels).toBe(6)
    expect(metadata.imdbId).toBe('tt1375666')
  })

  it('should map Kodi movie to MediaItem with versions', async () => {
    const result = await mapper.convertToMediaItem(mockKodiMovie, 'movie')
    expect(result).not.toBeNull()
    const { mediaItem, versions } = result!
    
    expect(mediaItem.title).toBe('Inception')
    expect(versions.length).toBe(1)
    expect(versions[0].resolution).toBe('1080p')
    expect(versions[0].video_codec).toBe('h264')
  })
})
