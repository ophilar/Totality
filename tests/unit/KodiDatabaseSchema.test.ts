import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  convertKodiPathToLocal,
  invalidateNfsMappingsCache
} from '@main/providers/kodi/KodiDatabaseSchema'

const mockGetSetting = vi.fn()
const mockWarn = vi.fn()

vi.mock('@main/database/BetterSQLiteService', () => ({
  getDatabase: () => ({
    config: {
      getSetting: mockGetSetting
    }
  })
}))

vi.mock('@main/services/LoggingService', () => ({
  getLoggingService: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: mockWarn
  })
}))

describe('KodiDatabaseSchema - convertKodiPathToLocal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    invalidateNfsMappingsCache()
  })

  it('should return falsy/empty input as-is', () => {
    expect(convertKodiPathToLocal('')).toBe('')
    // @ts-expect-error testing invalid inputs
    expect(convertKodiPathToLocal(null)).toBeNull()
    // @ts-expect-error testing invalid inputs
    expect(convertKodiPathToLocal(undefined)).toBeUndefined()
  })

  it('should convert SMB URLs to Windows UNC paths', () => {
    const smbUrl = 'smb://server/share/Movies/Inception (2010).mkv'
    const expected = '\\\\server\\share\\Movies\\Inception (2010).mkv'
    expect(convertKodiPathToLocal(smbUrl)).toBe(expected)
  })

  it('should convert NFS URLs using matching mount mappings', () => {
    mockGetSetting.mockReturnValue(
      JSON.stringify({
        '192.168.1.100/volume1/media': 'Z:',
        '192.168.1.100/volume1/media/movies': 'M:\\Movies'
      })
    )

    // Should match longest prefix '192.168.1.100/volume1/media/movies'
    const nfsUrl1 = 'nfs://192.168.1.100/volume1/media/movies/Inception.mkv'
    expect(convertKodiPathToLocal(nfsUrl1)).toBe('M:\\Movies\\Inception.mkv')

    // Should match prefix '192.168.1.100/volume1/media'
    const nfsUrl2 = 'nfs://192.168.1.100/volume1/media/tvshows/Show/ep1.mkv'
    expect(convertKodiPathToLocal(nfsUrl2)).toBe('Z:\\tvshows\\Show\\ep1.mkv')
  })

  it('should handle NFS mapping keys with nfs:// prefix', () => {
    mockGetSetting.mockReturnValue(
      JSON.stringify({
        'nfs://nas.local/export/video': '/mnt/nas'
      })
    )

    const nfsUrl = 'nfs://nas.local/export/video/subfolder/file.mkv'
    expect(convertKodiPathToLocal(nfsUrl)).toBe('/mnt/nas\\subfolder\\file.mkv')
  })

  it('should log a warning and return original URL if NFS mapping is not found', () => {
    mockGetSetting.mockReturnValue(JSON.stringify({}))

    const unmappedNfsUrl = 'nfs://unmapped-server/share/file.mkv'
    const result = convertKodiPathToLocal(unmappedNfsUrl)

    expect(result).toBe(unmappedNfsUrl)
    expect(mockWarn).toHaveBeenCalledWith(
      '[KodiDatabaseSchema]',
      'No NFS mount mapping configured for path with scheme: nfs'
    )
    expect(mockWarn).toHaveBeenCalledWith(
      '[KodiDatabaseSchema]',
      '[KodiDatabaseSchema] Configure NFS mappings in Settings > Services > Kodi NFS Mounts'
    )
  })

  it('should log a warning and return original URL for unknown URL schemes', () => {
    const unknownUrl = 'ssh://server/home/user/media/movie.mkv'
    const result = convertKodiPathToLocal(unknownUrl)

    expect(result).toBe(unknownUrl)
    expect(mockWarn).toHaveBeenCalledWith(
      '[KodiDatabaseSchema]',
      'Unknown URL scheme for FFprobe: ssh'
    )
  })

  it('should convert file:// URLs to local paths', () => {
    const fileUrl = 'file:///C:/Media/Movies/Inception.mkv'
    expect(convertKodiPathToLocal(fileUrl)).toBe('/C:/Media/Movies/Inception.mkv')
  })

  it('should return local file system paths as-is', () => {
    const windowsPath = 'C:\\Media\\Movies\\Inception.mkv'
    const posixPath = '/var/media/movies/Inception.mkv'

    expect(convertKodiPathToLocal(windowsPath)).toBe(windowsPath)
    expect(convertKodiPathToLocal(posixPath)).toBe(posixPath)
  })
})
