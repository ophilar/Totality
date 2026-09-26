import { describe, it, expect, vi } from 'vitest'
import { getKodiMySQLConnectionService } from '@main/services/KodiMySQLConnectionService'

describe('KodiMySQLConnectionService', () => {
  it('detects databases using parameterized query and escaped wildcard pattern parameters', async () => {
    const service = getKodiMySQLConnectionService()
    const mockQuery = vi.fn().mockImplementation(async (sql: string, params?: unknown[]) => {
      if (sql === "SHOW DATABASES WHERE `Database` LIKE ? ESCAPE '!'") {
        const pattern = params?.[0] as string
        if (pattern === 'kodi!_video%') {
          return [[{ Database: 'kodi_video119' }, { Database: 'kodi_video121' }]]
        }
        if (pattern === 'kodi!_music%') {
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
    expect(mockQuery).toHaveBeenNthCalledWith(
      1,
      "SHOW DATABASES WHERE `Database` LIKE ? ESCAPE '!'",
      ['kodi!_video%']
    )
    expect(mockQuery).toHaveBeenNthCalledWith(
      2,
      "SHOW DATABASES WHERE `Database` LIKE ? ESCAPE '!'",
      ['kodi!_music%']
    )

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
})
