import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { PathUtils } from '@main/services/utils/PathUtils'

describe('PathUtils portability', () => {
  it('normalizes POSIX paths without changing their root', () => {
    expect(PathUtils.toDatabasePath('/srv/media/../movie.mkv')).toBe('/srv/movie.mkv')
    expect(PathUtils.toDatabasePath('folder/./nested/../movie.mkv')).toBe('folder/movie.mkv')
  })

  it('preserves Windows drive roots when traversing above the drive root', () => {
    expect(PathUtils.toDatabasePath('C:\\media\\movies\\..\\movie.mkv')).toBe('C:/media/movie.mkv')
    expect(PathUtils.toDatabasePath('C:/media/../../movie.mkv')).toBe('C:/movie.mkv')
    expect(PathUtils.toDatabasePath('D:\\..\\movie.mkv')).toBe('D:/movie.mkv')
  })

  it('keeps UNC server and share roots intact', () => {
    expect(PathUtils.toDatabasePath('\\\\NAS\\Movies\\Matrix.mkv')).toBe('//NAS/Movies/Matrix.mkv')
    expect(PathUtils.toDatabasePath('//NAS/Movies/../../movie.mkv')).toBe('//NAS/Movies/movie.mkv')
    expect(PathUtils.toDatabasePath('\\\\NAS\\Movies')).toBe('//NAS/Movies')
  })

  it('is idempotent across platform-independent database paths', () => {
    for (const filePath of ['C:\\media\\movie.mkv', '\\\\NAS\\Movies\\movie.mkv', '/srv/media/movie.mkv']) {
      const normalized = PathUtils.toDatabasePath(filePath)
      expect(PathUtils.toDatabasePath(normalized)).toBe(normalized)
    }
  })

  it('keeps real OS paths native when used for filesystem operations', () => {
    const relative = 'media/subdir/../movie.mkv'
    expect(PathUtils.toOsPath(relative)).toBe(path.normalize(relative))
    expect(PathUtils.sanitizeAbsolutePath(relative)).toBe(path.resolve(relative))
  })

  it('rejects sibling paths and traversal without a string-prefix bypass', () => {
    const root = path.resolve('media', 'library')
    expect(PathUtils.isWithinRoot(path.join(root, 'movie.mkv'), root)).toBe(true)
    expect(PathUtils.isWithinRoot(root, root)).toBe(true)
    expect(PathUtils.isWithinRoot(path.resolve(root, '..', 'library-private', 'movie.mkv'), root)).toBe(false)
    expect(PathUtils.isWithinRoot(path.join(root, '..', 'private', 'movie.mkv'), root)).toBe(false)
  })

  it('rejects null bytes and retains bare executable names for PATH lookup', () => {
    expect(() => PathUtils.sanitizeAbsolutePath('media/\0/movie.mkv')).toThrow('contains null bytes')
    expect(() => PathUtils.resolveExecutablePath('bin/\0/tool')).toThrow('contains null bytes')
    expect(PathUtils.resolveExecutablePath('ffprobe')).toBe('ffprobe')
    expect(PathUtils.resolveExecutablePath('tools/ffprobe')).toBe(path.resolve('tools/ffprobe'))
  })
})
