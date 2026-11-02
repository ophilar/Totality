import { describe, expect, it } from 'vitest'
import { resolveViteConfig } from 'vite-plugin-electron'
import path from 'node:path'
import { electronTargets } from '../../vite.config'

describe('Electron build configuration', () => {
  it('resolves each Electron entry to one CommonJS output', () => {
    const targets = electronTargets.map((target) => {
      const config = resolveViteConfig(target)
      const build = config.build

      expect(build?.lib?.formats).toEqual(['cjs'])
      expect(build?.rolldownOptions?.output).toMatchObject({ format: 'cjs', codeSplitting: false })
      const fileName = build?.rolldownOptions?.output?.entryFileNames
      expect(fileName).toBeTypeOf('string')
      return path.join(build!.outDir!, fileName!)
    })

    expect(new Set(targets).size).toBe(electronTargets.length)
  })
})
