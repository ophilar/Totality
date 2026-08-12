import path from 'node:path'
import { PathUtils } from './utils/PathUtils'

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
}
