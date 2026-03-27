import { ipcMain } from 'electron'
import { getSeriesCompletenessService } from '../services/SeriesCompletenessService'
import { z } from 'zod'
import { validateInput } from '../validation/schemas'
import { getLoggingService } from '../services/LoggingService'

const SeriesTitleSchema = z.string().min(1)
const SourceIdSchema = z.string().optional()
const LibraryIdSchema = z.string().optional()

export function registerSeriesHandlers(): void {
  const service = getSeriesCompletenessService()

  ipcMain.handle('series:getAll', async (_event, sourceId?: string) => {
    try {
      const validSourceId = sourceId ? SourceIdSchema.parse(sourceId) : undefined
      return service.analyzeAllSeries(validSourceId)
    } catch (error) {
      getLoggingService().error('[series]', 'Error getting series completeness:', error)
      throw error
    }
  })

  ipcMain.handle('series:analyzeAll', async (_event, sourceId?: string, libraryId?: string) => {
    try {
      const validSourceId = sourceId ? SourceIdSchema.parse(sourceId) : undefined
      const validLibraryId = libraryId ? LibraryIdSchema.parse(libraryId) : undefined
      
      return await service.analyzeAllSeries(validSourceId, validLibraryId)
    } catch (error) {
      getLoggingService().error('[series]', 'Error analyzing all series:', error)
      throw error
    }
  })

  ipcMain.handle('series:analyzeOne', async (_event, seriesTitle: string, sourceId?: string, libraryId?: string) => {
    try {
      const validTitle = validateInput(SeriesTitleSchema, seriesTitle)
      const validSourceId = sourceId ? SourceIdSchema.parse(sourceId) : undefined
      const validLibraryId = libraryId ? LibraryIdSchema.parse(libraryId) : undefined
      return await service.analyzeSeries(validTitle, validSourceId, validLibraryId)
    } catch (error) {
      getLoggingService().error('[series]', `Error analyzing series "${seriesTitle}":`, error)
      throw error
    }
  })

  ipcMain.handle('series:getEpisodes', async (_event, seriesTitle: string, sourceId?: string) => {
    try {
      const validTitle = validateInput(SeriesTitleSchema, seriesTitle)
      const validSourceId = sourceId ? SourceIdSchema.parse(sourceId) : undefined
      return service.analyzeSeries(validTitle, validSourceId) 
    } catch (error) {
      getLoggingService().error('[series]', `Error getting episodes for "${seriesTitle}":`, error)
      throw error
    }
  })

  ipcMain.handle('series:cancel', async () => {
    try {
      service.cancel()
    } catch (error) {
      getLoggingService().error('[series]', 'Error cancelling series analysis:', error)
      throw error
    }
  })

  getLoggingService().info('[series]', 'Series IPC handlers registered')
}
