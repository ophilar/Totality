import { IPC_CHANNELS } from '@main/constants/ipcChannels'
import { getLoggingService } from '@main/services/LoggingService'
import { shell, dialog, BrowserWindow } from 'electron'
import { promises as fs } from 'fs'
import { getDatabase } from '@main/database/BetterSQLiteService'
import { getStoreSearchService } from '@main/services/StoreSearchService'
import { getTMDBService } from '@main/services/TMDBService'
import type { WishlistItem } from '@main/types/database'
import type { StoreRegion } from '@main/services/StoreSearchService'
import { PositiveIntSchema, WishlistItemSchema, WishlistFiltersSchema, SafeUrlSchema, StoreRegionSchema } from '@main/validation/schemas'
import { z } from 'zod'
import { createIpcHandler, createIpcHandlerWithEvent, createValidatedIpcHandler, createValidatedIpcHandlerWithEvent } from '@main/ipc/utils/createHandler'

import { registerListHandlers } from '@main/ipc/utils/genericHandlers'

export function registerWishlistHandlers() {
  const db = getDatabase()
  const storeService = getStoreSearchService()

  registerListHandlers('wishlist', (f) => db.wishlist.getItems(f as any), () => db.wishlist.getCount(), WishlistFiltersSchema, {
    listAlias: 'wishlist:getAll',
    countAlias: 'wishlist:getCount'
  })

  createValidatedIpcHandler(IPC_CHANNELS.WISHLIST.ADD, WishlistItemSchema, async (item) => {
    if (item.tmdb_id && !item.poster_url) {
      try {
        const tmdb = getTMDBService()
        const details = item.media_type === 'movie' ? await tmdb.getMovieDetails(item.tmdb_id) : await tmdb.getTVShowDetails(item.tmdb_id)
        item.poster_url = tmdb.buildImageUrl(details.poster_path, 'w300') ?? undefined
      } catch { /* ignore */ }
    }
    return await db.wishlist.add(item as any)
  })

  createValidatedIpcHandler(IPC_CHANNELS.WISHLIST.UPDATE, z.tuple([PositiveIntSchema, WishlistItemSchema.partial()]), async (id, updates) => {
    await db.wishlist.update(id, updates as any)
    return { success: true }
  })

  createValidatedIpcHandler(IPC_CHANNELS.WISHLIST.REMOVE, PositiveIntSchema, async (id) => {
    await db.wishlist.delete(id)
    return { success: true }
  })

  createValidatedIpcHandler('wishlist:getById', PositiveIntSchema, async (id) => db.wishlist.getWishlistItemById(id))

  createIpcHandler(IPC_CHANNELS.WISHLIST.CHECK_EXISTS, async (tmdbId?: string, musicbrainzId?: string, mediaItemId?: number) => {
    return await db.wishlist.exists(tmdbId, musicbrainzId, mediaItemId)
  })

  createIpcHandler(IPC_CHANNELS.WISHLIST.GET_COUNTS_BY_REASON, async () => db.wishlist.getCountsByReason())

  createValidatedIpcHandler(IPC_CHANNELS.WISHLIST.ADD_BULK, z.array(WishlistItemSchema), async (items) => {
    const tmdb = getTMDBService()
    for (const item of items) {
      if (item.tmdb_id && !item.poster_url) {
        try {
          const d = item.media_type === 'movie' ? await tmdb.getMovieDetails(item.tmdb_id) : await tmdb.getTVShowDetails(item.tmdb_id)
          item.poster_url = tmdb.buildImageUrl(d.poster_path, 'w300') ?? undefined
        } catch { /* ignore */ }
      }
    }
    return { success: true, added: await db.wishlist.addMany(items as any) }
  })

  createValidatedIpcHandler(IPC_CHANNELS.WISHLIST.GET_STORE_LINKS, WishlistItemSchema, async (item) => storeService.getStoreLinks(item as any))

  createValidatedIpcHandler(IPC_CHANNELS.WISHLIST.OPEN_STORE_LINK, SafeUrlSchema, async (url) => {
    await shell.openExternal(url)
    return { success: true }
  })

  createValidatedIpcHandler(IPC_CHANNELS.WISHLIST.SET_REGION, StoreRegionSchema, async (region) => {
    storeService.setRegion(region as StoreRegion)
    await db.config.setSetting('store_region', region)
    return { success: true }
  })

  createIpcHandler(IPC_CHANNELS.WISHLIST.GET_REGION, async () => (await db.config.getSetting('store_region')) || 'us')

  createIpcHandlerWithEvent(IPC_CHANNELS.WISHLIST.EXPORT_CSV, async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) throw new Error('No window')
    const res = await dialog.showSaveDialog(win, { title: 'Export Wishlist', defaultPath: `Totality Wishlist - ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).replace(',', '')}.csv`, filters: [{ name: 'CSV Files', extensions: ['csv'] }, { name: 'All Files', extensions: ['*'] }] })
    if (res.canceled || !res.filePath) return { success: false, cancelled: true }
    const items = await db.wishlist.getItems({ sortBy: 'priority', sortOrder: 'desc' })
    await fs.writeFile(res.filePath, generateWishlistCsv(items), 'utf-8')
    return { success: true, path: res.filePath, count: items.length }
  })

  getLoggingService().info('[wishlist]', 'Wishlist IPC handlers registered')
}

