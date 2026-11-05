import type { Stats } from 'node:fs'

/** Stable source identity for reuse of filesystem-derived media evidence. */
export type FileIdentity = Pick<Stats, 'size' | 'mtimeMs' | 'ctimeMs' | 'ino'>

export function fileIdentity(stat: FileIdentity): FileIdentity {
  return { size: stat.size, mtimeMs: stat.mtimeMs, ctimeMs: stat.ctimeMs, ino: stat.ino }
}

/** Legacy fingerprints without complete identity are intentionally invalid. */
export function matchesFileIdentity(saved: Partial<FileIdentity> | null | undefined, actual: FileIdentity): boolean {
  return Boolean(saved && saved.size === actual.size && saved.mtimeMs === actual.mtimeMs &&
    saved.ctimeMs === actual.ctimeMs && saved.ino === actual.ino)
}
