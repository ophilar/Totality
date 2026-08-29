import path from 'node:path'
import os from 'node:os'

export function resolveDatabasePath(userDataPath: string): string {
  // Always use win32 path join on windows, or if the path is explicitly a windows path,
  // because testing might happen on linux for windows-like strings.
  if (os.platform() === 'win32' || userDataPath.includes('\\')) {
    return path.win32.join(userDataPath, 'totality.db')
  }
  return path.posix.join(userDataPath, 'totality.db')
}