/**
 * Generate branded CSV content from wishlist items
 */
function generateWishlistCsv(items: WishlistItem[]): string {
  // BOM for Excel UTF-8 compatibility
  const BOM = '\uFEFF'
  const numColumns = 10
  const emptyRow = ','.repeat(numColumns - 1)

  // Escape CSV field (handle commas, quotes, newlines)
  const escapeField = (value: string | number | null | undefined): string => {
    if (value === null || value === undefined) return ''
    const str = String(value)
    if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
      return `"${str.replace(/"/g, '""')}"`
    }
    return str
  }

  // Create a row with content in first cell, rest empty (for headers/labels)
  const labelRow = (text: string): string => {
    return escapeField(text) + ','.repeat(numColumns - 1)
  }

  // Format priority as stars
  const formatPriority = (priority: number): string => {
    return '\u2605'.repeat(priority) + '\u2606'.repeat(5 - priority)
  }

  // Format quality info for upgrades
  const formatQuality = (item: WishlistItem): string => {
    if (item.reason !== 'upgrade') return ''
    const parts: string[] = []
    if (item.current_resolution) parts.push(item.current_resolution)
    if (item.current_quality_level) parts.push(`(${item.current_quality_level})`)
    if (item.current_video_codec) parts.push(item.current_video_codec.toUpperCase())
    return parts.join(' ')
  }

  // Format media type for display
  const formatMediaType = (type: string): string => {
    const typeMap: Record<string, string> = {
      movie: 'Movie',
      season: 'TV Season',
      episode: 'TV Episode',
      album: 'Album',
      track: 'Track'
    }
    return typeMap[type] || type.charAt(0).toUpperCase() + type.slice(1)
  }

  // Separate items by reason
  const missingItems = items.filter(i => i.reason === 'missing')
  const upgradeItems = items.filter(i => i.reason === 'upgrade')

  // Sort within each group: by media_type, then by priority desc, then by title
  const sortGroup = (group: WishlistItem[]): WishlistItem[] => {
    return [...group].sort((a, b) => {
      if (a.media_type !== b.media_type) {
        return a.media_type.localeCompare(b.media_type)
      }
      if (a.priority !== b.priority) {
        return b.priority - a.priority
      }
      return a.title.localeCompare(b.title)
    })
  }

  const sortedMissing = sortGroup(missingItems)
  const sortedUpgrade = sortGroup(upgradeItems)

  // Count by media type
  const countByType = (group: WishlistItem[]): string => {
    const movies = group.filter(i => i.media_type === 'movie').length
    const tv = group.filter(i => ['season', 'episode'].includes(i.media_type)).length
    const music = group.filter(i => ['album', 'track'].includes(i.media_type)).length
    const parts: string[] = []
    if (movies > 0) parts.push(`${movies} movie${movies !== 1 ? 's' : ''}`)
    if (tv > 0) parts.push(`${tv} TV`)
    if (music > 0) parts.push(`${music} music`)
    return parts.join(' · ')
  }

  // Format date nicely
  const formatDate = (dateStr: string): string => {
    const date = new Date(dateStr)
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  }

  // Build the CSV
  const rows: string[] = []

  // ═══════════════════════════════════════════════════════════════════════════
  // BRANDED HEADER
  // ═══════════════════════════════════════════════════════════════════════════
  rows.push(labelRow('╔══════════════════════════════════════════════════════════════════════════════╗'))
  rows.push(labelRow('║                           TOTALITY MEDIA WISHLIST                            ║'))
  rows.push(labelRow('╚══════════════════════════════════════════════════════════════════════════════╝'))
  rows.push(emptyRow)

  // Export info
  const exportDate = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  })
  rows.push(labelRow(`Exported: ${exportDate}`))
  rows.push(labelRow(`Total Items: ${items.length}`))
  rows.push(emptyRow)

  // Summary stats
  if (missingItems.length > 0) {
    rows.push(labelRow(`▸ Complete Collection: ${missingItems.length} items (${countByType(missingItems)})`))
  }
  if (upgradeItems.length > 0) {
    rows.push(labelRow(`▸ Quality Upgrades: ${upgradeItems.length} items (${countByType(upgradeItems)})`))
  }
  rows.push(emptyRow)
  rows.push(emptyRow)

  // ═══════════════════════════════════════════════════════════════════════════
  // COMPLETE COLLECTION SECTION
  // ═══════════════════════════════════════════════════════════════════════════
  if (sortedMissing.length > 0) {
    rows.push(labelRow('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'))
    rows.push(labelRow(`COMPLETE YOUR COLLECTION (${sortedMissing.length} items)`))
    rows.push(labelRow('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'))
    rows.push(emptyRow)

    // Column headers for this section
    const missingHeaders = ['', 'Type', 'Title', 'Year', 'Series/Artist', 'Season', 'Priority', '', 'Notes', 'Added']
    rows.push(missingHeaders.map(escapeField).join(','))

    for (const item of sortedMissing) {
      const row = [
        '☐',  // Checkbox for shopping
        formatMediaType(item.media_type),
        item.title,
        item.year || '',
        item.series_title || item.artist_name || '',
        item.media_type === 'season' && item.season_number !== undefined ? `Season ${item.season_number}` : '',
        formatPriority(item.priority),
        '',
        item.notes || '',
        item.added_at ? formatDate(item.added_at) : ''
      ]
      rows.push(row.map(escapeField).join(','))
    }
    rows.push(emptyRow)
    rows.push(emptyRow)
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // QUALITY UPGRADES SECTION
  // ═══════════════════════════════════════════════════════════════════════════
  if (sortedUpgrade.length > 0) {
    rows.push(labelRow('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'))
    rows.push(labelRow(`QUALITY UPGRADES (${sortedUpgrade.length} items)`))
    rows.push(labelRow('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'))
    rows.push(emptyRow)

    // Column headers for this section
    const upgradeHeaders = ['', 'Type', 'Title', 'Year', 'Series/Artist', 'Season', 'Priority', 'Current Quality', 'Notes', 'Added']
    rows.push(upgradeHeaders.map(escapeField).join(','))

    for (const item of sortedUpgrade) {
      const row = [
        '☐',  // Checkbox for shopping
        formatMediaType(item.media_type),
        item.title,
        item.year || '',
        item.series_title || item.artist_name || '',
        item.media_type === 'season' && item.season_number !== undefined ? `Season ${item.season_number}` : '',
        formatPriority(item.priority),
        formatQuality(item),
        item.notes || '',
        item.added_at ? formatDate(item.added_at) : ''
      ]
      rows.push(row.map(escapeField).join(','))
    }
    rows.push(emptyRow)
    rows.push(emptyRow)
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // FOOTER
  // ═══════════════════════════════════════════════════════════════════════════
  rows.push(labelRow('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'))
  rows.push(labelRow('SHOPPING TIPS'))
  rows.push(labelRow('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'))
  rows.push(labelRow('• Compare prices across multiple retailers before purchasing'))
  rows.push(labelRow('• Check for used/pre-owned copies for rare or out-of-print titles'))
  rows.push(labelRow('• Watch for seasonal sales (Black Friday, Prime Day, etc.)'))
  rows.push(labelRow('• For upgrades, verify the new version has improved quality before buying'))
  rows.push(emptyRow)
  rows.push(labelRow('Generated by Totality — Your Media Quality Companion'))
  rows.push(labelRow('https://github.com/your-repo/totality'))

  return BOM + rows.join('\r\n')
}

