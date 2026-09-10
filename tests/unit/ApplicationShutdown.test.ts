import { describe, expect, it } from 'vitest'
import {
  ApplicationShutdown,
  ApplicationShutdownError,
  type ApplicationShutdownOperations,
  type ApplicationShutdownStage,
} from '@main/services/ApplicationShutdown'

const orderedStages: ApplicationShutdownStage[] = [
  'stop-accepting-work',
  'pause-task-queue',
  'shutdown-worker-pool',
  'persist-interrupted-tasks',
  'checkpoint-wal',
  'close-database',
  'shutdown-logging',
]

function createOperations(failingStage?: ApplicationShutdownStage) {
  const calls: ApplicationShutdownStage[] = []
  const cause = new Error('injected shutdown failure')

  const execute = async (stage: ApplicationShutdownStage): Promise<void> => {
    calls.push(stage)
    if (stage === failingStage) throw cause
  }

  const operations: ApplicationShutdownOperations = {
    stopAcceptingWork: () => {
      calls.push('stop-accepting-work')
      if (failingStage === 'stop-accepting-work') throw cause
    },
    pauseTaskQueue: () => execute('pause-task-queue'),
    shutdownWorkerPool: () => execute('shutdown-worker-pool'),
    persistInterruptedTasks: () => execute('persist-interrupted-tasks'),
    checkpointWal: () => execute('checkpoint-wal'),
    closeDatabase: () => {
      calls.push('close-database')
      if (failingStage === 'close-database') throw cause
    },
    shutdownLogging: () => execute('shutdown-logging'),
  }

  return { calls, cause, operations }
}

describe('ApplicationShutdown', () => {
  it('completes durability-critical shutdown steps in one canonical order', async () => {
    const { calls, operations } = createOperations()

    await new ApplicationShutdown(operations).execute()

    expect(calls).toEqual(orderedStages)
  })

  it.each(orderedStages)('fails explicitly and stops at %s', async failingStage => {
    const { calls, cause, operations } = createOperations(failingStage)

    let failure: unknown
    try {
      await new ApplicationShutdown(operations).execute()
    } catch (error) {
      failure = error
    }

    expect(failure).toBeInstanceOf(ApplicationShutdownError)
    expect((failure as ApplicationShutdownError).stage).toBe(failingStage)
    expect((failure as Error).cause).toBe(cause)
    expect(calls).toEqual(orderedStages.slice(0, orderedStages.indexOf(failingStage) + 1))
  })
})
