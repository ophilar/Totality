import { describe, expect, it } from 'vitest'
import type { IpcMainInvokeEvent } from 'electron'
import { validateSenderFrame } from '@main/ipc/utils/createHandler'
import { createAuthorizedIpcEvent } from '@tests/TestUtils'

describe('IPC sender authorization', () => {
  it('accepts the canonical authorized local frame in the test process', () => {
    expect(() => validateSenderFrame(createAuthorizedIpcEvent(), 'test:authorized')).not.toThrow()
  })

  it('rejects a missing sender frame in the test process', () => {
    expect(() => validateSenderFrame({} as IpcMainInvokeEvent, 'test:missing-frame'))
      .toThrow('Unauthorized IPC request on test:missing-frame: missing sender frame')
  })

  it('rejects a sender frame with no URL in the test process', () => {
    const event = { senderFrame: { url: '' } } as unknown as IpcMainInvokeEvent

    expect(() => validateSenderFrame(event, 'test:missing-url'))
      .toThrow('Unauthorized IPC request on test:missing-url: missing frame URL')
  })

  it('rejects a non-local sender in the test process', () => {
    const event = { senderFrame: { url: 'https://example.com/' } } as unknown as IpcMainInvokeEvent

    expect(() => validateSenderFrame(event, 'test:remote'))
      .toThrow('Unauthorized IPC sender frame for test:remote: https://example.com/')
  })
})
