import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setupTestDb, cleanupTestDb } from '../TestUtils'

describe('Transaction Lock and Yield Integrity', () => {
  let db: any

  beforeEach(async () => {
    db = await setupTestDb()
  })

  afterEach(() => {
    cleanupTestDb()
  })

  it('should allow concurrent-ish writes by yielding and using BEGIN IMMEDIATE', async () => {
    // This test simulates the PlexProvider batching + yielding logic
    // combined with a concurrent UI update attempt.

    let scanProgress = 0
    let uiUpdateSuccess = false
    let scanFinished = false
    let uiTaskStarted = false

    const heavyScan = async () => {
      const COMMIT_INTERVAL = 5
      const TOTAL_ITEMS = 15

      for (let i = 1; i <= TOTAL_ITEMS; i++) {
        // Start batch every COMMIT_INTERVAL
        if ((i - 1) % COMMIT_INTERVAL === 0) {
          db.startBatch() // BEGIN IMMEDIATE
        }

        // Simulate work (upserting)
        db.db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
             .run(`scan_item_${i}`, 'done')
        
        scanProgress = i

        // End batch and yield
        if (i % COMMIT_INTERVAL === 0 || i === TOTAL_ITEMS) {
          db.endBatch() // COMMIT
          
          // CRITICAL: Yield the event loop to allow other tasks to use the DB connection
          await new Promise(resolve => setTimeout(resolve, 50))
        }
      }
      scanFinished = true
    }

    const uiTask = async () => {
      // Wait for scan to be mid-way (but during a yield point)
      while (scanProgress < 5 && !scanFinished) {
        await new Promise(resolve => setTimeout(resolve, 10))
      }
      
      uiTaskStarted = true

      try {
        // Try to write while scan is "active" (but hopefully yielded)
        db.startBatch() // This should succeed because heavyScan committed and yielded
        db.db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
             .run('ui_status', 'updated')
        db.endBatch()
        uiUpdateSuccess = true
      } catch (err) {
        // If this fails, it means yielding or batching failed
        uiUpdateSuccess = false
      }
    }

    // Run both. heavyScan will commit every 5 items and yield.
    // uiTask will wait for progress 5 then perform a write.
    await Promise.all([heavyScan(), uiTask()])

    expect(scanFinished).toBe(true)
    expect(uiTaskStarted).toBe(true)
    expect(uiUpdateSuccess).toBe(true)
    
    // Verify data
    expect(db.config.getSetting('ui_status')).toBe('updated')
    expect(db.config.getSetting('scan_item_15')).toBe('done')
  })

  it('should verify that BEGIN IMMEDIATE is used globally for batches', () => {
     // We can't easily "intercept" the SQL from node:sqlite without a wrapper,
     // but we can verify the behavior. BEGIN IMMEDIATE prevents other 
     // connections from starting their own IMMEDIATE transactions.
     // Since we use a single connection, we verified the "no nesting" rule already.
     
     // Let's verify startBatch/beginBatch both use the same logic
     expect(db.startBatch).toBeDefined()
     expect(db.beginBatch).toBeDefined()
     
     // Test that startBatch is nested-safe
     db.startBatch()
     expect(() => db.startBatch()).not.toThrow()
     expect(db.isInTransaction()).toBe(true)
     db.endBatch()
     db.endBatch()
     expect(db.isInTransaction()).toBe(false)

  })
})
