import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { APP_CONFIG } from '@main/config'
const HASH_DIRECTORY = /^[a-f0-9]{64}$/

/** Only account for ordinary files and directories. Never traverse symbolic links. */
async function directoryBytes(directory: string): Promise<number> {
  let bytes = 0
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const filePath = path.join(directory, entry.name)
    if (entry.isDirectory()) bytes += await directoryBytes(filePath)
    else if (entry.isFile()) bytes += (await fs.stat(filePath)).size
  }
  return bytes
}

export interface MeasuredSampleRetentionOptions {
  root: string
  records: Readonly<Record<string, string>>
  protectedKeys: ReadonlySet<string>
  settingPrefix: string
  deleteRecord: (settingKey: string) => Promise<void>
  isActive?: (key: string) => boolean
  now?: number
  maxBytes?: number
}

/**
 * Cache-only retention. Never delete source media, user files, incomplete
 * measurements, or samples referenced by a saved review/queued task.
 * Eviction means a completed measurement must be regenerated on next use.
 */
export async function pruneMeasuredSampleCache(options: MeasuredSampleRetentionOptions): Promise<{ removed: number; reclaimedBytes: number }> {
  const { root, records, protectedKeys, settingPrefix, deleteRecord } = options
  const now = options.now ?? Date.now()
  const policy = APP_CONFIG.transcoding.measuredSampleCache
  const maxBytes = options.maxBytes ?? policy.maxBytes
  if (!Number.isFinite(maxBytes) || maxBytes < 0) throw new Error('Invalid measured-sample cache capacity')
  let entries: import('node:fs').Dirent[]
  try {
    entries = await fs.readdir(root, { withFileTypes: true })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { removed: 0, reclaimedBytes: 0 }
    throw error
  }
  const candidates: Array<{ key: string; directory: string; bytes: number; mtimeMs: number; orphan: boolean }> = []
  let totalBytes = 0
  for (const entry of entries) {
    // The cache owns only hash-named real directories; everything else is ignored.
    if (!entry.isDirectory() || !HASH_DIRECTORY.test(entry.name)) continue
    const directory = path.join(root, entry.name)
    const [metadata, bytes] = await Promise.all([fs.stat(directory), directoryBytes(directory)])
    totalBytes += bytes
    const recordKey = `${settingPrefix}${entry.name}`
    const raw = records[recordKey]
    let complete = false
    if (raw) {
      try {
        const record = JSON.parse(raw) as { cacheKey?: string; complete?: boolean }
        complete = record.cacheKey === entry.name && record.complete === true
      } catch {
        // Unparseable records are preserved until explicitly invalidated.
      }
    }
    const orphan = raw === undefined
    if ((orphan || complete) && !protectedKeys.has(entry.name)) {
      candidates.push({ key: entry.name, directory, bytes, mtimeMs: metadata.mtimeMs, orphan })
    }
  }
  candidates.sort((left, right) => left.mtimeMs - right.mtimeMs)
  let removed = 0
  let reclaimedBytes = 0
  for (const candidate of candidates) {
    const ageMs = now - candidate.mtimeMs
    const expired = ageMs >= policy.maxAgeMs
    const overBudget = totalBytes > maxBytes && ageMs >= policy.minEvictionAgeMs
    if (!expired && !(candidate.orphan && ageMs >= policy.minEvictionAgeMs) && !overBudget) continue
    if (options.isActive?.(candidate.key)) continue
    if (!candidate.orphan) await deleteRecord(`${settingPrefix}${candidate.key}`)
    await fs.rm(candidate.directory, { recursive: true, force: true })
    totalBytes -= candidate.bytes
    reclaimedBytes += candidate.bytes
    removed++
  }
  return { removed, reclaimedBytes }
}
