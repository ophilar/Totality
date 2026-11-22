import type Database from 'better-sqlite3'

export type MediaRemuxJobStatus = 'planned' | 'running' | 'verified' | 'promoted' | 'failed'

export interface MediaRemuxJob {
  id: number
  mediaItemId: number
  operationKind: string
  status: MediaRemuxJobStatus
  sourcePath: string
  sourceSize: number
  sourceMtimeMs: number
  sourceSha256: string
  decisionSnapshot: string
  streamSignatures: string
  quarantinePath: string | null
  error: string | null
  predictedOutputBytes: number | null
  actualOutputBytes: number | null
  bytesSaved: number | null
  sourceDurationMs: number | null
  outputDurationMs: number | null
  encoderProfile: string | null
  sourceAnalysis: string | null
  outputAnalysis: string | null
  createdAt: string
  updatedAt: string
}

export interface MediaRemuxJobInput {
  mediaItemId: number
  operationKind: string
  status: MediaRemuxJobStatus
  sourcePath: string
  sourceSize: number
  sourceMtimeMs: number
  sourceSha256: string
  decisionSnapshot: string
  streamSignatures: string
  quarantinePath?: string | null
  error?: string | null
  predictedOutputBytes?: number | null
  actualOutputBytes?: number | null
  bytesSaved?: number | null
  sourceDurationMs?: number | null
  outputDurationMs?: number | null
  encoderProfile?: string | null
  sourceAnalysis?: string | null
  outputAnalysis?: string | null
  createdAt?: string
  updatedAt?: string
}

function toCamelCaseJob(row: Record<string, unknown>): MediaRemuxJob {
  return {
    id: row.id as number,
    mediaItemId: row.media_item_id as number,
    operationKind: row.operation_kind as string,
    status: row.status as MediaRemuxJobStatus,
    sourcePath: row.source_path as string,
    sourceSize: row.source_size as number,
    sourceMtimeMs: row.source_mtime_ms as number,
    sourceSha256: row.source_sha256 as string,
    decisionSnapshot: row.decision_snapshot as string,
    streamSignatures: row.stream_signatures as string,
    quarantinePath: (row.quarantine_path as string) ?? null,
    error: (row.error as string) ?? null,
    predictedOutputBytes: (row.predicted_output_bytes as number) ?? null,
    actualOutputBytes: (row.actual_output_bytes as number) ?? null,
    bytesSaved: (row.bytes_saved as number) ?? null,
    sourceDurationMs: (row.source_duration_ms as number) ?? null,
    outputDurationMs: (row.output_duration_ms as number) ?? null,
    encoderProfile: (row.encoder_profile as string) ?? null,
    sourceAnalysis: (row.source_analysis as string) ?? null,
    outputAnalysis: (row.output_analysis as string) ?? null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string
  }
}

export class MediaRemuxJobRepository {
  constructor(private readonly getDb: () => Database.Database) {}

  private db(): Database.Database {
    const database = this.getDb()
    if (!database) throw new Error('Database not initialized')
    return database
  }

  async create(data: MediaRemuxJobInput): Promise<number> {
    const now = new Date().toISOString()
    const stmt = this.db().prepare(`
      INSERT INTO media_optimization_jobs (
        media_item_id, operation_kind, status, source_path, source_size,
        source_mtime_ms, source_sha256, decision_snapshot, stream_signatures,
        quarantine_path, error, predicted_output_bytes, actual_output_bytes,
        bytes_saved, source_duration_ms, output_duration_ms, encoder_profile,
        source_analysis, output_analysis, created_at, updated_at
      ) VALUES (
        @media_item_id, @operation_kind, @status, @source_path, @source_size,
        @source_mtime_ms, @source_sha256, @decision_snapshot, @stream_signatures,
        @quarantine_path, @error, @predicted_output_bytes, @actual_output_bytes,
        @bytes_saved, @source_duration_ms, @output_duration_ms, @encoder_profile,
        @source_analysis, @output_analysis, @created_at, @updated_at
      )
    `)

    const info = stmt.run({
      media_item_id: data.mediaItemId,
      operation_kind: data.operationKind,
      status: data.status,
      source_path: data.sourcePath,
      source_size: data.sourceSize,
      source_mtime_ms: data.sourceMtimeMs,
      source_sha256: data.sourceSha256,
      decision_snapshot: data.decisionSnapshot,
      stream_signatures: data.streamSignatures,
      quarantine_path: data.quarantinePath ?? null,
      error: data.error ?? null,
      predicted_output_bytes: data.predictedOutputBytes ?? null,
      actual_output_bytes: data.actualOutputBytes ?? null,
      bytes_saved: data.bytesSaved ?? null,
      source_duration_ms: data.sourceDurationMs ?? null,
      output_duration_ms: data.outputDurationMs ?? null,
      encoder_profile: data.encoderProfile ?? null,
      source_analysis: data.sourceAnalysis ?? null,
      output_analysis: data.outputAnalysis ?? null,
      created_at: data.createdAt ?? now,
      updated_at: data.updatedAt ?? now
    })

    return Number(info.lastInsertRowid)
  }

