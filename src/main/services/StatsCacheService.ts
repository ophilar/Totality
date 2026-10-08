import { BrowserWindow } from 'electron'
import { safeSend } from '@main/ipc/utils/safeSend'

export class StatsCacheService {
  private seriesStats: unknown = null
  private collectionStats: unknown = null
  private musicCompleteness: Map<string, unknown> = new Map()

  async getSeriesStats<T>(fetchFn: () => Promise<T>): Promise<T> {
    if (this.seriesStats !== null) {
      return this.seriesStats as T
    }
    const data = await fetchFn()
    this.seriesStats = data
    return data
  }

  async getCollectionStats<T>(fetchFn: () => Promise<T>): Promise<T> {
    if (this.collectionStats !== null) {
      return this.collectionStats as T
    }
    const data = await fetchFn()
    this.collectionStats = data
    return data
  }

  async getMusicCompleteness<T>(key: string, fetchFn: () => Promise<T>): Promise<T> {
    if (this.musicCompleteness.has(key)) {
      return this.musicCompleteness.get(key) as T
    }
    const data = await fetchFn()
    this.musicCompleteness.set(key, data)
    return data
  }

  invalidate(): void {
    this.seriesStats = null
    this.collectionStats = null
    this.musicCompleteness.clear()

    // Notify all open UI windows reactively via library:updated
    for (const win of BrowserWindow.getAllWindows()) {
      safeSend(win, 'library:updated', { type: 'stats-cache-invalidated' })
    }
  }
}

let instance: StatsCacheService | null = null
export function getStatsCacheService(): StatsCacheService {
  return instance ??= new StatsCacheService()
}
