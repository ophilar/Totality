import { EventEmitter } from 'node:events'
import type { WebContents } from 'electron'
import { describe, expect, it } from 'vitest'
import { OperationRequestRegistry } from '@main/ipc/utils/OperationRequestRegistry'

function createOwner(id: number): WebContents {
  let destroyed = false
  const owner = new EventEmitter() as EventEmitter & { id: number; isDestroyed: () => boolean; send: () => void }
  owner.id = id
  owner.isDestroyed = () => destroyed
  owner.send = () => undefined
  owner.on('destroyed', () => { destroyed = true })
  return owner as unknown as WebContents
}

describe('OperationRequestRegistry', () => {
  it('scopes cancellation to the owning renderer and releases settled requests', () => {
    const registry = new OperationRequestRegistry()
    const owner = createOwner(17)
    const request = registry.register(owner, 'request-1')

    expect(registry.cancel(18, 'request-1')).toBe('missing')
    expect(registry.cancel(17, 'request-1')).toBe('cancelling')
    expect(request.signal.aborted).toBe(true)

    request.dispose()
    expect(registry.cancel(17, 'request-1')).toBe('missing')
  })

  it('reports the commit boundary and aborts pending work when its renderer closes', () => {
    const registry = new OperationRequestRegistry()
    const owner = createOwner(19)
    const committing = registry.register(owner, 'commit')
    committing.beginCommit()

    expect(registry.cancel(19, 'commit')).toBe('committing')
    expect(committing.signal.aborted).toBe(false)
    committing.dispose()

    const pending = registry.register(owner, 'pending')
    owner.emit('destroyed')
    expect(pending.signal.aborted).toBe(true)
    expect(registry.cancel(19, 'pending')).toBe('missing')
    pending.dispose()
  })

  it('retains owner-scoped background outcomes until dismissal and publishes ordered snapshots', () => {
    const registry = new OperationRequestRegistry()
    const owner = createOwner(23)
    const request = registry.register(owner, 'report-1', {
      kind: 'ai-report',
      label: 'Quality report',
    })
    const initial = registry.getSnapshot(23)

    request.update({ phase: 'Generating report' })
    const updated = registry.getSnapshot(23)
    expect(updated.revision).toBeGreaterThan(initial.revision)
    expect(updated.operations[0].phase).toBe('Generating report')

    request.setResult({ text: 'Partial report body' })
    expect(registry.getResult(23, 'report-1')).toEqual({ text: 'Partial report body' })
    expect(JSON.stringify(registry.getSnapshot(23))).not.toContain('Partial report body')

    request.complete('completed', 'Report ready.', { text: 'Report body' })
    request.dispose()
    expect(registry.getSnapshot(24).operations).toEqual([])
    expect(registry.getResult(23, 'report-1')).toEqual({ text: 'Report body' })
    expect(registry.cancel(23, 'report-1')).toBe('missing')

    registry.dismiss(23, 'report-1')
    expect(registry.getSnapshot(23).operations).toEqual([])
  })
})
