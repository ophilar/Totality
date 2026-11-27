/**
 * CredentialEncryptionService Unit Tests
 *
 * The global setup (tests/setup.ts) mocks safeStorage with async encryption unavailable.
 * Individual describe blocks override this to test both available/unavailable states.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { safeStorage } from 'electron'
import { CredentialEncryptionService } from '../../src/main/services/CredentialEncryptionService'

describe('CredentialEncryptionService — encryption unavailable', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(safeStorage.isAsyncEncryptionAvailable).mockResolvedValue(false)
  })

  it('rejects credential and sensitive-setting writes without OS encryption', async () => {
    const svc = new CredentialEncryptionService()
    await expect(svc.encrypt('my-secret-token')).rejects.toThrow('OS credential encryption unavailable')
    await expect(svc.encryptSetting('web_access_pin', '123456')).rejects.toThrow('OS credential encryption unavailable')
    await expect(svc.encryptConnectionConfig({ token: 'my-secret-token' })).rejects.toThrow('OS credential encryption unavailable')
    await expect(svc.encryptSetting('language', 'he')).resolves.toBe('he')
  })

  it('does not return encrypted credentials as plaintext when OS encryption is unavailable', async () => {
    const svc = new CredentialEncryptionService()
    await expect(svc.decrypt('ENC:YWJj')).rejects.toThrow('OS credential encryption unavailable')
  })

  it('isEncryptionAvailable() returns false', async () => {
    const svc = new CredentialEncryptionService()
    await expect(svc.isEncryptionAvailable()).resolves.toBe(false)
  })

  it('isEncrypted() returns false for plain text', () => {
    const svc = new CredentialEncryptionService()
    expect(svc.isEncrypted('plain-text')).toBe(false)
  })

  it('decrypt() returns plain value as-is for non-ENC: values', async () => {
    const svc = new CredentialEncryptionService()
    await expect(svc.decrypt('plain-text')).resolves.toBe('plain-text')
  })

  it('decrypt() rejects encrypted credentials when OS encryption is unavailable', async () => {
    const svc = new CredentialEncryptionService()
    await expect(svc.decrypt('ENC:c2VjcmV0')).rejects.toThrow('OS credential encryption unavailable')
  })
})

describe('CredentialEncryptionService — encryption available', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(safeStorage.isAsyncEncryptionAvailable).mockResolvedValue(true)
    vi.mocked(safeStorage.encryptStringAsync).mockImplementation(
      async (str: string) => Buffer.from(`encrypted:${str}`)
    )
    vi.mocked(safeStorage.decryptStringAsync).mockImplementation(
      async (buf: Buffer) => ({ result: buf.toString().replace('encrypted:', ''), shouldReEncrypt: false })
    )
  })

  it('encrypt() returns ENC:-prefixed value', async () => {
    const svc = new CredentialEncryptionService()
    const result = await svc.encrypt('my-secret-token')
    expect(result.startsWith('ENC:')).toBe(true)
  })

  it('isEncrypted() returns true for ENC:-prefixed value', async () => {
    const svc = new CredentialEncryptionService()
    const encrypted = await svc.encrypt('my-secret-token')
    expect(svc.isEncrypted(encrypted)).toBe(true)
  })

  it('decrypt() recovers original value (round-trip)', async () => {
    const svc = new CredentialEncryptionService()
    const original = 'my-secret-token'
    const encrypted = await svc.encrypt(original)
    await expect(svc.decrypt(encrypted)).resolves.toBe(original)
  })

  it('decrypt() rejects on decryption failure', async () => {
    vi.mocked(safeStorage.decryptStringAsync).mockImplementation(async () => {
      throw new Error('Decryption failed')
    })
    const svc = new CredentialEncryptionService()
    await expect(svc.decrypt('ENC:aW52YWxpZA==')).rejects.toThrow('Decryption failed')
  })

  it('hasDecryptionFailed() returns true after a decryption failure', async () => {
    vi.mocked(safeStorage.decryptStringAsync).mockImplementation(async () => {
      throw new Error('Decryption failed')
    })
    const svc = new CredentialEncryptionService()
    await expect(svc.decrypt('ENC:aW52YWxpZA==')).rejects.toThrow()
    expect(svc.hasDecryptionFailed()).toBe(true)
  })

  it('hasDecryptionFailed() resets to false after being read', async () => {
    vi.mocked(safeStorage.decryptStringAsync).mockImplementation(async () => {
      throw new Error('fail')
    })
    const svc = new CredentialEncryptionService()
    await expect(svc.decrypt('ENC:aW52YWxpZA==')).rejects.toThrow()
    svc.hasDecryptionFailed() // first read — true, resets flag
    expect(svc.hasDecryptionFailed()).toBe(false)
  })

  it('encrypt() throws instead of storing plaintext when encryptString fails', async () => {
    vi.mocked(safeStorage.encryptStringAsync).mockImplementation(async () => {
      throw new Error('OS encryption error')
    })
    const svc = new CredentialEncryptionService()
    await expect(svc.encrypt('my-secret')).rejects.toThrow('Encryption failed')
  })
})
