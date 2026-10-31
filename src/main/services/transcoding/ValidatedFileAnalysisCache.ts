import { stat as statFile, type Stats } from 'node:fs/promises'

/** LRU cache of completed file analyses. File identity includes metadata that changes on replacement. */
export class ValidatedFileAnalysisCache<T extends { success: boolean }> {
  private readonly entries = new Map<string, { signature: string; value: T }>()
  private readonly pending = new Map<string, Promise<T>>()

  constructor(private readonly maximumEntries = 128) {
    if (!Number.isInteger(maximumEntries) || maximumEntries < 1) throw new Error('Analysis cache capacity must be positive')
  }

  private signature(stat: Pick<Stats, 'size' | 'mtimeMs' | 'ctimeMs' | 'ino'>): string {
    return JSON.stringify([stat.size, stat.mtimeMs, stat.ctimeMs, stat.ino])
  }

  set(filePath: string, stat: Pick<Stats, 'size' | 'mtimeMs' | 'ctimeMs' | 'ino'>, value: T): void {
    if (!value.success) return
    this.entries.delete(filePath)
    this.entries.set(filePath, { signature: this.signature(stat), value })
    while (this.entries.size > this.maximumEntries) this.entries.delete(this.entries.keys().next().value!)
  }

  async get(filePath: string, load: () => Promise<T>): Promise<T> {
    const before = await statFile(filePath)
    const signature = this.signature(before)
    const cached = this.entries.get(filePath)
    if (cached?.signature === signature) {
      this.entries.delete(filePath)
      this.entries.set(filePath, cached)
      return cached.value
    }
    if (cached) this.entries.delete(filePath)
    const pendingKey = JSON.stringify([filePath, signature])
    const existing = this.pending.get(pendingKey)
    if (existing) return existing
    const promise = (async () => {
      const analysis = await load()
      const after = await statFile(filePath)
      if (signature !== this.signature(after)) throw new Error('Source file changed during media analysis; retry after the file settles')
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
