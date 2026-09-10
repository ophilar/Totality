import { describe, it, expect } from 'vitest'
import * as path from 'node:path'
import { PathUtils } from '../../src/main/services/utils/PathUtils'

describe('PathUtils', () => {
  describe('toDatabasePath', () => {
    it('should return empty string if input is falsy', () => {
      expect(PathUtils.toDatabasePath('')).toBe('')
      expect(PathUtils.toDatabasePath(null)).toBe('')
      expect(PathUtils.toDatabasePath(undefined)).toBe('')
    })

    it('should convert backslashes to forward slashes', () => {
      expect(PathUtils.toDatabasePath('C:\\Users\\test\\file.txt')).toBe('C:/Users/test/file.txt')
    })

    it('should normalize relative paths', () => {
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
      expect(PathUtils.toOsPath(null)).toBe('')
      expect(PathUtils.toOsPath(undefined)).toBe('')
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

  describe('isWithinRoot', () => {
    it('should return true for child files and nested directories', () => {
      expect(PathUtils.isWithinRoot('C:/media/library/movie.mkv', 'C:/media/library')).toBe(true)
      expect(PathUtils.isWithinRoot('C:/media/library/sub/season1/ep1.mkv', 'C:/media/library')).toBe(true)
      expect(PathUtils.isWithinRoot('C:/media/library', 'C:/media/library')).toBe(true)
    })

    it('should return false for sibling directories and traversal attempts', () => {
      expect(PathUtils.isWithinRoot('C:/media/library-private/movie.mkv', 'C:/media/library')).toBe(false)
      expect(PathUtils.isWithinRoot('C:/media/library/../private/movie.mkv', 'C:/media/library')).toBe(false)
      expect(PathUtils.isWithinRoot('D:/media/library/movie.mkv', 'C:/media/library')).toBe(false)
      expect(PathUtils.isWithinRoot('', 'C:/media/library')).toBe(false)
      expect(PathUtils.isWithinRoot('C:/media/library/movie.mkv', '')).toBe(false)
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
})
