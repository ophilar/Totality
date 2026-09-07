import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { TaskQueueService } from '@main/services/TaskQueueService'
import { MusicBrainzService } from '@main/services/MusicBrainzService'
import * as fs from 'fs'
import * as path from 'path'
import { getLoggingService } from '@main/services/LoggingService'
import { getDatabase, resetBetterSQLiteServiceForTesting } from '@main/database/BetterSQLiteService'
import { ProviderType, TaskStatus, TaskType } from '@main/types/database'

describe('TaskQueueService (No Mocks)', () => {
  const dbPath = path.join(__dirname, 'task-queue.db')
  let taskQueue: TaskQueueService
  let realDbWrapper: ReturnType<typeof getDatabase>

  beforeEach(async () => {
    resetBetterSQLiteServiceForTesting()
    if (fs.existsSync(dbPath)) {
      fs.unlinkSync(dbPath)
    }

    realDbWrapper = getDatabase()
    await realDbWrapper.initialize(dbPath)

    const logging = getLoggingService()

    taskQueue = new TaskQueueService({ db: realDbWrapper, logging })
    await taskQueue.clearTaskHistory()
  })

  afterEach(async () => {
    realDbWrapper?.close()
    if (fs.existsSync(dbPath)) {
      fs.unlinkSync(dbPath)
    }
  })

  it('should queue multiple tasks', async () => {
    await taskQueue.pause()

    const id1 = await taskQueue.addTask({ type: 'library-scan', label: 'Task 1' })
    const id2 = await taskQueue.addTask({ type: 'source-scan', label: 'Task 2' })

    const queue = taskQueue.getState().queue
    expect(queue.length).toBe(2)
    expect(queue[0].id).toBe(id1)
    expect(queue[1].id).toBe(id2)
  })

  it('should remove a queued task', async () => {
    await taskQueue.pause()
    await taskQueue.addTask({ type: 'library-scan', label: 'Task 1' })
    const id2 = await taskQueue.addTask({ type: 'source-scan', label: 'Task 2' })

    const removed = await taskQueue.removeTask(id2)
    expect(removed).toBe(true)
    expect(taskQueue.getState().queue.length).toBe(1)
  })

  it('should handle pause and resume', async () => {
    await taskQueue.pause()
    await taskQueue.addTask({ type: 'library-scan', label: 'Task 1', sourceId: 's1', libraryId: 'l1' })

    expect(taskQueue.getState().currentTask).toBeNull()
    expect(taskQueue.getState().queue.length).toBe(1)

    await taskQueue.resume()

    const state = taskQueue.getState()
    expect(state.queue.length).toBe(0)
    expect(state.currentTask !== null || taskQueue.getTaskHistory().length > 0).toBe(true)
  })

  it('should clear history', async () => {
    await taskQueue.clearTaskHistory()
    expect(taskQueue.getTaskHistory().length).toBe(0)
  })

  it('reports concrete music analysis counts with real services', async () => {
    await taskQueue.pause()
    const taskId = await taskQueue.addTask({
      type: TaskType.MusicCompleteness,
      label: 'Analyze empty music library'
    })

    await taskQueue.resume()

    let completedTask = taskQueue.getTaskHistory().find(task => task.id === taskId)
    for (let attempt = 0; attempt < 50 && !completedTask; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 50))
      completedTask = taskQueue.getTaskHistory().find(task => task.id === taskId)
    }

    if (!completedTask) {
      throw new Error(`Music completeness task did not complete: ${taskId}`)
    }

    expect(completedTask.status, completedTask.error).toBe(TaskStatus.Completed)
    expect(completedTask.result?.itemsScanned).toBe(0)
    expect(completedTask.result?.outcome?.completedCount).toBe(0)
    expect(completedTask.result?.outcome?.failedCount).toBe(0)
    expect(completedTask.result?.outcome?.deferredCount).toBe(0)
  })

  it('fails before provider lookup when album artist identity is inconsistent', async () => {
    const sourceId = 'identity-integrity-source'
    const artistId = await realDbWrapper.music.upsertArtist({
      source_id: sourceId,
      source_type: ProviderType.Local,
      library_id: 'music',
      provider_id: 'artist-1',
      name: 'Expected Artist',
    })
    await realDbWrapper.music.upsertAlbum({
      source_id: sourceId,
      source_type: ProviderType.Local,
      library_id: 'music',
      provider_id: 'album-1',
      artist_id: artistId,
      artist_name: 'Wrong Artist',
      title: 'The Best of Enya',
    })

    await taskQueue.pause()
    const taskId = await taskQueue.addTask({
      type: TaskType.MusicCompleteness,
      label: 'Reject corrupt music identity',
      sourceId,
    })
    await taskQueue.resume()

    let completedTask = taskQueue.getTaskHistory().find(task => task.id === taskId)
    for (let attempt = 0; attempt < 50 && !completedTask; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 50))
      completedTask = taskQueue.getTaskHistory().find(task => task.id === taskId)
    }

    if (!completedTask) {
      throw new Error(`Music identity task did not complete: ${taskId}`)
    }

    expect(completedTask.status).toBe(TaskStatus.Failed)
    expect(completedTask.error).toContain('Music database integrity error')
    expect(completedTask.error).toContain('stored as artist "Wrong Artist"')
    expect(completedTask.error).toContain('resolves to "Expected Artist"')
  })

  it('rejects inconsistent linked identity in direct album analysis before provider lookup', async () => {
    const sourceId = 'direct-identity-integrity-source'
    const artistId = await realDbWrapper.music.upsertArtist({
      source_id: sourceId,
      source_type: ProviderType.Local,
      library_id: 'music',
      provider_id: 'artist-direct',
      name: 'Expected Artist',
    })
    const albumId = await realDbWrapper.music.upsertAlbum({
      source_id: sourceId,
      source_type: ProviderType.Local,
      library_id: 'music',
      provider_id: 'album-direct',
      artist_id: artistId,
      artist_name: 'Wrong Artist',
      title: 'The Best of Enya',
    })

    const service = new MusicBrainzService()

    await expect(
      service.analyzeAlbumTrackCompleteness(
        albumId,
        'Wrong Artist',
        'The Best of Enya',
        undefined,
        []
      )
    ).rejects.toThrow('Music database integrity error')
  })
})
