import { exec } from 'child_process'
import { promisify } from 'util'

const execAsync = promisify(exec)

export interface GpuInfo {
  id: string
  name: string
  vendor: 'NVIDIA' | 'Intel' | 'AMD' | 'Apple' | 'Unknown'
}

export class GpuDetector {
  static async detectGpus(_options: { refresh?: boolean } = {}): Promise<GpuInfo[]> {
    const platform = process.platform
    const gpus: GpuInfo[] = []
    
    try {
      if (platform === 'win32') {
        const { stdout } = await execAsync('powershell.exe -NoProfile -NonInteractive -Command "Get-CimInstance Win32_VideoController | Select-Object Name,PNPDeviceID | ConvertTo-Json -Compress"')
        const parsed = JSON.parse(stdout) as Array<{ Name?: string; PNPDeviceID?: string }> | { Name?: string; PNPDeviceID?: string }
        const devices = Array.isArray(parsed) ? parsed : [parsed]
        devices.filter(device => device.Name).forEach((device, idx) => {
          const name = device.Name!.trim()
          const identity = device.PNPDeviceID?.trim() || `${name}-${idx}`
          gpus.push({
            id: `win-${identity.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
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
        for (const line of lines) {
          if (line.includes('VGA') || line.includes('3D') || line.includes('Display')) {
            const address = line.split(' ')[0]
            const name = line.slice(line.indexOf(':') + 1).trim()
            gpus.push({
              id: `linux-${address.toLowerCase()}`,
              name,
              vendor: GpuDetector.parseVendor(name)
            })
          }
        }
      }
    } catch (e) {
      throw new Error(`GPU detection command execution failed: ${e instanceof Error ? e.message : String(e)}`)
    }
    
    return gpus
  }

  static clearCache(): void {
    // Compatibility no-op. Snapshot ownership belongs to TranscodingService.
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
