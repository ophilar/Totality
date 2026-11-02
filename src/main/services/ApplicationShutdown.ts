export type ApplicationShutdownStage =
  | 'stop-accepting-work'
  | 'pause-task-queue'
  | 'shutdown-worker-pool'
  | 'persist-interrupted-tasks'
  | 'checkpoint-wal'
  | 'close-database'
  | 'shutdown-logging'

export interface ApplicationShutdownOperations {
  stopAcceptingWork: () => void
  pauseTaskQueue: () => Promise<void>
  shutdownWorkerPool: () => Promise<void>
  persistInterruptedTasks: () => Promise<void>
  checkpointWal: () => Promise<void>
  closeDatabase: () => void
  shutdownLogging: () => Promise<void>
}

export class ApplicationShutdownError extends Error {
  public readonly cause: unknown

  constructor(
    public readonly stage: ApplicationShutdownStage,
    cause: unknown
  ) {
    super(`Application shutdown failed during ${stage}`)
    this.name = 'ApplicationShutdownError'
    this.cause = cause
  }
}

export class ApplicationShutdown {
  constructor(private readonly operations: ApplicationShutdownOperations) {}

  async execute(): Promise<void> {
    await this.run('stop-accepting-work', () => this.operations.stopAcceptingWork())
    await this.run('pause-task-queue', this.operations.pauseTaskQueue)
    await this.run('shutdown-worker-pool', this.operations.shutdownWorkerPool)
    await this.run('persist-interrupted-tasks', this.operations.persistInterruptedTasks)
    await this.run('checkpoint-wal', this.operations.checkpointWal)
    await this.run('close-database', () => this.operations.closeDatabase())
    await this.run('shutdown-logging', this.operations.shutdownLogging)
  }

  private async run(stage: ApplicationShutdownStage, operation: () => void | Promise<void>): Promise<void> {
    try {
      await operation()
    } catch (cause) {
      throw new ApplicationShutdownError(stage, cause)
    }
  }
}
