import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setupTestDb, cleanupTestDb, setupRealIntegratedBridge, createAuthorizedIpcEvent } from '../TestUtils'
import { getDatabase } from '@main/database/BetterSQLiteService'
import { LanguageRemuxService } from '@main/services/LanguageRemuxService'
import { validateSenderFrame } from '@main/ipc/utils/createHandler'
import { CompletenessEngine } from '@main/services/CompletenessEngine'
import { SETTING_KEYS } from '@shared/settingKeys'
import type { IpcMainInvokeEvent } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

describe('CriticalFlowsAcceptance (Directive 5 & Directive 11)', () => {
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'totality-acceptance-'))
    await setupTestDb()
  })

  afterEach(() => {
    cleanupTestDb()
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    } catch {
      // ignore tmp cleanup error
    }
  })

  describe('Flow 1: Privileged IPC Sender Frame Authorization & Preload Bridge', () => {
    it('strictly rejects IPC calls with missing or unauthorized sender frames (fail-closed)', () => {
      expect(() => {
        validateSenderFrame(null as unknown as IpcMainInvokeEvent, 'test:channel')
      }).toThrow(/missing sender frame/)

      expect(() => {
        validateSenderFrame({ sender: {}, senderFrame: { url: '' } } as unknown as IpcMainInvokeEvent, 'test:channel')
      }).toThrow(/missing frame URL/)

      expect(() => {
        validateSenderFrame({
          sender: {},
          senderFrame: { url: 'https://malicious-website.com/index.html' },
        } as unknown as IpcMainInvokeEvent, 'test:channel')
      }).toThrow(/Unauthorized IPC sender frame/)
    })

    it('successfully processes authorized preload bridge calls through real database', async () => {
      const { api } = setupRealIntegratedBridge()
      const db = getDatabase()

      // Set and get setting via real IPC bridge
      await (api.setSetting as (key: string, value: string) => Promise<void>)(
        SETTING_KEYS.collection_theatrical_lag_days,
        '60'
      )
      const fetched = await (api.getSetting as (key: string) => Promise<string>)(
        SETTING_KEYS.collection_theatrical_lag_days
      )
      expect(fetched).toBe('60')

      // Verify direct database state matches IPC mutation
      const directDbVal = await db.config.getSetting(SETTING_KEYS.collection_theatrical_lag_days)
      expect(directDbVal).toBe('60')
    })
  })

  describe('Flow 2: Optimization Operational Vertical Slice (Stage 4, 5, 6)', () => {
    it('verifies recoverability, executes atomic remux, and records JSONL audit trail', async () => {
      const inputFile = path.join(tmpDir, 'test_media.mkv')
      const quarantineDir = path.join(tmpDir, 'quarantine')
      const auditDir = path.join(tmpDir, 'audit_logs')

      // Create a dummy media file
      fs.writeFileSync(inputFile, 'dummy video payload with extra streams')
      const originalContent = fs.readFileSync(inputFile)

      // Mock runner that simulates ffmpeg copy and probe
      const mockRunner = {
        run: vi.fn().mockImplementation(async (args: string[]) => {
          const outPath = args[args.length - 1]
          fs.writeFileSync(outPath, 'optimized payload')
        }),
        probe: vi.fn().mockImplementation(async (target: string) => {
          const stats = fs.statSync(target)
          return {
            streams: [
              { index: 0, codec_type: 'video' },
              { index: 1, codec_type: 'audio', codec_name: 'aac' },
            ],
            duration: 120,
            size: stats.size,
          }
        }),
      }

      const remuxService = new LanguageRemuxService(mockRunner)

      // Stage 4: Verify recoverability
      await expect(
        LanguageRemuxService.assertRecoverability(inputFile, quarantineDir, async () => ({ bavail: 1000000, bsize: 4096 }))
      ).resolves.not.toThrow()
      expect(fs.existsSync(quarantineDir)).toBe(true)

      // Stage 5: Execute bounded optimization
      const result = await remuxService.remux(inputFile, {
        quarantineDirectory: quarantineDir,
        retainedAudioIndexes: [1],
        auditLogDirectory: auditDir,
        statfsProvider: async () => ({ bavail: 1000000, bsize: 4096 }),
      })

      expect(result.activePath).toBe(inputFile)
      expect(fs.readFileSync(inputFile, 'utf8')).toBe('optimized payload')
      expect(fs.existsSync(result.quarantinePath)).toBe(true)
      expect(fs.readFileSync(result.quarantinePath)).toEqual(originalContent)

      // Stage 6: Audit log verification
      expect(fs.existsSync(auditDir)).toBe(true)
      const auditFiles = fs.readdirSync(auditDir).filter((f) => f.endsWith('.jsonl'))
      expect(auditFiles.length).toBe(1)

      const auditContent = fs.readFileSync(path.join(auditDir, auditFiles[0]), 'utf8')
      const auditEntry = JSON.parse(auditContent.trim())
      expect(auditEntry.action).toBe('language-remux')
      expect(auditEntry.sourcePath).toBe(inputFile)
      expect(auditEntry.status).toBe('succeeded')
    })
  })

  describe('Flow 3: Completeness UX Engine Invariants (Upstream Port Verification)', () => {
    it('correctly maps release_date on missing movies and calculates accurate set completeness', () => {
      const targetSet = [
        { tmdb_id: '101', title: 'Film 1', year: 2024, poster_path: '/p1.jpg', release_date: '2024-01-15' },
        { tmdb_id: '102', title: 'Film 2', year: 2026, poster_path: '/p2.jpg', release_date: '2026-08-01' },
      ]
      const ownedIds = new Set(['101'])

      const result = CompletenessEngine.calculateSimple(targetSet, ownedIds)

      expect(result.total).toBe(2)
      expect(result.owned).toBe(1)
      expect(result.percentage).toBe(50)
      expect(result.missing.length).toBe(1)
      expect(result.missing[0].tmdb_id).toBe('102')
      expect(result.missing[0].release_date).toBe('2026-08-01')
    })
  })
})
