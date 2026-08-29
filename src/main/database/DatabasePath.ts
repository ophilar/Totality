import path from 'node:path'
import { PathUtils } from '../services/utils/PathUtils'

export function resolveDatabasePath(userDataPath: string): string {
  return PathUtils.toDatabasePath(path.join(userDataPath, 'totality.db'))
}
