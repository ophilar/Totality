import { describe, expect, it } from 'vitest'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { readOptimizationCalibrationProfile, writeOptimizationCalibrationProfile } from '@main/services/OptimizationCalibrationProfile'
import { OPTIMIZATION_CALIBRATION_VERSION, type OptimizationCalibrationEntry } from '@main/services/MeasuredOptimizationPolicy'

describe('optimization calibration profile persistence', () => {
  it('publishes empty and validated snapshots and ignores interrupted staging files', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'optimization-calibration-'))
    const profilePath = path.join(directory, 'optimization-profile.json')
    const entry: OptimizationCalibrationEntry = {
      scopeKey: 'source/library/SDR', sourceCodec: 'H.264', targetCodec: 'hevc', encoder: 'x265',
      preset: 'medium', quality: 22, outputBytes: 100, sampledDurationSeconds: 30,
      measuredAt: new Date().toISOString(),
    }
    try {
      expect(await readOptimizationCalibrationProfile(profilePath)).toEqual([])
      await writeOptimizationCalibrationProfile(profilePath, [entry])
      expect(await readOptimizationCalibrationProfile(profilePath)).toEqual([entry])
      await writeOptimizationCalibrationProfile(profilePath, [])
      expect(await readOptimizationCalibrationProfile(profilePath)).toEqual([])
      await fs.writeFile(profilePath + '.interrupted.tmp', JSON.stringify({ version: OPTIMIZATION_CALIBRATION_VERSION, entries: [entry] }))
      expect(await readOptimizationCalibrationProfile(profilePath)).toEqual([])
      await writeOptimizationCalibrationProfile(profilePath, [entry])
      expect(await readOptimizationCalibrationProfile(profilePath)).toEqual([entry])
      await fs.writeFile(profilePath, JSON.stringify({ version: 1, entries: [entry] }))
      await expect(readOptimizationCalibrationProfile(profilePath)).rejects.toThrow('Invalid persisted optimization calibration')
    } finally {
      await fs.rm(directory, { recursive: true, force: true })
    }
  })
})
