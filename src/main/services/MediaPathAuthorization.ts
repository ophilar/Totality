import path from 'node:path'
import { PathUtils } from './utils/PathUtils'

export interface MediaSourcePathContext {
  source_type?: string
  connection_config?: string
}

export class MediaPathAuthorization {
  private readonly roots: string[]

  constructor(roots: string[]) {
    this.roots = roots
      .filter((root): root is string => typeof root === 'string' && root.trim().length > 0)
      .map(root => path.resolve(PathUtils.sanitizeAbsolutePath(root)))
  }

  isAuthorized(filePath: string): boolean {
    if (this.roots.length === 0 || !filePath) return false
    try {
      const sanitized = PathUtils.sanitizeAbsolutePath(filePath)
      return this.roots.some(root => PathUtils.isWithinRoot(sanitized, root))
    } catch {
      return false
    }
  }

  assertAuthorized(filePath: string): true {
    if (this.roots.length === 0) {
      throw new Error('No registered library roots are available')
    }
    if (!filePath) {
      throw new Error('Media item has no local source path')
    }
    const sanitized = PathUtils.sanitizeAbsolutePath(filePath)
    const authorized = this.roots.some(root => PathUtils.isWithinRoot(sanitized, root))
    if (!authorized) {
      throw new Error('Media file is outside registered library roots')
    }
    return true
  }

  static extractRootsFromSource(source: MediaSourcePathContext): string[] {
    if (!source || !source.connection_config) return []
    let config: Record<string, unknown>
    try {
      config = JSON.parse(source.connection_config) as Record<string, unknown>
    } catch (err) {
      throw new Error(`Malformed connection configuration: ${err instanceof Error ? err.message : String(err)}`)
    }

    if (!config || typeof config !== 'object') {
      throw new Error('Malformed connection configuration: expected JSON object')
    }

    const roots: string[] = []
    if (typeof config.folderPath === 'string' && config.folderPath.trim().length > 0) {
      roots.push(config.folderPath.trim())
    }
    if (typeof config.rootPath === 'string' && config.rootPath.trim().length > 0) {
      roots.push(config.rootPath.trim())
    }
    if (typeof config.databasePath === 'string' && config.databasePath.trim().length > 0) {
      roots.push(path.dirname(config.databasePath.trim()))
    }
    if (Array.isArray(config.paths)) {
      for (const p of config.paths) {
        if (typeof p === 'string' && p.trim().length > 0) {
          roots.push(p.trim())
        }
      }
    }
    if (Array.isArray(config.customLibraries)) {
      for (const lib of config.customLibraries) {
        if (lib && typeof lib === 'object' && typeof (lib as { path?: unknown }).path === 'string' && (lib as { path: string }).path.trim().length > 0) {
          roots.push((lib as { path: string }).path.trim())
        }
      }
    }
    if (Array.isArray(config.libraries)) {
      for (const lib of config.libraries) {
        if (lib && typeof lib === 'object' && typeof (lib as { path?: unknown }).path === 'string' && (lib as { path: string }).path.trim().length > 0) {
          roots.push((lib as { path: string }).path.trim())
        }
      }
    }
    return roots
  }

  static assertMediaAuthorized(item: { file_path?: string | null }, source: MediaSourcePathContext): true {
    if (!item?.file_path) {
      throw new Error('Media item has no local source path')
    }
    PathUtils.sanitizeAbsolutePath(item.file_path)

    const roots = MediaPathAuthorization.extractRootsFromSource(source)
    if (roots.length === 0) {
      throw new Error('No registered library roots are available for source authorization')
    }
    new MediaPathAuthorization(roots).assertAuthorized(item.file_path)
    return true
  }
}
