import path from 'node:path'

export function resolveDatabasePath(userDataPath: string): string {
  const dbPath = path.join(userDataPath, 'totality.db')
  return dbPath.replace(/\\/g, '/')
}
