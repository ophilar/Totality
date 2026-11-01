import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildLosslessSampleArgs, buildMeasuredCandidateArgs } from '@main/services/MeasuredOptimizationService'

const toolsAvailable = ['ffmpeg', 'ffprobe'].every(binary => spawnSync(binary, ['-version'], { stdio: 'ignore' }).status === 0)

function run(binary: string, args: string[]): string {
  return execFileSync(binary, args, { encoding: 'utf8', timeout: 30000, maxBuffer: 8 * 1024 * 1024 })
}

function decodedTimestamps(filePath: string): number[] {
  return run('ffprobe', [
    '-v', 'error', '-select_streams', 'v:0', '-show_frames',
    '-show_entries', 'frame=best_effort_timestamp_time', '-of', 'csv=p=0', filePath,
  ]).split(/\r?\n/).filter(line => line.trim()).map(line => Number(line.split(',')[0]))
}

describe.skipIf(!toolsAvailable)('lossless measured video sampling (real FFmpeg)', () => {
  it.each([false, true])('preserves B-frame video count and relative timestamps; VFR=%s', vfr => {
    const dir = mkdtempSync(join(tmpdir(), 'totality-lossless-sample-'))
    try {
      const input = join(dir, 'source.mkv')
      const reference = join(dir, 'reference.mkv')
      const candidate = join(dir, 'candidate.mkv')

      run('ffmpeg', [
        '-y', '-v', 'error',
        '-f', 'lavfi', '-i', 'testsrc2=size=160x96:rate=24000/1001:duration=5',
        '-f', 'lavfi', '-i', 'sine=frequency=550:sample_rate=48000:duration=5',
        ...(vfr ? ['-vf', 'select=not(eq(mod(n\\,7)\\,0))'] : []),
        '-fps_mode', 'passthrough', '-enc_time_base:v:0', 'filter',
        '-c:v', 'mpeg4', '-bf', '2', '-g', '24', '-q:v', '4',
        '-c:a', 'aac', '-shortest', input,
      ])

      // 0.73s is intentionally not a keyframe boundary.
      run('ffmpeg', buildLosslessSampleArgs(input, reference, 0.73, 1.7, true))
      run('ffmpeg', buildMeasuredCandidateArgs([
        '-y', '-v', 'error', '-i', '<input>', '-fps_mode', 'passthrough',
        '-map', '0:v:0', '-map', '0:a:0',
        '-c:v', 'mpeg4', '-q:v', '4', '-c:a', 'copy', '<output>',
      ], reference, candidate))

      const expected = decodedTimestamps(reference)
      const actual = decodedTimestamps(candidate)
      expect(expected.length).toBeGreaterThan(20)
      expect(actual.length).toBe(expected.length)
      expect(expected.every(Number.isFinite)).toBe(true)
      expect(actual.every(Number.isFinite)).toBe(true)
      for (let index = 0; index < expected.length; index++) {
        expect(Math.abs((expected[index] - expected[0]) - (actual[index] - actual[0]))).toBeLessThanOrEqual(0.002)
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }, 90000)
})
