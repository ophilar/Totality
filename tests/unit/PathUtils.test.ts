import { describe, it, expect, afterEach } from 'vitest'
import * as path from 'node:path'
import { PathUtils } from '../../src/main/services/utils/PathUtils'

describe('PathUtils', () => {
  describe('toDatabasePath', () => {
    it('should return empty string if input is falsy', () => {
      expect(PathUtils.toDatabasePath('')).toBe('')
      expect(PathUtils.toDatabasePath(null as any)).toBe('')
    })

    it('should convert backslashes to forward slashes', () => {
      expect(PathUtils.toDatabasePath('C:\\Users\\test\\file.txt')).toBe('C:/Users/test/file.txt')
    })

    it('should resolve redundant segments', () => {
      expect(PathUtils.toDatabasePath('a/b/../c/./d')).toBe('a/c/d')
      expect(PathUtils.toDatabasePath('C:\\a\\b\\..\\c\\.\\d')).toBe('C:/a/c/d')
    })

    it('should preserve Windows UNC prefix', () => {
      expect(PathUtils.toDatabasePath('\\\\nas\\movies')).toBe('//nas/movies')
      expect(PathUtils.toDatabasePath('//nas/movies')).toBe('//nas/movies')
      expect(PathUtils.toDatabasePath('//nas/movies/./folder/../file')).toBe('//nas/movies/file')
    })
  })

  describe('toOsPath', () => {
    it('should return empty string if input is falsy', () => {
      expect(PathUtils.toOsPath('')).toBe('')
      expect(PathUtils.toOsPath(null as any)).toBe('')
    })

    it('should normalize path for the current OS', () => {
      const p = 'a/b/../c/./d'
      expect(PathUtils.toOsPath(p)).toBe(path.normalize(p))
    })
  })

  describe('arePathsEqual', () => {
    it('should compare paths using database normalization', () => {
      expect(PathUtils.arePathsEqual('C:\\a\\b\\c', 'C:/a/b/c')).toBe(true)
      expect(PathUtils.arePathsEqual('a/b/../c', 'a/c')).toBe(true)
      expect(PathUtils.arePathsEqual('\\\\nas\\movies', '//nas/movies')).toBe(true)
      expect(PathUtils.arePathsEqual('C:/a/b', 'C:/a/c')).toBe(false)
    })
  })

  describe('sanitizeAbsolutePath', () => {
    it('should return empty string if input is falsy', () => {
      expect(PathUtils.sanitizeAbsolutePath('')).toBe('')
    })

    it('should throw an error if path contains null bytes', () => {
      expect(() => PathUtils.sanitizeAbsolutePath('path/with/\0/null')).toThrow('Invalid path: contains null bytes')
    })

    it('should resolve the path to an absolute path', () => {
      const p = 'a/b/c'
      expect(PathUtils.sanitizeAbsolutePath(p)).toBe(path.resolve(p))
    })
  })

  describe('resolveExecutablePath', () => {
    it('should return input if falsy', () => {
      expect(PathUtils.resolveExecutablePath('')).toBe('')
    })

    it('should throw an error if path contains null bytes', () => {
      expect(() => PathUtils.resolveExecutablePath('tool/\0/path')).toThrow('Invalid executable path: contains null bytes')
    })

    it('should resolve to absolute if it contains path separator', () => {
      const p = 'a/b/tool'
      expect(PathUtils.resolveExecutablePath(p)).toBe(path.resolve(p))
    })

    it('should resolve to absolute if it is already absolute', () => {
      const p = path.resolve('tool')
      expect(PathUtils.resolveExecutablePath(p)).toBe(path.resolve(p))
    })

    it('should return the tool name if it does not contain separators', () => {
      expect(PathUtils.resolveExecutablePath('tool')).toBe('tool')
    })
  })

  describe('getPossibleExecutablePaths', () => {
    const originalPlatform = process.platform

    afterEach(() => {
      Object.defineProperty(process, 'platform', { value: originalPlatform })
    })

    it('should generate paths for win32', () => {
      Object.defineProperty(process, 'platform', { value: 'win32' })
      const paths = PathUtils.getPossibleExecutablePaths('ffmpeg', 'bundled/ffmpeg.exe', ['C:\\Custom\\ffmpeg.exe'])
      expect(paths).toContain('bundled/ffmpeg.exe')
      expect(paths).toContain('ffmpeg.exe')
      expect(paths).toContain('C:\\Program Files\\ffmpeg\\ffmpeg.exe')
      expect(paths).toContain('C:\\Program Files\\ffmpeg\\bin\\ffmpeg.exe')
      expect(paths).toContain('C:\\ffmpeg\\bin\\ffmpeg.exe')
      expect(paths).toContain('C:\\Custom\\ffmpeg.exe')

      const noBundled = PathUtils.getPossibleExecutablePaths('ffmpeg')
      expect(noBundled).toContain('ffmpeg.exe')
    })

    it('should generate paths for darwin (macOS)', () => {
      Object.defineProperty(process, 'platform', { value: 'darwin' })
      const paths = PathUtils.getPossibleExecutablePaths('ffmpeg', '/bundled/ffmpeg')
      expect(paths).toContain('/bundled/ffmpeg')
      expect(paths).toContain('ffmpeg')
      expect(paths).toContain('/usr/local/bin/ffmpeg')
      expect(paths).toContain('/opt/homebrew/bin/ffmpeg')

      const handbrake = PathUtils.getPossibleExecutablePaths('HandBrakeCLI')
      expect(handbrake).toContain('/Applications/HandBrake.app/Contents/MacOS/HandBrakeCLI')
    })

    it('should generate paths for linux (other)', () => {
      Object.defineProperty(process, 'platform', { value: 'linux' })
      const paths = PathUtils.getPossibleExecutablePaths('ffmpeg', '/bundled/ffmpeg')
      expect(paths).toContain('/bundled/ffmpeg')
      expect(paths).toContain('ffmpeg')
      expect(paths).toContain('/usr/bin/ffmpeg')
      expect(paths).toContain('/usr/local/bin/ffmpeg')
    })

    it('should deduplicate paths', () => {
      Object.defineProperty(process, 'platform', { value: 'linux' })
      const paths = PathUtils.getPossibleExecutablePaths('ffmpeg', '/usr/bin/ffmpeg')
      // /usr/bin/ffmpeg is added twice (once as bundled, once as default)
      // but should appear only once
      const count = paths.filter(p => p === '/usr/bin/ffmpeg').length
      expect(count).toBe(1)
    })
  })
})
