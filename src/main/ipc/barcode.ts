import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '../../shared/ipcChannels'
import { getBarcodeLookupService } from '../services/BarcodeLookupService'
import { validateInput } from '../validation/schemas'
import { z } from 'zod/v4'

const BarcodeSchema = z.string().min(8).max(20).regex(/^\d+$/)

export function registerBarcodeHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.barcodeLookup, async (_event, barcode: unknown) => {
    try {
      const validBarcode = validateInput(BarcodeSchema, barcode, 'barcode:lookup')
      const service = getBarcodeLookupService()
      return await service.lookup(validBarcode)
    } catch (error) {
      console.error('[barcode:lookup] Error:', error)
      throw error
    }
  })
}
