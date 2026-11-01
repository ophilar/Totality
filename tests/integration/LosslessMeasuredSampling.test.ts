import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildMeasuredCandidateArgs } from '@main/services/MeasuredOptimizationService'

const toolsAvailable = ['ffmpeg', 'ffprobe'].every(binary => spawnSync(binary, ['-version'], { stdio: 'ignore' }).status === 0)

function run(binary: string, args: string[]): string {
  const result = spawnSync(binary, args, { encoding: 'utf8', timeout: 30000, maxBuffer: 8 * 1024 * 1024 })
  if (result.status !== 0) throw result.error ?? new Error(result.stderr)
  return result.stdout + result.stderr
}

function decodedTimestamps(filePath: string): number[] {
  return run('ffprobe', [
    '-v', 'error', '-select_streams', 'v:0', '-show_frames',
    '-show_entries', 'frame=best_effort_timestamp_time', '-of', 'csv=p=0', filePath,
  ]).split(/\r?\n/).filter(line => line.trim()).map(line => Number(line.split(',')[0]))
}

describe.skipIf(!toolsAvailable)('direct-source measured video sampling (real FFmpeg)', () => {
  it.each([false, true])('preserves non-keyframe B-frame windows and VFR=%s', vfr => {
    const dir = mkdtempSync(join(tmpdir(), 'totality-direct-source-'))
    try {
      const input = join(dir, 'source.mkv')
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
      const window = { startSeconds: 0.73, durationSeconds: 1.7 }
      run('ffmpeg', buildMeasuredCandidateArgs([
        '-y', '-v', 'error', '-i', '<input>', '-fps_mode', 'passthrough',
        '-map', '0:v:0', '-map', '0:a:0',
        '-c:v', 'mpeg4', '-q:v', '4', '-c:a', 'copy', '<output>',
      ], input, candidate, window))
      const reference = run('ffmpeg', [
        '-hide_banner', '-nostats', '-v', 'info',
        '-ss', String(window.startSeconds), '-i', input,
        '-map', '0:v:0', '-vf', `trim=duration=${window.durationSeconds},setpts=PTS-STARTPTS,showinfo`,
        '-fps_mode', 'passthrough', '-t', String(window.durationSeconds), '-an', '-sn', '-f', 'null', '-',
      ])
      const expected = reference.split(/\r?\n/)
        .filter(line => /showinfo/.test(line) && /n:\s*\d+\s+pts:/.test(line))
        .map(line => Number(line.match(/\bpts_time:\s*([^\s]+)/)?.[1]))
      const actual = decodedTimestamps(candidate)
      expect(expected.length).toBeGreaterThan(20)
      expect(actual.length).toBe(expected.length)
      expect(run('ffprobe', ['-v', 'error', '-select_streams', 'a', '-show_entries', 'stream=index', '-of', 'csv=p=0', candidate]).trim()).toBe('')
      for (let index = 0; index < expected.length; index++) {
        expect(Math.abs((expected[index] - expected[0]) - (actual[index] - actual[0]))).toBeLessThanOrEqual(0.002)
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }, 90000)
})
