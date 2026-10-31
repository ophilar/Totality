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

  private async run(filePath: string): Promise<string> {
    if (this.active >= this.parallelReads) {
      await new Promise<void>(resolve => this.waiting.push(resolve))
    }
    this.active++
    try {
      return await this.digest(filePath)
    } finally {
      this.active--
      this.waiting.shift()?.()
    }
  }
}
