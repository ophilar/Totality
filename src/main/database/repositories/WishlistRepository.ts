import { eq, and, or, like, desc, asc, sql } from 'drizzle-orm'
import { WishlistItem, WishlistFilters } from '@main/types/database'
import { BaseRepository } from '@main/database/repositories/BaseRepository'

import { LibSQLDatabase } from 'drizzle-orm/libsql'
import * as schema from '@main/database/drizzleSchema'

export class WishlistRepository extends BaseRepository<typeof schema.wishlistItems> {
  constructor(db: any, drizzle: LibSQLDatabase<typeof schema>) {
    super(db, 'wishlist_items', drizzle, schema.wishlistItems)
  }

  async getItems(filters?: WishlistFilters): Promise<WishlistItem[]> {
    const conditions = []
    
    const mediaType = filters?.media_type || (filters as any)?.mediaType
    if (mediaType) conditions.push(eq(schema.wishlistItems.mediaType, mediaType))
    if (filters?.status) conditions.push(eq(schema.wishlistItems.status, filters.status))
    if (filters?.reason) conditions.push(eq(schema.wishlistItems.reason, filters.reason))
    if (filters?.searchQuery) {
      const q = `%${filters.searchQuery}%`
      conditions.push(or(
        like(schema.wishlistItems.title, q),
        like(schema.wishlistItems.subtitle, q)
      ))
    }

    const sortMap: any = {
      'title': schema.wishlistItems.title,
      'priority': schema.wishlistItems.priority,
      'added_at': schema.wishlistItems.addedAt
    }
    const sortCol = sortMap[filters?.sortBy || 'added_at'] || schema.wishlistItems.addedAt
    const sortOrder = filters?.sortOrder === 'asc' ? asc(sortCol) : desc(sortCol)

    const query = this.drizzle.select().from(schema.wishlistItems)
    if (conditions.length > 0) query.where(and(...conditions))
    query.orderBy(sortOrder)
    if (filters?.limit) query.limit(filters.limit)

    const rows = await query.all()
    return this.mapDrizzleToWishlist(rows)
  }

  async getWishlistItems(filters?: WishlistFilters): Promise<WishlistItem[]> {
    return this.getItems(filters)
  }

  async getWishlistItemByTmdbId(tmdbId: string): Promise<WishlistItem | null> {
    const row = await this.drizzle.select()
      .from(schema.wishlistItems)
      .where(eq(schema.wishlistItems.tmdbId, tmdbId))
      .get()
    return row ? this.mapDrizzleToWishlist([row])[0] : null
  }

  async getWishlistItemByMusicbrainzId(mbid: string): Promise<WishlistItem | null> {
    const row = await this.drizzle.select()
      .from(schema.wishlistItems)
      .where(eq(schema.wishlistItems.musicbrainzId, mbid))
      .get()
    return row ? this.mapDrizzleToWishlist([row])[0] : null
  }

  async add(item: Omit<WishlistItem, 'id' | 'added_at' | 'updated_at'>): Promise<number> {
    const now = new Date().toISOString()
    const data = {
      mediaType: item.media_type,
      title: item.title,
      subtitle: item.subtitle,
      year: item.year,
      reason: item.reason || 'missing',
      tmdbId: item.tmdb_id,
      imdbId: item.imdb_id,
      musicbrainzId: item.musicbrainz_id,
      seriesTitle: item.series_title,
      seasonNumber: item.season_number,
      episodeNumber: item.episode_number,
      collectionName: item.collection_name,
      artistName: item.artist_name,
      albumTitle: item.album_title,
      posterUrl: item.poster_url,
      priority: item.priority || 3,
      notes: item.notes,
      status: item.status || 'active',
      addedAt: now,
      updatedAt: now,
    }

    const result = await this.drizzle.insert(schema.wishlistItems)
      .values(data)
      .returning({ id: schema.wishlistItems.id })

    return result[0]?.id || 0
  }

  async getCount(): Promise<number> {
    return await this.countInternal()
  }

  async getCountsByReason(): Promise<Record<string, number>> {
    const rows = await this.drizzle.select({ 
        reason: schema.wishlistItems.reason, 
        count: sql<number>`count(*)` 
      })
      .from(schema.wishlistItems)
      .groupBy(schema.wishlistItems.reason)
      .all()
    
    const counts: Record<string, number> = {}
    rows.forEach(r => counts[r.reason] = r.count)
    return counts
  }

  async getWishlistItemById(id: number): Promise<WishlistItem | null> {
    const row = await this.drizzle.select()
      .from(schema.wishlistItems)
      .where(eq(schema.wishlistItems.id, id))
      .get()
    return row ? this.mapDrizzleToWishlist([row])[0] : null
  }

  async updatePriority(id: number, priority: number): Promise<void> {
    await this.drizzle.update(schema.wishlistItems)
      .set({ priority, updatedAt: new Date().toISOString() })
      .where(eq(schema.wishlistItems.id, id))
  }

  async updateStatus(id: number, status: string): Promise<void> {
    const now = new Date().toISOString()
    await this.drizzle.update(schema.wishlistItems)
      .set({ 
        status: status as any, 
        updatedAt: now,
        completedAt: status === 'completed' ? now : null 
      })
      .where(eq(schema.wishlistItems.id, id))
  }

  async batchUpdateStatus(ids: number[], status: string): Promise<void> {
    if (ids.length === 0) return
    const now = new Date().toISOString()
    const inArray = (await import('drizzle-orm')).inArray
    await this.drizzle.update(schema.wishlistItems)
      .set({ 
        status: status as any, 
        updatedAt: now,
        completedAt: status === 'completed' ? now : null
      })
      .where(inArray(schema.wishlistItems.id, ids))
  }

  async deleteWishlistItem(id: number): Promise<void> {
    await this.delete(id)
  }

  private mapDrizzleToWishlist(rows: any[]): WishlistItem[] {
    return rows.map(r => ({
      id: r.id,
      media_type: r.mediaType,
      title: r.title,
      subtitle: r.subtitle || undefined,
      year: r.year || undefined,
      reason: r.reason,
      tmdb_id: r.tmdbId || undefined,
      imdb_id: r.imdbId || undefined,
      musicbrainz_id: r.musicbrainzId || undefined,
      series_title: r.seriesTitle || undefined,
      season_number: r.seasonNumber || undefined,
      episode_number: r.episodeNumber || undefined,
      collection_name: r.collectionName || undefined,
      artist_name: r.artistName || undefined,
      album_title: r.albumTitle || undefined,
      poster_url: r.posterUrl || undefined,
      priority: r.priority,
      notes: r.notes || undefined,
      status: r.status,
      completed_at: r.completedAt || undefined,
      current_quality_tier: r.currentQualityTier || undefined,
      current_quality_level: r.currentQualityLevel || undefined,
      current_resolution: r.currentResolution || undefined,
      current_video_codec: r.currentVideoCodec || undefined,
      current_audio_codec: r.currentAudioCodec || undefined,
      media_item_id: r.mediaItemId || undefined,
      added_at: r.addedAt,
      updated_at: r.updatedAt
    }))
  }
}
