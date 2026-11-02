import { describe, expect, it } from 'vitest'
import { MediaPathAuthorization } from '@main/services/MediaPathAuthorization'

describe('MediaPathAuthorization', () => {
  it('accepts a file inside a registered root and rejects traversal outside it', () => {
    const authorization = new MediaPathAuthorization(['C:/library/movies'])
    expect(authorization.assertAuthorized('C:/library/movies/title/movie.mkv')).toBe(true)
    expect(authorization.isAuthorized('C:/library/movies/title/movie.mkv')).toBe(true)
    expect(() => authorization.assertAuthorized('C:/library/movies/../private/movie.mkv')).toThrow('outside registered library roots')
    expect(authorization.isAuthorized('C:/library/movies/../private/movie.mkv')).toBe(false)
  })

  it('strictly rejects sibling directory prefix bypasses', () => {
    const authorization = new MediaPathAuthorization(['C:/media/library'])
    expect(() => authorization.assertAuthorized('C:/media/library-private/secret.mkv')).toThrow('outside registered library roots')
    expect(authorization.isAuthorized('C:/media/library-private/secret.mkv')).toBe(false)
  })

  it('rejects an empty root set', () => {
    expect(() => new MediaPathAuthorization([]).assertAuthorized('C:/movie.mkv')).toThrow('No registered library roots')
    expect(new MediaPathAuthorization([]).isAuthorized('C:/movie.mkv')).toBe(false)
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

  it('fails fast on malformed connection configuration JSON', () => {
    const malformedSource = {
      source_type: 'plex',
      connection_config: '{ not valid json }'
    }
    expect(() => MediaPathAuthorization.extractRootsFromSource(malformedSource)).toThrow('Malformed connection configuration')
  })

  it('rejects server sources when no library roots are registered (no allow-on-unknown bypass)', () => {
    const plexSourceWithoutRoots = {
      source_type: 'plex',
      connection_config: JSON.stringify({
        serverId: 'plex-server-1',
        token: 'token123'
      })
    }
    expect(() => MediaPathAuthorization.assertMediaAuthorized({ file_path: 'D:/PlexMedia/Movies/Inception.mkv' }, plexSourceWithoutRoots)).toThrow(
      'No registered library roots are available for source authorization'
    )
  })

  it('authorizes server sources when library roots are configured and match path', () => {
    const plexSourceWithRoots = {
      source_type: 'plex',
      connection_config: JSON.stringify({
        serverId: 'plex-server-1',
        token: 'token123',
        paths: ['D:/PlexMedia/Movies']
      })
    }
    expect(MediaPathAuthorization.assertMediaAuthorized({ file_path: 'D:/PlexMedia/Movies/Inception.mkv' }, plexSourceWithRoots)).toBe(true)
    expect(() => MediaPathAuthorization.assertMediaAuthorized({ file_path: 'D:/PlexMedia/Private/secret.mkv' }, plexSourceWithRoots)).toThrow(
      'outside registered library roots'
    )
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
      connection_config: JSON.stringify({ paths: ['C:/media'] })
    }
    expect(() => MediaPathAuthorization.assertMediaAuthorized({ file_path: '' }, plexSource)).toThrow('Media item has no local source path')
    expect(() => MediaPathAuthorization.assertMediaAuthorized({ file_path: 'C:/movie\0.mkv' }, plexSource)).toThrow('contains null bytes')
  })
})
