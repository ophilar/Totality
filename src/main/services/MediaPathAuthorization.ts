import path from 'node:path'
import { PathUtils } from './utils/PathUtils'

export interface MediaSourcePathContext {
  source_type?: string
  connection_config?: string
}

export class MediaPathAuthorization {
  private readonly roots: string[]

  constructor(roots: string[]) {
    this.roots = roots.map(root => path.resolve(PathUtils.sanitizeAbsolutePath(root)))
  }

  assertAuthorized(filePath: string): true {
    if (this.roots.length === 0) throw new Error('No registered library roots are available')
    const candidate = path.resolve(PathUtils.sanitizeAbsolutePath(filePath))
    const authorized = this.roots.some(root => candidate === root || candidate.startsWith(`${root}${path.sep}`))
    if (!authorized) throw new Error('Media file is outside registered library roots')
    return true
  }

  static extractRootsFromSource(source: MediaSourcePathContext): string[] {
    if (!source.connection_config) return []
    let config: Record<string, unknown>
    try {
      config = JSON.parse(source.connection_config) as Record<string, unknown>
    } catch {
      return []
    }

    const roots: string[] = []
    if (typeof config.folderPath === 'string' && config.folderPath.length > 0) roots.push(config.folderPath)
    if (typeof config.rootPath === 'string' && config.rootPath.length > 0) roots.push(config.rootPath)
    if (Array.isArray(config.paths)) {
      for (const p of config.paths) {
        if (typeof p === 'string' && p.length > 0) roots.push(p)
      }
    }
    if (Array.isArray(config.customLibraries)) {
      for (const lib of config.customLibraries) {
        if (lib && typeof lib === 'object' && typeof (lib as { path?: unknown }).path === 'string' && (lib as { path: string }).path.length > 0) {
          roots.push((lib as { path: string }).path)
        }
      }
    }
    if (Array.isArray(config.libraries)) {
      for (const lib of config.libraries) {
        if (lib && typeof lib === 'object' && typeof (lib as { path?: unknown }).path === 'string' && (lib as { path: string }).path.length > 0) {
          roots.push((lib as { path: string }).path)
        }
      }
    }
    return roots
  }

  static assertMediaAuthorized(item: { file_path?: string | null }, source: MediaSourcePathContext): true {
    if (!item?.file_path) throw new Error('Media item has no local source path')
    PathUtils.sanitizeAbsolutePath(item.file_path)

    const roots = MediaPathAuthorization.extractRootsFromSource(source)
    if (source.source_type === 'local') {
      new MediaPathAuthorization(roots).assertAuthorized(item.file_path)
    } else if (roots.length > 0) {
      new MediaPathAuthorization(roots).assertAuthorized(item.file_path)
    }
    return true
  }
}
