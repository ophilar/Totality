
import * as path from 'node:path'

/**
 * PathUtils
 * 
 * Provides centralized path normalization to ensure cross-platform resilience.
 * Mandate: Database paths MUST use forward slashes (/) to remain searchable across OSs.
 */
export class PathUtils {
  /**
   * Normalizes a path for database storage.
   * - Converts all backslashes to forward slashes.
   * - Resolves redundant segments.
   * - Handles Windows UNC paths by preserving the leading double-slash but normalizing separators.
   */
  static toDatabasePath(filePath: string | null | undefined): string {
    if (!filePath) return ''
    
    // Database paths use '/' regardless of the host OS. Windows absolute paths
    // must be normalized with win32 rules to retain the drive or UNC share root.
    const unified = filePath.replace(/\\/g, '/')
    const isDriveAbsolute = /^[A-Za-z]:\//.test(unified)
    const isUnc = /^\/\/[^/]+\/[^/]+(?:\/|$)/.test(unified)
    if (isDriveAbsolute || isUnc) {
      let normalized = path.win32.normalize(unified).replace(/\\/g, '/')
      // win32.normalize adds a trailing slash to a bare UNC share root.
      if (isUnc && !unified.endsWith('/') && normalized.endsWith('/')) {
        normalized = normalized.slice(0, -1)
      }
      return normalized
    }

    // Keep existing POSIX handling, including the legacy double-slash prefix
    // for incomplete UNC-style paths such as //host.
    let normalized = path.posix.normalize(unified)
    if (unified.startsWith('//') && !normalized.startsWith('//')) {
      normalized = '/' + normalized
    }
    return normalized
  }

  /**
   * Normalizes a path for the current Operating System.
   * Useful when retrieving a path from the DB to perform FS operations.
   */
  static toOsPath(filePath: string | null | undefined): string {
    if (!filePath) return ''
    return path.normalize(filePath)
  }

  /**
   * Checks if two paths are equivalent regardless of separator style.
   */
  static arePathsEqual(pathA: string, pathB: string): boolean {
    return this.toDatabasePath(pathA) === this.toDatabasePath(pathB)
  }

  /**
   * Checks if childPath is strictly equal to rootPath or is a descendant of rootPath.
   * Prevents path traversal and sibling folder false positives (e.g. /media/library-private matching /media/library).
   */
  static isWithinRoot(childPath: string, rootPath: string): boolean {
    if (!childPath || !rootPath) return false
    try {
      const resolvedChild = path.resolve(this.sanitizeAbsolutePath(childPath))
      const resolvedRoot = path.resolve(this.sanitizeAbsolutePath(rootPath))
      const relative = path.relative(resolvedRoot, resolvedChild)
      return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
    } catch {
      return false
    }
  }

  /**
   * Strictly sanitizes an arbitrary file path to prevent command injection and ensure it is absolute.
   * Rejects paths containing null bytes.
   */
  static sanitizeAbsolutePath(filePath: string): string {
    if (!filePath) return ''
    if (filePath.includes('\0')) {
      throw new Error('Invalid path: contains null bytes')
    }
    return path.resolve(filePath)
  }

  /**
   * Resolves the path for an executable.
   * If the path contains path separators, it resolves it to an absolute path.
   * Otherwise, it relies on the system's PATH.
   */
  static resolveExecutablePath(toolPath: string): string {
    if (!toolPath) return toolPath
    if (toolPath.includes('\0')) {
      throw new Error('Invalid executable path: contains null bytes')
    }
    if (path.isAbsolute(toolPath) || toolPath.includes('/') || toolPath.includes('\\')) {
      return path.resolve(toolPath)
    }
    return toolPath
  }
}
