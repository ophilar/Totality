import { stat } from 'node:fs/promises'
import { fileIdentity, matchesFileIdentity, type FileIdentity } from '../utils/FileIdentity'

/**
 * Per-operation digest memoization with a hard limit on simultaneous file reads.
 * Callers should instantiate a new hasher at each integrity boundary; a digest
 * from an earlier operation is never proof that the current bytes are unchanged.
 */
export class OperationFileHasher {
  private readonly pending = new Map<string, Promise<string>>()
  private readonly waiting: Array<() => void> = []
  private active = 0

  constructor(private readonly digest: (filePath: string) => Promise<string>, private readonly parallelReads: number) {
    if (!Number.isSafeInteger(parallelReads) || parallelReads < 1) {
      throw new Error('Hash read concurrency must be a positive integer')
    }
  }

  hash(filePath: string, identityKey = filePath): Promise<string> {
    let pending = this.pending.get(identityKey)
    if (pending) return pending
    pending = this.run(filePath).catch(error => {
      this.pending.delete(identityKey)
      throw error
    })
    this.pending.set(identityKey, pending)
    return pending
  }

  /** Reuse only within an unchanged file identity, including on repeated reads. */
  async hashStable(filePath: string, expected?: FileIdentity): Promise<string> {
    const before = fileIdentity(await stat(filePath))
    if (expected && !matchesFileIdentity(expected, before)) throw new Error(`File changed before hashing: ${filePath}`)
    const digest = await this.hash(filePath, JSON.stringify([filePath, before]))
    if (!matchesFileIdentity(before, await stat(filePath))) throw new Error(`File changed during hashing: ${filePath}`)
    return digest
  }

  private async run(filePath: string): Promise<string> {
    if (this.active >= this.parallelReads) {
      // A queued reader inherits a reserved permit from the completing reader.
      await new Promise<void>(resolve => this.waiting.push(resolve))
    } else {
      this.active++
    }
    try {
      return await this.digest(filePath)
    } finally {
      const next = this.waiting.shift()
      if (next) next()
      else this.active--
    }
  }
}
