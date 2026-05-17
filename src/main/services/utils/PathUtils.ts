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
  static toDatabasePath(filePath: string): string {
    if (!filePath) return ''
    
    // First, convert all backslashes to forward slashes to ensure posix-style normalization works everywhere
    let normalized = filePath.replace(/\\/g, '/')
    
    // Preserve Windows UNC prefix (e.g., //nas/movies)
    const isUnc = normalized.startsWith('//')
    
    // Resolve redundant segments using posix normalization (which works on forward slashes)
    normalized = path.posix.normalize(normalized)
    
    // If it was a UNC path, ensure it has the double slash (posix.normalize might reduce // to /)
    if (isUnc && !normalized.startsWith('//')) {
      normalized = '/' + normalized
    }
    
    return normalized
  }

  /**
   * Normalizes a path for the current Operating System.
   * Useful when retrieving a path from the DB to perform FS operations.
   */
  static toOsPath(filePath: string): string {
    if (!filePath) return ''
    return path.normalize(filePath)
  }

  /**
   * Checks if two paths are equivalent regardless of separator style.
   */
  static arePathsEqual(pathA: string, pathB: string): boolean {
    return this.toDatabasePath(pathA) === this.toDatabasePath(pathB)
  }
}
