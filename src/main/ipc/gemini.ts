import { IPC_CHANNELS } from '@main/constants/ipcChannels'
import { BrowserWindow } from 'electron'
import { z } from 'zod'
import { getGeminiService, RateLimitError } from '@main/services/GeminiService'
import { LIBRARY_TOOLS, executeTool } from '@main/services/GeminiTools'
import { getGeminiAnalysisService } from '@main/services/GeminiAnalysisService'
import { AiSendMessageSchema, AiStreamMessageSchema, AiTestApiKeySchema } from '@main/validation/schemas'
import { getLoggingService } from '@main/services/LoggingService'
import { APP_CONFIG } from '@main/config'
import { createIpcHandler, createValidatedIpcHandler, createValidatedIpcHandlerWithEvent } from '@main/ipc/utils/createHandler'

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

function formatError(error: unknown) {
  if (error instanceof RateLimitError) return { error: error.message, rateLimited: true, retryAfterSeconds: error.retryAfterSeconds }
  return { error: error instanceof Error ? error.message : String(error) }
}

const wrapAi = (handler: any) => async (...args: any[]) => {
  try { return await handler(...args) } catch (e) { throw formatError(e) }
}

export function registerGeminiHandlers() {
  const service = getGeminiService()

  createIpcHandler(IPC_CHANNELS.AI.IS_CONFIGURED, async () => service.isConfigured())
  createIpcHandler(IPC_CHANNELS.AI.GET_RATE_LIMIT_INFO, async () => service.getRateLimitInfo())

  createValidatedIpcHandler(IPC_CHANNELS.AI.TEST_API_KEY, AiTestApiKeySchema, async (apiKey) => {
    try { return await service.testApiKey(apiKey) }
    catch (e) { return { success: false, error: e instanceof Error ? e.message : 'Unknown error' } }
  })

  createValidatedIpcHandler(IPC_CHANNELS.AI.SEND_MESSAGE, AiSendMessageSchema, wrapAi(async (params: any) => service.sendMessage(params)))

  createValidatedIpcHandlerWithEvent(IPC_CHANNELS.AI.STREAM_MESSAGE, AiStreamMessageSchema, wrapAi(async (event: any, params: any) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const res = await service.streamMessage(params, (delta) => win?.webContents.send('ai:streamDelta', { requestId: params.requestId, delta }))
    win?.webContents.send('ai:streamComplete', { requestId: params.requestId, usage: res.usage })
    return res
  }))

  createValidatedIpcHandlerWithEvent(IPC_CHANNELS.AI.CHAT_MESSAGE, AiChatMessageSchema, async (event: any, params: any) => {
    try {
      const win = BrowserWindow.fromWebContents(event.sender)
      const messages = params.messages.map((m: any, i: number) => {
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
        executeTool: async (name, input) => {
          win?.webContents.send('ai:toolUse', { requestId: params.requestId, toolName: name, input })
          return await executeTool(name, input)
        }
      })

      if (win && res.text) {
        const words = res.text.split(/(\s+)/), chunkSize = 3
        for (let i = 0; i < words.length; i += chunkSize) {
          win.webContents.send('ai:chatStreamDelta', { requestId: params.requestId, delta: words.slice(i, i + chunkSize).join('') })
          if (i + chunkSize < words.length) await new Promise(r => setTimeout(r, 15))
        }
        win.webContents.send('ai:chatStreamComplete', { requestId: params.requestId })
      }
      return { ...res, requestId: params.requestId }
    } catch (e) {
      const fe = formatError(e)
      if ((fe as any).rateLimited) return fe
      throw fe
    }
  })

  const registerReport = (channel: string, method: keyof ReturnType<typeof getGeminiAnalysisService>) => {
    createValidatedIpcHandlerWithEvent(channel, z.object({ requestId: z.string() }), wrapAi(async (event: any, { requestId }: any) => {
      const win = BrowserWindow.fromWebContents(event.sender)
      const res = await (getGeminiAnalysisService()[method] as any)((delta: string) => win?.webContents.send('ai:analysisStreamDelta', { requestId, delta }))
      win?.webContents.send('ai:analysisStreamComplete', { requestId })
      return { text: res.text, requestId }
    }))
  }

  registerReport(IPC_CHANNELS.AI.QUALITY_REPORT, 'generateQualityReport')
  registerReport(IPC_CHANNELS.AI.UPGRADE_PRIORITIES, 'generateUpgradePriorities')
  registerReport(IPC_CHANNELS.AI.COMPLETENESS_INSIGHTS, 'generateCompletenessInsights')
  registerReport(IPC_CHANNELS.AI.WISHLIST_ADVICE, 'generateWishlistAdvice')

  createValidatedIpcHandlerWithEvent(IPC_CHANNELS.AI.COMPRESSION_ADVICE, z.object({ mediaId: z.number(), requestId: z.string() }), wrapAi(async (event: any, { mediaId, requestId }: any) => {
    const res = await getGeminiAnalysisService().getCompressionAdvice(mediaId)
    BrowserWindow.fromWebContents(event.sender)?.webContents.send('ai:analysisStreamComplete', { requestId })
    return { text: res.text, requestId }
  }))

  createValidatedIpcHandler(IPC_CHANNELS.AI.EXPLAIN_QUALITY, z.any(), wrapAi(async (p: any) => ({ text: await service.explainQualityScore(p) })))

  getLoggingService().info('[gemini]', 'Gemini AI IPC handlers registered')
}

