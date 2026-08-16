import { describe, expect, it } from 'vitest'
import { MediaPathAuthorization } from '@main/services/MediaPathAuthorization'

describe('MediaPathAuthorization', () => {
  it('accepts a file inside a registered root and rejects traversal outside it', () => {
    const authorization = new MediaPathAuthorization(['C:/library/movies'])
    expect(authorization.assertAuthorized('C:/library/movies/title/movie.mkv')).toBe(true)
    expect(() => authorization.assertAuthorized('C:/library/movies/../private/movie.mkv')).toThrow('outside registered library roots')
  })

  it('rejects an empty root set', () => {
    expect(() => new MediaPathAuthorization([]).assertAuthorized('C:/movie.mkv')).toThrow('No registered library roots')
  })

  it('extracts roots from various source configurations including customLibraries and libraries', () => {
    const localWithCustomLibs = {
      source_type: 'local',
      connection_config: JSON.stringify({
        folderPath: 'C:/media',
        customLibraries: [
          { name: 'Movies', path: 'D:/movies', enabled: true },
          { name: 'Shows', path: 'E:/shows', enabled: true }
        ],
        libraries: [
          { name: 'Music', path: 'F:/music' }
        ]
      })
    }
    const roots = MediaPathAuthorization.extractRootsFromSource(localWithCustomLibs)
    expect(roots).toEqual(['C:/media', 'D:/movies', 'E:/shows', 'F:/music'])
  })

  it('authorizes server sources with valid media item file paths', () => {
    const plexSource = {
      source_type: 'plex',
      connection_config: JSON.stringify({
        serverId: 'plex-server-1',
        token: 'token123'
      })
    }
    expect(MediaPathAuthorization.assertMediaAuthorized({ file_path: 'D:/PlexMedia/Movies/Inception.mkv' }, plexSource)).toBe(true)
  })

  it('authorizes local sources with media file paths inside registered roots', () => {
    const localSource = {
      source_type: 'local',
      connection_config: JSON.stringify({
        folderPath: 'C:/library/movies'
      })
    }
    expect(MediaPathAuthorization.assertMediaAuthorized({ file_path: 'C:/library/movies/action/film.mkv' }, localSource)).toBe(true)
    expect(() => MediaPathAuthorization.assertMediaAuthorized({ file_path: 'C:/other/film.mkv' }, localSource)).toThrow('outside registered library roots')
  })

  it('rejects invalid paths with null bytes or missing file_path', () => {
    const plexSource = {
      source_type: 'plex',
      connection_config: JSON.stringify({})
    }
    expect(() => MediaPathAuthorization.assertMediaAuthorized({ file_path: '' }, plexSource)).toThrow('Media item has no local source path')
    expect(() => MediaPathAuthorization.assertMediaAuthorized({ file_path: 'C:/movie\0.mkv' }, plexSource)).toThrow('contains null bytes')
  })
})
