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
    if (path.isAbsolute(toolPath) || toolPath.includes(path.sep)) {
      return path.resolve(toolPath)
    }
    return toolPath
  }

  /**
   * Generates a list of possible paths for a given executable binary,
   * allowing services to test and automatically find system dependencies.
   * @param binaryName Base name of the binary (e.g. 'ffmpeg', 'HandBrakeCLI')
   * @param bundledPath Optional path to a bundled version of the binary
   * @param extraWindowsPaths Additional expected install locations on Windows
   */
  static getPossibleExecutablePaths(
    binaryName: string,
    bundledPath?: string,
    extraWindowsPaths: string[] = []
  ): string[] {
    const isWin = process.platform === 'win32'
    const ext = isWin ? '.exe' : ''
    const fullName = binaryName + ext

    const paths: string[] = []
    if (bundledPath) {
      paths.push(bundledPath)
    }

    // Always include bare binary name to rely on system PATH
    paths.push(fullName)

    if (isWin) {
      // Common Windows installation paths
      paths.push(`C:\\Program Files\\${binaryName}\\${fullName}`)
      paths.push(`C:\\Program Files\\${binaryName}\\bin\\${fullName}`)
      paths.push(`C:\\${binaryName}\\bin\\${fullName}`)
      // Custom extra paths provided by caller
      for (const p of extraWindowsPaths) {
        paths.push(p)
      }
    } else if (process.platform === 'darwin') {
      paths.push(`/usr/local/bin/${binaryName}`)
      paths.push(`/opt/homebrew/bin/${binaryName}`)
      if (binaryName.toLowerCase().includes('handbrake')) {
        paths.push(`/Applications/HandBrake.app/Contents/MacOS/HandBrakeCLI`)
      }
    } else {
      paths.push(`/usr/bin/${binaryName}`)
      paths.push(`/usr/local/bin/${binaryName}`)
    }

    // Deduplicate array
    return Array.from(new Set(paths))
  }
}
