import { describe, expect, it } from 'vitest'
import { createTestDatabase } from '../helpers/testDatabase'

describe('test database FTS5 support', () => {
  it('creates an FTS5 index and returns MATCH results', async () => {
    const db = await createTestDatabase()
    try {
      db.exec("CREATE VIRTUAL TABLE media_search USING fts5(title, tokenize='unicode61')")
      db.prepare('INSERT INTO media_search(title) VALUES (?)').run('The Fellowship of the Ring')

      expect(db.prepare("SELECT title FROM media_search WHERE media_search MATCH ?").all('Fellowship'))
        .toEqual([{ title: 'The Fellowship of the Ring' }])
    } finally {
      db.close()
    }
  })
})
