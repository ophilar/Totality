import { exec } from 'child_process'
import { promisify } from 'util'
import { getDatabase } from '@main/database/BetterSQLiteService'

const execAsync = promisify(exec)

export interface GpuInfo {
  id: string
  name: string
  vendor: 'NVIDIA' | 'Intel' | 'AMD' | 'Apple' | 'Unknown'
}

export class GpuDetector {
  private static cachedGpus: GpuInfo[] | null = null

  static async detectGpus(): Promise<GpuInfo[]> {
    if (GpuDetector.cachedGpus) {
      return GpuDetector.cachedGpus
    }

    // Try reading persistent cache from SQLite settings table
    try {
      const db = getDatabase()
      if (db.isInitialized) {
        const cached = await db.config.getSetting('detected_gpus')
        if (cached) {
          const parsed = JSON.parse(cached)
          if (Array.isArray(parsed) && parsed.length > 0) {
            GpuDetector.cachedGpus = parsed
            return parsed
          }
        }
      }
    } catch (e) {
      // Defer to normal hardware detection if DB is not ready or fails
    }

    const platform = process.platform
    const gpus: GpuInfo[] = []
    
    try {
      if (platform === 'win32') {
        const { stdout } = await execAsync('wmic path win32_VideoController get name')
        const lines = stdout.split('\n').map(l => l.trim()).filter(l => l && l !== 'Name' && !l.toLowerCase().includes('videocontroller'))
        lines.forEach((name, idx) => {
          gpus.push({
            id: `win-gpu-${idx}`,
            name,
            vendor: GpuDetector.parseVendor(name)
          })
        })
      } else if (platform === 'darwin') {
        const { stdout } = await execAsync('system_profiler SPDisplaysDataType')
        const matches = stdout.match(/Chipset Model:\s*(.*)/g)
        if (matches) {
          matches.forEach((m, idx) => {
            const name = m.replace('Chipset Model:', '').trim()
            gpus.push({
              id: `mac-gpu-${idx}`,
              name,
              vendor: GpuDetector.parseVendor(name)
            })
          })
        }
      } else {
        const { stdout } = await execAsync('lspci')
        const lines = stdout.split('\n')
        let idx = 0
        for (const line of lines) {
          if (line.includes('VGA') || line.includes('3D') || line.includes('Display')) {
            const parts = line.split(':')
            const name = parts[parts.length - 1].trim()
            gpus.push({
              id: `linux-gpu-${idx++}`,
              name,
              vendor: GpuDetector.parseVendor(name)
            })
          }
        }
      }
    } catch (e) {
      throw new Error(`GPU detection command execution failed: ${e instanceof Error ? e.message : String(e)}`)
    }
    
    GpuDetector.cachedGpus = gpus

    try {
      const db = getDatabase()
      if (db.isInitialized && gpus.length > 0) {
        await db.config.setSetting('detected_gpus', JSON.stringify(gpus))
      }
    } catch (e) {
      // Ignore database save errors during detection fallback
    }

    return gpus
  }

  private static parseVendor(name: string): 'NVIDIA' | 'Intel' | 'AMD' | 'Apple' | 'Unknown' {
    const lower = name.toLowerCase()
    if (lower.includes('nvidia') || lower.includes('geforce') || lower.includes('quadro') || lower.includes('rtx')) return 'NVIDIA'
    if (lower.includes('intel') || lower.includes('arc') || lower.includes('iris') || lower.includes('uhd')) return 'Intel'
    if (lower.includes('amd') || lower.includes('radeon') || lower.includes('ryzen')) return 'AMD'
    if (lower.includes('apple') || lower.includes('m1') || lower.includes('m2') || lower.includes('m3') || lower.includes('m4') || lower.includes('m5') || lower.includes('m6')) return 'Apple'
    return 'Unknown'
  }
}
