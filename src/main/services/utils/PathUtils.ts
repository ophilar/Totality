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
    
    // Normalize using standard path module first to resolve segments
    let normalized = path.normalize(filePath)
    
    // Preserve UNC prefix if on Windows
    const isUnc = normalized.startsWith('\\\\') || normalized.startsWith('//')
    
    // Convert all to forward slashes
    normalized = normalized.replace(/\\/g, '/')
    
    // Ensure UNC paths start with // if they were normalized away (unlikely with replace)
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
