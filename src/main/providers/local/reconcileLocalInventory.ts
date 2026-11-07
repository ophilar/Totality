import type { DatabaseServiceInterface } from '../../database/DatabaseInterface'
import type { MediaItem } from '../../types/database'

/**
 * Reconcile a completed local-media inventory, preserving individual editions.
 * The caller must finish enumeration and processing before invoking this operation.
 */
export async function reconcileLocalInventory(
  db: DatabaseServiceInterface,
  storedItems: MediaItem[],
  observedPaths: ReadonlySet<string>
): Promise<{ removed: number; updated: MediaItem[] }> {
  let removed = 0
  const updated: MediaItem[] = []

  for (const item of storedItems) {
    const id = item.id!
    const versions = db.getMediaItemVersions(id)
    const observedVersions = versions.filter(version => observedPaths.has(version.file_path))

    if (observedVersions.length > 0) {
      if (observedVersions.length !== versions.length) {
        db.syncMediaItemVersions(id, observedVersions)
        updated.push(db.getMediaItem(id)!)
      } else if (!observedPaths.has(item.file_path)) {
        db.updateBestVersion(id, observedPaths)
        updated.push(db.getMediaItem(id)!)
      }
    } else if (!observedPaths.has(item.file_path)) {
      await db.deleteMediaItem(id)
      removed++
    }
  }

  return { removed, updated }
}
