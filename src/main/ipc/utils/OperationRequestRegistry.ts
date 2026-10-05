import type { WebContents } from 'electron'

export type ActivityOperationKind = 'duplicate-scan' | 'ai-report' | 'timeline' | 'plex-playlist' | 'update-download' | 'sonarr-wait'
export type ActivityOperationState = 'running' | 'cancelling' | 'finishing' | 'completed' | 'cancelled' | 'partial' | 'failed'

export interface ActivityOperation {
  requestId: string
  kind: ActivityOperationKind
  label: string
  context?: string
  state: ActivityOperationState
  phase?: string
  progress?: { percentage: number; currentItem?: string }
  outcome?: { message: string; hasResult: boolean }
  createdAt: string
  updatedAt: string
}

interface RequestEntry {
  owner: WebContents
  ownerId: number
  controller: AbortController
  state: 'active' | 'committing'
  activity?: ActivityOperation
  result?: unknown
}

export interface RegisteredOperationRequest {
  signal: AbortSignal
  beginCommit: () => void
  setResult: (result: unknown) => void
  update: (update: { phase?: string; progress?: ActivityOperation['progress'] }) => void
  complete: (state: Extract<ActivityOperationState, 'completed' | 'cancelled' | 'partial' | 'failed'>, message: string, result?: unknown) => void
  dispose: () => void
}

export class OperationRequestRegistry {
  private readonly requests = new Map<string, RequestEntry>()
  private readonly owners = new Map<number, WebContents>()
  private revision = 0

  register(owner: WebContents, requestId: string, activity?: Pick<ActivityOperation, 'kind' | 'label' | 'context'>): RegisteredOperationRequest {
    const key = `${owner.id}:${requestId}`
    if (this.requests.has(key)) throw new Error(`Operation request ${requestId} is already active`)

    const now = new Date().toISOString()
    const controller = new AbortController()
    const entry: RequestEntry = {
      owner,
      ownerId: owner.id,
      controller,
      state: 'active',
      ...(activity ? { activity: { ...activity, requestId, state: 'running', createdAt: now, updatedAt: now } } : {}),
    }
    const onOwnerDestroyed = () => {
      if (entry.activity?.outcome || entry.state === 'active') this.requests.delete(key)
      if (!entry.activity?.outcome && entry.state === 'active' && !controller.signal.aborted) {
        controller.abort(new DOMException('The owning renderer was closed', 'AbortError'))
      }
      this.owners.delete(owner.id)
      owner.removeListener('destroyed', onOwnerDestroyed)
    }
    owner.once('destroyed', onOwnerDestroyed)
    if (entry.activity) this.owners.set(owner.id, owner)
    this.requests.set(key, entry)
    if (entry.activity) this.publish(entry)

    return {
      signal: controller.signal,
      beginCommit: () => {
        controller.signal.throwIfAborted()
        entry.state = 'committing'
        if (entry.activity) {
          entry.activity.state = 'finishing'
          entry.activity.updatedAt = new Date().toISOString()
        }
        if (entry.activity) this.publish(entry)
      },
      setResult: result => { entry.result = result },
      update: update => {
        if (!entry.activity || entry.activity.state !== 'running') return
        entry.activity.phase = update.phase
        entry.activity.progress = update.progress
        entry.activity.updatedAt = new Date().toISOString()
        this.publish(entry)
      },
      complete: (state, message, result) => this.finishEntry(entry, state, message, result),
      dispose: () => {
        if (!entry.activity || !entry.activity.outcome || owner.isDestroyed()) {
          owner.removeListener('destroyed', onOwnerDestroyed)
          this.requests.delete(key)
        }
      },
    }
  }

  cancel(ownerId: number, requestId: string): 'cancelling' | 'committing' | 'missing' {
    const entry = this.requests.get(`${ownerId}:${requestId}`)
    if (!entry) return 'missing'
    if (entry.activity?.outcome) return 'missing'
    if (entry.state === 'committing') return 'committing'
    if (entry.activity) {
      entry.activity.state = 'cancelling'
      entry.activity.updatedAt = new Date().toISOString()
      this.publish(entry)
    }
    entry.controller.abort(new DOMException('Operation cancelled by the user', 'AbortError'))
    return 'cancelling'
  }

  getSnapshot(ownerId: number): { revision: number; operations: ActivityOperation[] } {
    const operations = [...this.requests.values()]
      .filter(entry => entry.ownerId === ownerId && entry.activity)
      .map(entry => structuredClone(entry.activity!))
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
    return { revision: this.revision, operations }
  }

  getResult(ownerId: number, requestId: string): unknown {
    const entry = this.requests.get(`${ownerId}:${requestId}`)
    if (!entry?.activity) throw new Error(`No background operation exists for request ${requestId}`)
    return entry.result
  }

  dismiss(ownerId: number, requestId: string): void {
    const key = `${ownerId}:${requestId}`
    const entry = this.requests.get(key)
    if (!entry?.activity?.outcome) throw new Error(`Operation ${requestId} cannot be dismissed before it finishes`)
    this.requests.delete(key)
    this.revision++
    this.publishSnapshot(entry.ownerId, entry.owner)
  }

  private finishEntry(entry: RequestEntry, state: Extract<ActivityOperationState, 'completed' | 'cancelled' | 'partial' | 'failed'>, message: string, result?: unknown): void {
    if (!entry.activity) return
    entry.activity.state = state
    entry.activity.phase = undefined
    entry.activity.progress = undefined
    entry.activity.outcome = { message, hasResult: result !== undefined }
    entry.activity.updatedAt = new Date().toISOString()
    entry.result = result
    this.publish(entry)
  }

  private publish(entry: RequestEntry): void {
    this.revision++
    this.publishSnapshot(entry.ownerId)
  }

  private publishSnapshot(ownerId: number, fallbackOwner?: WebContents): void {
    const owner = this.owners.get(ownerId) ?? fallbackOwner ?? [...this.requests.values()].find(entry => entry.ownerId === ownerId)?.owner
    if (!owner || owner.isDestroyed()) return
    owner.send('operations:updated', this.getSnapshot(ownerId))
  }
}

export const operationRequestRegistry = new OperationRequestRegistry()
