import path from 'node:path'

export function resolveDatabasePath(userDataPath: string): string {
  return path.join(userDataPath, 'totality.db')
}
