import { describe, it, expect, vi } from 'vitest'
import { getKodiMySQLConnectionService } from '@main/services/KodiMySQLConnectionService'

describe('KodiMySQLConnectionService', () => {
  it('detects databases using parameterized query and escaped wildcard pattern parameters', async () => {
    const service = getKodiMySQLConnectionService()
    const mockQuery = vi.fn().mockImplementation(async (sql: string, params?: unknown[]) => {
      if (sql === 'SHOW DATABASES LIKE ?') {
        const pattern = params?.[0] as string
        if (pattern === 'kodi\\_video%') {
          return [[{ Database: 'kodi_video119' }, { Database: 'kodi_video121' }]]
        }
        if (pattern === 'kodi\\_music%') {
          return [[{ Database: 'kodi_music82' }]]
        }
      }
      return [[]]
    })

    const mockConnection = {
      query: mockQuery,
    } as any

    const result = await (service as any).detectDatabasesWithConnection(mockConnection, 'kodi_')

    expect(mockQuery).toHaveBeenCalledTimes(2)
    expect(mockQuery).toHaveBeenNthCalledWith(1, 'SHOW DATABASES LIKE ?', ['kodi\\_video%'])
    expect(mockQuery).toHaveBeenNthCalledWith(2, 'SHOW DATABASES LIKE ?', ['kodi\\_music%'])

    expect(result).toEqual({
      videoDatabase: 'kodi_video121',
      videoVersion: 121,
      musicDatabase: 'kodi_music82',
      musicVersion: 82,
    })
  })

  it('rejects invalid database prefixes with disallowed characters', async () => {
    const service = getKodiMySQLConnectionService()
    const mockConnection = { query: vi.fn() } as any

    await expect(
      (service as any).detectDatabasesWithConnection(mockConnection, 'kodi; DROP TABLE--')
    ).rejects.toThrow('Invalid database prefix: kodi; DROP TABLE--')
  })

  it('validates database names and escapes identifiers correctly in query method', async () => {
    const service = getKodiMySQLConnectionService()

    const mockQuery = vi.fn().mockResolvedValue([[{ id: 1 }], []])
    const mockConnection = {
      query: mockQuery,
      release: vi.fn(),
    }
    const mockPool = {
      getConnection: vi.fn().mockResolvedValue(mockConnection),
    } as any

    // 1. Invalid database identifier should throw error without executing query
    await expect(service.query(mockPool, 'invalid;db', 'SELECT 1')).rejects.toThrow(
      'Invalid database name: invalid;db'
    )
    expect(mockQuery).not.toHaveBeenCalled()

    // 2. Valid database identifier should execute USE with escaped identifier
    const rows = await service.query(mockPool, 'my_kodi_db', 'SELECT * FROM media WHERE id = ?', [
      123,
    ])
    expect(rows).toEqual([{ id: 1 }])
    expect(mockQuery).toHaveBeenNthCalledWith(1, 'USE `my_kodi_db`')
    expect(mockQuery).toHaveBeenNthCalledWith(
      2,
      'SELECT * FROM media WHERE id = ?',
      [123]
    )
    expect(mockConnection.release).toHaveBeenCalled()
  })
})
