import type { DatabaseSync, SQLInputValue } from 'node:sqlite'
import { BaseRepository } from './BaseRepository'

export interface Exclusion {
  id?: number
  exclusion_type: 'media_upgrade' | 'collection_movie' | 'series_episode' | 'artist_album' | 'cleanup_radar'
  reference_id?: number
  reference_key?: string
  parent_key?: string
  title?: string
  created_at?: string
}

export class ExclusionRepository extends BaseRepository<Exclusion> {
  constructor(db: DatabaseSync) {
    super(db, 'exclusions')
  }

  isExcluded(type: string, referenceId?: number, referenceKey?: string): boolean {
    if (referenceId != null) {
      const stmt = this.db.prepare('SELECT 1 FROM exclusions WHERE exclusion_type = ? AND reference_id = ? LIMIT 1')
      return !!stmt.get(type, referenceId)
    }
    if (referenceKey) {
      const stmt = this.db.prepare('SELECT 1 FROM exclusions WHERE exclusion_type = ? AND reference_key = ? LIMIT 1')
      return !!stmt.get(type, referenceKey)
    }
    return false
  }

  addExclusion(exclusion: Omit<Exclusion, 'id' | 'created_at'>): void {
    const stmt = this.db.prepare(`
      INSERT OR IGNORE INTO exclusions (exclusion_type, reference_id, reference_key, parent_key, title)
      VALUES (?, ?, ?, ?, ?)
    `)
    stmt.run(exclusion.exclusion_type, exclusion.reference_id ?? null, exclusion.reference_key ?? null, exclusion.parent_key ?? null, exclusion.title ?? null)
  }

  removeExclusion(type: string, referenceId?: number, referenceKey?: string): void {
    if (referenceId != null) {
      this.db.prepare('DELETE FROM exclusions WHERE exclusion_type = ? AND reference_id = ?').run(type, referenceId)
    } else if (referenceKey) {
      this.db.prepare('DELETE FROM exclusions WHERE exclusion_type = ? AND reference_key = ?').run(type, referenceKey)
    }
  }

  getExclusions(type?: string, parentKey?: string): Exclusion[] {
    let sql = 'SELECT * FROM exclusions WHERE 1=1'
    const params: SQLInputValue[] = []

    if (type) {
      sql += ' AND exclusion_type = ?'
      params.push(type)
    }
    if (parentKey) {
      sql += ' AND parent_key = ?'
      params.push(parentKey)
    }

    sql += ' ORDER BY created_at DESC'
    const stmt = this.db.prepare(sql)
    return stmt.all(...params) as unknown as Exclusion[]
  }
}
