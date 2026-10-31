import { stat as statFile } from 'node:fs/promises'
import type { Stats } from 'node:fs'

/** One source-file identity rule for hot and persisted analysis reuse. */
export type FileIdentity = Pick<Stats, 'size' | 'mtimeMs' | 'ctimeMs' | 'ino'>

export function fileIdentity(stat: FileIdentity): FileIdentity {
  return { size: stat.size, mtimeMs: stat.mtimeMs, ctimeMs: stat.ctimeMs, ino: stat.ino }
}

export function matchesFileIdentity(saved: Partial<FileIdentity> | null | undefined, actual: FileIdentity): boolean {
  return Boolean(saved && saved.size === actual.size && saved.mtimeMs === actual.mtimeMs &&
    saved.ctimeMs === actual.ctimeMs && saved.ino === actual.ino)
}

/** LRU cache of completed file analyses. File identity includes metadata that changes on replacement. */
export class ValidatedFileAnalysisCache<T extends { success: boolean }> {
  private readonly entries = new Map<string, { identity: FileIdentity; value: T }>()
  private readonly pending = new Map<string, Promise<T>>()

  constructor(private readonly maximumEntries = 128) {
    if (!Number.isInteger(maximumEntries) || maximumEntries < 1) throw new Error('Analysis cache capacity must be positive')
  }

  set(filePath: string, stat: FileIdentity, value: T): void {
    if (!value.success) return
    this.entries.delete(filePath)
    this.entries.set(filePath, { identity: fileIdentity(stat), value })
    while (this.entries.size > this.maximumEntries) this.entries.delete(this.entries.keys().next().value!)
  }

  async get(filePath: string, load: () => Promise<T>): Promise<T> {
    const before = await statFile(filePath)
    const identity = fileIdentity(before)
    const cached = this.entries.get(filePath)
    if (matchesFileIdentity(cached?.identity, identity)) {
      this.entries.delete(filePath)
      this.entries.set(filePath, cached)
      return cached.value
    }
    if (cached) this.entries.delete(filePath)
    const pendingKey = JSON.stringify([filePath, identity])
    const existing = this.pending.get(pendingKey)
    if (existing) return existing
    const promise = (async () => {
      const analysis = await load()
      const after = await statFile(filePath)
      if (!matchesFileIdentity(identity, after)) throw new Error('Source file changed during media analysis; retry after the file settles')
      this.set(filePath, after, analysis)
      return analysis
    })()
    this.pending.set(pendingKey, promise)
    try {
      return await promise
    } finally {
      this.pending.delete(pendingKey)
    }
  }

  delete(filePath: string): void { this.entries.delete(filePath) }
  clear(): void { this.entries.clear() }
  get size(): number { return this.entries.size }
}
