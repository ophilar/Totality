import { BrowserWindow } from 'electron'
import { safeSend } from '@main/ipc/utils/safeSend'

export class StatsCacheService {
  private seriesStats: any = null
  private collectionStats: any = null
  private musicCompleteness: Map<string, any> = new Map()

  async getSeriesStats(fetchFn: () => Promise<any>): Promise<any> {
    if (this.seriesStats !== null) {
      return this.seriesStats
    }
    const data = await fetchFn()
    this.seriesStats = data
    return data
  }

  async getCollectionStats(fetchFn: () => Promise<any>): Promise<any> {
    if (this.collectionStats !== null) {
      return this.collectionStats
    }
    const data = await fetchFn()
    this.collectionStats = data
    return data
  }

  async getMusicCompleteness(key: string, fetchFn: () => Promise<any>): Promise<any> {
    if (this.musicCompleteness.has(key)) {
      return this.musicCompleteness.get(key)
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