  async update(id: number, data: Partial<MediaRemuxJobInput>): Promise<void> {
    const mapping: Record<string, string> = {
      mediaItemId: 'media_item_id',
      operationKind: 'operation_kind',
      status: 'status',
      sourcePath: 'source_path',
      sourceSize: 'source_size',
      sourceMtimeMs: 'source_mtime_ms',
      sourceSha256: 'source_sha256',
      decisionSnapshot: 'decision_snapshot',
      streamSignatures: 'stream_signatures',
      quarantinePath: 'quarantine_path',
      error: 'error',
      predictedOutputBytes: 'predicted_output_bytes',
      actualOutputBytes: 'actual_output_bytes',
      bytesSaved: 'bytes_saved',
      sourceDurationMs: 'source_duration_ms',
      outputDurationMs: 'output_duration_ms',
      encoderProfile: 'encoder_profile',
      sourceAnalysis: 'source_analysis',
      outputAnalysis: 'output_analysis'
    }

    const sets: string[] = ['updated_at = ?']
    const params: unknown[] = [new Date().toISOString()]

    for (const [key, val] of Object.entries(data)) {
      const col = mapping[key]
      if (col !== undefined && val !== undefined) {
        sets.push(`${col} = ?`)
        params.push(val)
      }
    }

    params.push(id)
    const sql = `UPDATE media_optimization_jobs SET ${sets.join(', ')} WHERE id = ?`
    this.db().prepare(sql).run(...params)
  }

  async getLatest(mediaItemId: number): Promise<MediaRemuxJob | null> {
    const row = this.db()
      .prepare('SELECT * FROM media_optimization_jobs WHERE media_item_id = ? ORDER BY updated_at DESC LIMIT 1')
      .get(mediaItemId) as Record<string, unknown> | undefined
    return row ? toCamelCaseJob(row) : null
  }

  async getQuarantines(mediaItemIds: number[]): Promise<MediaRemuxJob[]> {
    if (!mediaItemIds.length) return []
    const placeholders = mediaItemIds.map(() => '?').join(',')
    const rows = this.db()
      .prepare(`SELECT * FROM media_optimization_jobs WHERE media_item_id IN (${placeholders}) AND quarantine_path IS NOT NULL`)
      .all(...mediaItemIds) as Record<string, unknown>[]
    return rows.map(toCamelCaseJob)
  }

  async getCalibratedOutputBytes(sourceSize: number, operationKind: string, encoderProfile: string): Promise<number | null> {
    const rows = this.db().prepare(`
      SELECT source_size, actual_output_bytes
      FROM media_optimization_jobs
      WHERE operation_kind = ? AND status = 'promoted' AND encoder_profile = ? AND actual_output_bytes IS NOT NULL
    `).all(operationKind, encoderProfile) as Array<{ source_size: number; actual_output_bytes: number | null }>

    if (rows.length < 5) return null
    const ratios = rows
      .filter(row => row.source_size > 0 && row.actual_output_bytes != null && row.actual_output_bytes > 0)
      .map(row => (row.actual_output_bytes as number) / row.source_size)
      .sort((left, right) => left - right)
    if (ratios.length < 5) return null
    const middle = Math.floor(ratios.length / 2)
    const ratio = ratios.length % 2 === 1 ? ratios[middle] : (ratios[middle - 1] + ratios[middle]) / 2
    return Math.round(sourceSize * ratio)
  }
}
