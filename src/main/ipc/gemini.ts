import { IPC_CHANNELS } from '@main/constants/ipcChannels'
import { BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import { z } from 'zod'
import { getGeminiService, RateLimitError } from '@main/services/GeminiService'
import { LIBRARY_TOOLS, executeTool } from '@main/services/GeminiTools'
import { getGeminiAnalysisService } from '@main/services/GeminiAnalysisService'
import { AiSendMessageSchema, AiStreamMessageSchema, AiTestApiKeySchema } from '@main/validation/schemas'
import { getLoggingService } from '@main/services/LoggingService'
import { APP_CONFIG } from '@main/config'
import { createIpcHandler, createValidatedIpcHandler, createValidatedIpcHandlerWithEvent } from '@main/ipc/utils/createHandler'
import { operationRequestRegistry } from '@main/ipc/utils/OperationRequestRegistry'

const AiChatMessageSchema = z.object({
  messages: z.array(z.object({
    role: z.enum(['user', 'assistant']),
    content: z.string().min(1).max(100000),
  })).min(1),
  requestId: z.string().min(1).max(100),
  viewContext: z.object({
    currentView: z.enum(['dashboard', 'library']),
    libraryTab: z.enum(['movies', 'tv', 'music']).optional(),
    selectedItem: z.object({ title: z.string(), type: z.string().optional(), id: z.number().optional() }).optional(),
    activeSourceId: z.string().optional(),
    activeFilters: z.string().optional(),
  }).optional(),
})

const QualityExplanationSchema = z.object({
  title: z.string(), resolution: z.string().optional(), videoCodec: z.string().optional(), videoBitrate: z.number().optional(),
  audioCodec: z.string().optional(), audioChannels: z.number().optional(), hdrFormat: z.string().optional(),
  qualityTier: z.string().optional(), tierQuality: z.string().optional(), tierScore: z.number().optional()
})

function formatError(error: unknown) {
  if (error instanceof RateLimitError) return { error: error.message, rateLimited: true, retryAfterSeconds: error.retryAfterSeconds }
  return { error: error instanceof Error ? error.message : String(error) }
}

const wrapAi = <TArgs extends unknown[], TResult>(handler: (...args: TArgs) => Promise<TResult>) => async (...args: TArgs): Promise<TResult | { error: string; rateLimited: boolean; retryAfterSeconds?: number }> => {
  try {
    return await handler(...args)
  } catch (e) {
    const formatted = formatError(e)
    if ('rateLimited' in formatted && formatted.rateLimited) {
      return formatted
    }
    throw formatted
  }
}

export function registerGeminiHandlers() {
  const service = getGeminiService()
  createIpcHandler(IPC_CHANNELS.AI.IS_CONFIGURED, async () => service.isConfigured())
  createIpcHandler(IPC_CHANNELS.AI.GET_RATE_LIMIT_INFO, async () => service.getRateLimitInfo())
  createIpcHandler(IPC_CHANNELS.AI.GET_AVAILABLE_MODELS, async () => service.listModels())
  createIpcHandler(IPC_CHANNELS.AI.VALIDATION_STATE, async () => service.getValidationState())

  createValidatedIpcHandler(IPC_CHANNELS.AI.TEST_API_KEY, AiTestApiKeySchema, async (apiKey) => {
    try { return await service.testApiKey(apiKey) }
    catch (e) { return { success: false, error: e instanceof Error ? e.message : 'Unknown error' } }
  })

  createValidatedIpcHandler(IPC_CHANNELS.AI.SEND_MESSAGE, AiSendMessageSchema, wrapAi(async params => service.sendMessage(params)))

  createValidatedIpcHandlerWithEvent(IPC_CHANNELS.AI.STREAM_MESSAGE, AiStreamMessageSchema, wrapAi(async (event: IpcMainInvokeEvent, params) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const res = await service.streamMessage(params, (delta) => win?.webContents.send('ai:streamDelta', { requestId: params.requestId, delta }))
    win?.webContents.send('ai:streamComplete', { requestId: params.requestId, usage: res.usage })
    return res
  }))

  createValidatedIpcHandlerWithEvent(IPC_CHANNELS.AI.CHAT_MESSAGE, AiChatMessageSchema, async (event: IpcMainInvokeEvent, params) => {
    const operation = operationRequestRegistry.register(event.sender, params.requestId)
    try {
      const win = BrowserWindow.fromWebContents(event.sender)
      const messages = params.messages.map((m, i) => {
        if (params.viewContext && i === params.messages.length - 1 && m.role === 'user') {
          const ctx = params.viewContext
          const parts = [ctx.currentView === 'dashboard' ? 'Viewing: Dashboard' : `Viewing: ${ctx.libraryTab} library`]
          if (ctx.selectedItem) parts.push(`Selected: "${ctx.selectedItem.title}"`)
          if (ctx.activeFilters) parts.push(`Filters: ${ctx.activeFilters}`)
          return { ...m, content: `[${parts.join(' | ')}]\n${m.content}` }
        }
        return m
      })

      const res = await service.sendMessageWithTools({
        messages, system: APP_CONFIG.ai.libraryChat, tools: LIBRARY_TOOLS, maxTokens: 4096,
        signal: operation.signal,
        executeTool: async (name, input) => {
          operation.signal.throwIfAborted()
          win?.webContents.send('ai:toolUse', { requestId: params.requestId, toolName: name, input })
          if (!input || typeof input !== 'object' || Array.isArray(input)) {
            throw new Error(`Tool ${name} requires an object input`)
          }
          const result = await executeTool(name, input as Record<string, unknown>)
          operation.signal.throwIfAborted()
          return result
        }
      })

      if (win && res.text) {
        const words = res.text.split(/(\s+)/), chunkSize = 3
        for (let i = 0; i < words.length; i += chunkSize) {
          operation.signal.throwIfAborted()
          win.webContents.send('ai:chatStreamDelta', { requestId: params.requestId, delta: words.slice(i, i + chunkSize).join('') })
          if (i + chunkSize < words.length) await new Promise<void>((resolve, reject) => {
            const onAbort = () => {
              clearTimeout(timer)
              reject(operation.signal.reason)
            }
            const timer = setTimeout(() => {
              operation.signal.removeEventListener('abort', onAbort)
              resolve()
            }, 15)
            operation.signal.addEventListener('abort', onAbort, { once: true })
            if (operation.signal.aborted) onAbort()
          })
        }
        win.webContents.send('ai:chatStreamComplete', { requestId: params.requestId })
      }
      return { ...res, requestId: params.requestId }
    } catch (e) {
      const fe = formatError(e)
      if ('rateLimited' in fe && fe.rateLimited) return fe
      throw fe
    } finally {
      operation.dispose()
    }
  })

  type ReportMethod = 'generateQualityReport' | 'generateUpgradePriorities' | 'generateCompletenessInsights' | 'generateWishlistAdvice'
  const registerReport = (channel: string, method: ReportMethod, label: string) => {
    createValidatedIpcHandlerWithEvent(channel, z.object({ requestId: z.string() }), async (event: IpcMainInvokeEvent, { requestId }) => {
      const operation = operationRequestRegistry.register(event.sender, requestId, { kind: 'ai-report', label })
      operation.update({ phase: 'Preparing library report' })
      const win = BrowserWindow.fromWebContents(event.sender)
      let accumulatedText = ''
      try {
        operation.update({ phase: 'Generating report' })
        const res = await getGeminiAnalysisService()[method]((delta: string) => {
          accumulatedText += delta
          operation.setResult({ text: accumulatedText })
          win?.webContents.send('ai:analysisStreamDelta', { requestId, delta })
        }, operation.signal)
        operation.signal.throwIfAborted()
        win?.webContents.send('ai:analysisStreamComplete', { requestId })
        operation.complete('completed', `${label} is ready.`, { text: res.text })
        return { text: res.text, requestId }
      } catch (error) {
        if (operation.signal.aborted) {
          operation.complete('cancelled', `${label} cancelled.`, accumulatedText ? { text: accumulatedText } : undefined)
          return { cancelled: true as const, requestId }
        }
        const formatted = formatError(error)
        operation.complete('failed', formatted.error)
        if ('rateLimited' in formatted) return formatted
        throw formatted
      } finally {
        operation.dispose()
      }
    })
  }

  registerReport(IPC_CHANNELS.AI.QUALITY_REPORT, 'generateQualityReport', 'AI quality report')
  registerReport(IPC_CHANNELS.AI.UPGRADE_PRIORITIES, 'generateUpgradePriorities', 'AI upgrade priorities')
  registerReport(IPC_CHANNELS.AI.COMPLETENESS_INSIGHTS, 'generateCompletenessInsights', 'AI completeness insights')
  registerReport(IPC_CHANNELS.AI.WISHLIST_ADVICE, 'generateWishlistAdvice', 'AI wishlist advice')

  createValidatedIpcHandlerWithEvent(IPC_CHANNELS.AI.COMPRESSION_ADVICE, z.object({ mediaId: z.number(), requestId: z.string() }), wrapAi(async (event: IpcMainInvokeEvent, { mediaId, requestId }) => {
    const res = await getGeminiAnalysisService().getCompressionAdvice(mediaId)
    BrowserWindow.fromWebContents(event.sender)?.webContents.send('ai:analysisStreamComplete', { requestId })
    return { text: res.text, requestId }
  }))

  createValidatedIpcHandler(IPC_CHANNELS.AI.EXPLAIN_QUALITY, QualityExplanationSchema, wrapAi(async p => ({ text: await service.explainQualityScore(p) })))

  getLoggingService().info('[gemini]', 'Gemini AI IPC handlers registered')
}

