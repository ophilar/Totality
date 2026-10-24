import type { WebContents } from 'electron'
import { BrowserWindow } from 'electron'

export type ActivityOperationKind = 'duplicate-scan' | 'ai-report' | 'timeline' | 'plex-playlist' | 'update-download' | 'sonarr-wait' | 'optimization-preflight'
export type ActivityOperationState = 'running' | 'pausing' | 'paused' | 'cancelling' | 'finishing' | 'completed' | 'cancelled' | 'partial' | 'failed'

export interface ActivityOperation {
  requestId: string
  kind: ActivityOperationKind
  label: string
  context?: string
  state: ActivityOperationState
  phase?: string
  progress?: { percentage: number; currentItem?: string }
  outcome?: { message: string; hasResult: boolean }
  resultId?: string
  entity?: {
    seriesTitle?: string
    seriesIdentityKey?: string
    sourceId: string
    libraryId?: string
    mediaItemId?: number
  }
  createdAt: string
  updatedAt: string
}

interface RequestEntry {
  owner: WebContents | null
  ownerId?: number
  disposeOwnerListener?: () => void
  controller: AbortController
  state: 'active' | 'committing'
  activity?: ActivityOperation
  result?: unknown
  paused?: boolean
  resumeWaiter?: () => void
}

export interface RegisteredOperationRequest {
  signal: AbortSignal
  beginCommit: () => void
  setResult: (result: unknown) => void
  update: (update: { phase?: string; progress?: ActivityOperation['progress'] }) => void
  waitUntilRunning: () => Promise<void>
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
      entry.paused = false
      entry.resumeWaiter?.()
      entry.resumeWaiter = undefined
      if (!entry.activity?.outcome && entry.state === 'active' && !controller.signal.aborted) {
        controller.abort(new DOMException('The owning renderer was closed', 'AbortError'))
      }
      this.owners.delete(owner.id)
      owner.removeListener('destroyed', onOwnerDestroyed)
    }
    owner.once('destroyed', onOwnerDestroyed)
    entry.disposeOwnerListener = () => owner.removeListener('destroyed', onOwnerDestroyed)
    if (entry.activity) this.owners.set(owner.id, owner)
    this.requests.set(key, entry)
    if (entry.activity) this.publish(entry)

    return this.createHandle(entry, key)
  }

  registerBackground(requestId: string, activity: Pick<ActivityOperation, 'kind' | 'label' | 'context' | 'entity'>): RegisteredOperationRequest {
    const key = `background:${requestId}`
    if (this.requests.has(key)) throw new Error(`Background operation ${requestId} is already active`)
    const now = new Date().toISOString()
    const entry: RequestEntry = {
      owner: null,
      controller: new AbortController(),
      state: 'active',
      activity: { ...activity, requestId, state: 'running', createdAt: now, updatedAt: now },
    }
    this.requests.set(key, entry)
    this.publish(entry)
    return this.createHandle(entry, key)
  }

  private createHandle(entry: RequestEntry, key: string): RegisteredOperationRequest {
    return {
      signal: entry.controller.signal,
      beginCommit: () => {
        entry.controller.signal.throwIfAborted()
        entry.state = 'committing'
        entry.paused = false
        entry.resumeWaiter?.()
        entry.resumeWaiter = undefined
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
      waitUntilRunning: async () => {
        entry.controller.signal.throwIfAborted()
        if (!entry.paused) return
        if (entry.activity?.state === 'pausing') {
          entry.activity.state = 'paused'
          entry.activity.updatedAt = new Date().toISOString()
          this.publish(entry)
        }
        await new Promise<void>(resolve => { entry.resumeWaiter = resolve })
        entry.controller.signal.throwIfAborted()
      },
      complete: (state, message, result) => this.finishEntry(entry, state, message, result),
      dispose: () => {
        if (!entry.activity || !entry.activity.outcome || !entry.owner || entry.owner.isDestroyed()) {
          entry.disposeOwnerListener?.()
          this.requests.delete(key)
        }
      },
    }
  }

  cancel(ownerId: number, requestId: string): 'cancelling' | 'committing' | 'missing' {
    const entry = this.requests.get(`${ownerId}:${requestId}`) ?? this.requests.get(`background:${requestId}`)
    if (!entry) return 'missing'
    if (entry.activity?.outcome) return 'missing'
    if (entry.state === 'committing') return 'committing'
    if (entry.activity) {
      entry.activity.state = 'cancelling'
      entry.activity.updatedAt = new Date().toISOString()
      this.publish(entry)
    }
    entry.paused = false
    entry.resumeWaiter?.()
    entry.resumeWaiter = undefined
    entry.controller.abort(new DOMException('Operation cancelled by the user', 'AbortError'))
    return 'cancelling'
  }

  setPaused(ownerId: number, requestId: string, paused: boolean): 'pausing' | 'paused' | 'running' | 'committing' | 'missing' {
    const entry = this.requests.get(`${ownerId}:${requestId}`) ?? this.requests.get(`background:${requestId}`)
    if (!entry?.activity || entry.activity.outcome || entry.activity.kind !== 'optimization-preflight') return 'missing'
    if (entry.state === 'committing') return 'committing'
    if (paused) {
      if (entry.paused) return entry.activity.state === 'paused' ? 'paused' : 'pausing'
      entry.paused = true
      entry.activity.state = 'pausing'
      entry.activity.updatedAt = new Date().toISOString()
      this.publish(entry)
      return 'pausing'
    }
    if (!entry.paused) return 'running'
    entry.paused = false
    entry.activity.state = 'running'
    entry.activity.updatedAt = new Date().toISOString()
    entry.resumeWaiter?.()
    entry.resumeWaiter = undefined
    this.publish(entry)
    return 'running'
  }

  getSnapshot(ownerId: number): { revision: number; operations: ActivityOperation[] } {
    const operations = [...this.requests.values()]
      .filter(entry => (entry.ownerId === ownerId || entry.ownerId === undefined) && entry.activity)
      .map(entry => structuredClone(entry.activity!))
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
    return { revision: this.revision, operations }
  }

  getResult(ownerId: number, requestId: string): unknown {
    const entry = this.requests.get(`${ownerId}:${requestId}`) ?? this.requests.get(`background:${requestId}`)
    if (!entry?.activity) throw new Error(`No background operation exists for request ${requestId}`)
    return entry.result
  }

  dismiss(ownerId: number, requestId: string): void {
    const ownerKey = `${ownerId}:${requestId}`
    const backgroundKey = `background:${requestId}`
    const key = this.requests.has(ownerKey) ? ownerKey : backgroundKey
    const entry = this.requests.get(key)
    if (!entry?.activity?.outcome) throw new Error(`Operation ${requestId} cannot be dismissed before it finishes`)
    this.requests.delete(key)
    this.revision++
    this.publishSnapshot(entry.ownerId, entry.owner ?? undefined)
  }

  private finishEntry(entry: RequestEntry, state: Extract<ActivityOperationState, 'completed' | 'cancelled' | 'partial' | 'failed'>, message: string, result?: unknown): void {
    if (!entry.activity) return
    entry.activity.state = state
    entry.activity.phase = undefined
    entry.activity.progress = undefined
    entry.activity.outcome = { message, hasResult: result !== undefined }
    if (result && typeof result === 'object' && 'preflightId' in result && typeof result.preflightId === 'string') {
      entry.activity.resultId = result.preflightId
    }
    entry.activity.updatedAt = new Date().toISOString()
    entry.result = result
    this.publish(entry)
  }

  private publish(entry: RequestEntry): void {
    this.revision++
    this.publishSnapshot(entry.ownerId)
  }

  private publishSnapshot(ownerId?: number, fallbackOwner?: WebContents): void {
    if (ownerId === undefined) {
      for (const window of BrowserWindow.getAllWindows()) {
        if (!window.isDestroyed()) window.webContents.send('operations:updated', this.getSnapshot(window.webContents.id))
      }
      return
    }
    const owner = this.owners.get(ownerId) ?? fallbackOwner ?? [...this.requests.values()].find(entry => entry.ownerId === ownerId)?.owner
    if (!owner || owner.isDestroyed()) return
    owner.send('operations:updated', this.getSnapshot(ownerId))
  }
}

export const operationRequestRegistry = new OperationRequestRegistry()
