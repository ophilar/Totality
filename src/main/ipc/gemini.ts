import { IPC_CHANNELS } from '../../shared/ipcChannels'
import { BrowserWindow } from 'electron'
import { safeSend } from './utils/safeSend'
import { z } from 'zod'
import { getGeminiService, RateLimitError } from '../services/GeminiService'
import { LIBRARY_TOOLS, executeTool, type ActionableItem } from '../services/GeminiTools'
import { LIBRARY_CHAT_SYSTEM_PROMPT } from '../services/ai-system-prompts'
import { getGeminiAnalysisService } from '../services/GeminiAnalysisService'
import { validateInput, AiSendMessageSchema, AiStreamMessageSchema, AiTestApiKeySchema } from '../validation/schemas'
import { createIpcHandler, createIpcHandlerWithEvent } from './utils/createHandler'


const AiChatMessageSchema = z.object({
  messages: z.array(z.object({
    role: z.enum(['user', 'assistant']),
    content: z.string().min(1).max(100000),
  })).min(1),
  requestId: z.string().min(1).max(100),
  viewContext: z.object({
    currentView: z.enum(['dashboard', 'library']),
    libraryTab: z.enum(['movies', 'tv', 'music']).optional(),
    selectedItem: z.object({
      title: z.string(),
      type: z.string().optional(),
      id: z.number().optional(),
    }).optional(),
    activeSourceId: z.string().optional(),
    activeFilters: z.string().optional(),
  }).optional(),
})

/**
 * Format errors for IPC responses, with special handling for rate limits
 */
function formatError(error: unknown): { error: string; rateLimited?: boolean; retryAfterSeconds?: number } {
  if (error instanceof RateLimitError) {
    return {
      error: error.message,
      rateLimited: true,
      retryAfterSeconds: error.retryAfterSeconds,
    }
  }
  return { error: error instanceof Error ? error.message : String(error) }
}

/**
 * Register all Gemini AI IPC handlers
 */
export function registerGeminiHandlers() {
  createIpcHandler(IPC_CHANNELS.aiIsConfigured, async () => {
    return getGeminiService().isConfigured()
  })

  createIpcHandler(IPC_CHANNELS.aiGetRateLimitInfo, async () => {
    return getGeminiService().getRateLimitInfo()
  })

  createIpcHandler(IPC_CHANNELS.aiTestApiKey, async (apiKey: unknown) => {
    try {
      const validKey = validateInput(AiTestApiKeySchema, apiKey, 'ai:testApiKey')
      return await getGeminiService().testApiKey(validKey)
    } catch (error) {
      console.error('Error testing Gemini API key:', error)
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
    }
  })

  createIpcHandler(IPC_CHANNELS.aiSendMessage, async (params: unknown) => {
    try {
      const validated = validateInput(AiSendMessageSchema, params, 'ai:sendMessage')
      return await getGeminiService().sendMessage(validated)
    } catch (error) {
      console.error('Error in ai:sendMessage:', error)
      const formatted = formatError(error)
      if (formatted.rateLimited) return formatted
      throw formatted
    }
  })

  createIpcHandlerWithEvent(IPC_CHANNELS.aiStreamMessage, async (event, params: unknown) => {
    try {
      const validated = validateInput(AiStreamMessageSchema, params, 'ai:streamMessage')
      const win = BrowserWindow.fromWebContents(event.sender)

      const result = await getGeminiService().streamMessage(
        {
          messages: validated.messages,
          system: validated.system,
          maxTokens: validated.maxTokens,
        },
        (delta) => {
          safeSend(win,IPC_CHANNELS.aiStreamDelta, {
            requestId: validated.requestId,
            delta,
          })
        },
      )

      safeSend(win,IPC_CHANNELS.aiStreamComplete, {
        requestId: validated.requestId,
        usage: result.usage,
      })

      return result
    } catch (error) {
      console.error('Error in ai:streamMessage:', error)
      const formatted = formatError(error)
      if (formatted.rateLimited) return formatted
      throw formatted
    }
  })

  /**
   * Chat message handler with tool use.
   */
  createIpcHandlerWithEvent(IPC_CHANNELS.aiChatMessage, async (event, params: unknown) => {
    try {
      const validated = validateInput(AiChatMessageSchema, params, 'ai:chatMessage')
      console.log('[IPC ai:chatMessage] Chat message received, history length:', validated.messages.length)
      const win = BrowserWindow.fromWebContents(event.sender)
      const actionableItems: ActionableItem[] = []

      // Inject view context into the last user message if provided
      const messages = validated.messages.map((m, i) => {
        if (validated.viewContext && i === validated.messages.length - 1 && m.role === 'user') {
          const ctx = validated.viewContext
          const parts: string[] = []
          if (ctx.currentView === 'dashboard') parts.push('Viewing: Dashboard')
          else if (ctx.libraryTab) parts.push(`Viewing: ${ctx.libraryTab} library`)
          if (ctx.selectedItem) parts.push(`Selected: "${ctx.selectedItem.title}"`)
          if (ctx.activeFilters) parts.push(`Filters: ${ctx.activeFilters}`)
          if (parts.length > 0) {
            return { ...m, content: `[${parts.join(' | ')}]\n${m.content}` }
          }
        }
        return m
      })

      const result = await getGeminiService().sendMessageWithTools({
        messages,
        system: LIBRARY_CHAT_SYSTEM_PROMPT,
        tools: LIBRARY_TOOLS,
        maxTokens: 4096,
        executeTool: async (name, input) => {
          safeSend(win, IPC_CHANNELS.aiToolUse, {
            requestId: validated.requestId,
            toolName: name,
            input,
          })
          return await executeTool(name, input, actionableItems)
        },
      })

      // Stream the final response word-by-word for perceived responsiveness
      if (win && result.text) {
        const words = result.text.split(/(\s+)/)
        const chunkSize = 3 // Send ~3 tokens at a time
        for (let i = 0; i < words.length; i += chunkSize) {
          const chunk = words.slice(i, i + chunkSize).join('')
          if (!safeSend(win, IPC_CHANNELS.aiChatStreamDelta, {
            requestId: validated.requestId,
            delta: chunk,
          })) break // Window was closed, stop streaming
          // Small delay between chunks for streaming effect
          if (i + chunkSize < words.length) {
            await new Promise((r) => setTimeout(r, 15))
          }
        }
        safeSend(win, IPC_CHANNELS.aiChatStreamComplete, {
          requestId: validated.requestId,
        })
      }

      return {
        text: result.text,
        actionableItems: actionableItems.length > 0 ? actionableItems : undefined,
        usage: result.usage,
        requestId: validated.requestId,
      }
    } catch (error) {
      console.error('Error in ai:chatMessage:', error)
      const formatted = formatError(error)
      if (formatted.rateLimited) {
        console.log('[IPC ai:chatMessage] Rate limited, retry after', formatted.retryAfterSeconds, 'seconds')
        return formatted
      }
      throw formatted
    }
  })

  /**
   * Analysis report handlers — stream AI-generated reports to the renderer.
   */

  createIpcHandlerWithEvent(IPC_CHANNELS.aiQualityReport, async (event, params: unknown) => {
    try {
      const { requestId } = validateInput(
        z.object({ requestId: z.string().min(1).max(100) }),
        params,
        'ai:qualityReport',
      )
      const win = BrowserWindow.fromWebContents(event.sender)

      console.log('[IPC ai:qualityReport] Generating quality report')
      const result = await getGeminiAnalysisService().generateQualityReport(
        (delta) => {
          safeSend(win,IPC_CHANNELS.aiAnalysisStreamDelta, { requestId, delta })
        },
      )

      safeSend(win,IPC_CHANNELS.aiAnalysisStreamComplete, { requestId })
      return { text: result.text, requestId }
    } catch (error) {
      console.error('Error in ai:qualityReport:', error)
      const formatted = formatError(error)
      if (formatted.rateLimited) return formatted
      throw formatted
    }
  })

  createIpcHandlerWithEvent(IPC_CHANNELS.aiUpgradePriorities, async (event, params: unknown) => {
    try {
      const { requestId } = validateInput(
        z.object({ requestId: z.string().min(1).max(100) }),
        params,
        'ai:upgradePriorities',
      )
      const win = BrowserWindow.fromWebContents(event.sender)

      console.log('[IPC ai:upgradePriorities] Generating upgrade priorities report')
      const result = await getGeminiAnalysisService().generateUpgradePriorities(
        (delta) => {
          safeSend(win,IPC_CHANNELS.aiAnalysisStreamDelta, { requestId, delta })
        },
      )

      safeSend(win,IPC_CHANNELS.aiAnalysisStreamComplete, { requestId })
      return { text: result.text, requestId }
    } catch (error) {
      console.error('Error in ai:upgradePriorities:', error)
      const formatted = formatError(error)
      if (formatted.rateLimited) return formatted
      throw formatted
    }
  })

  createIpcHandlerWithEvent(IPC_CHANNELS.aiCompletenessInsights, async (event, params: unknown) => {
    try {
      const { requestId } = validateInput(
        z.object({ requestId: z.string().min(1).max(100) }),
        params,
        'ai:completenessInsights',
      )
      const win = BrowserWindow.fromWebContents(event.sender)

      console.log('[IPC ai:completenessInsights] Generating completeness report')
      const result = await getGeminiAnalysisService().generateCompletenessInsights(
        (delta) => {
          safeSend(win,IPC_CHANNELS.aiAnalysisStreamDelta, { requestId, delta })
        },
      )

      safeSend(win,IPC_CHANNELS.aiAnalysisStreamComplete, { requestId })
      return { text: result.text, requestId }
    } catch (error) {
      console.error('Error in ai:completenessInsights:', error)
      const formatted = formatError(error)
      if (formatted.rateLimited) return formatted
      throw formatted
    }
  })

  createIpcHandlerWithEvent(IPC_CHANNELS.aiWishlistAdvice, async (event, params: unknown) => {
    try {
      const { requestId } = validateInput(
        z.object({ requestId: z.string().min(1).max(100) }),
        params,
        'ai:wishlistAdvice',
      )
      const win = BrowserWindow.fromWebContents(event.sender)

      console.log('[IPC ai:wishlistAdvice] Generating wishlist advice report')
      const result = await getGeminiAnalysisService().generateWishlistAdvice(
        (delta) => {
          safeSend(win,IPC_CHANNELS.aiAnalysisStreamDelta, { requestId, delta })
        },
      )

      safeSend(win,IPC_CHANNELS.aiAnalysisStreamComplete, { requestId })
      return { text: result.text, requestId }
    } catch (error) {
      console.error('Error in ai:wishlistAdvice:', error)
      const formatted = formatError(error)
      if (formatted.rateLimited) return formatted
      throw formatted
    }
  })

  createIpcHandlerWithEvent(IPC_CHANNELS.aiStorageOptimization, async (event, params: unknown) => {
    try {
      const { requestId } = validateInput(
        z.object({ requestId: z.string().min(1).max(100) }),
        params,
        'ai:storageOptimization',
      )
      const win = BrowserWindow.fromWebContents(event.sender)

      console.log('[IPC ai:storageOptimization] Generating storage optimization report')
      const result = await getGeminiAnalysisService().generateStorageOptimization(
        (delta) => {
          safeSend(win,IPC_CHANNELS.aiAnalysisStreamDelta, { requestId, delta })
        },
      )

      safeSend(win,IPC_CHANNELS.aiAnalysisStreamComplete, { requestId })
      return { text: result.text, requestId }
    } catch (error) {
      console.error('Error in ai:storageOptimization:', error)
      const formatted = formatError(error)
      if (formatted.rateLimited) return formatted
      throw formatted
    }
  })

  createIpcHandlerWithEvent(IPC_CHANNELS.aiMusicQualityReport, async (event, params: unknown) => {
    try {
      const { requestId } = validateInput(
        z.object({ requestId: z.string().min(1).max(100) }),
        params,
        'ai:musicQualityReport',
      )
      const win = BrowserWindow.fromWebContents(event.sender)

      console.log('[IPC ai:musicQualityReport] Generating music quality report')
      const result = await getGeminiAnalysisService().generateMusicQualityReport(
        (delta) => {
          safeSend(win,IPC_CHANNELS.aiAnalysisStreamDelta, { requestId, delta })
        },
      )

      safeSend(win,IPC_CHANNELS.aiAnalysisStreamComplete, { requestId })
      return { text: result.text, requestId }
    } catch (error) {
      console.error('Error in ai:musicQualityReport:', error)
      const formatted = formatError(error)
      if (formatted.rateLimited) return formatted
      throw formatted
    }
  })

  createIpcHandler(IPC_CHANNELS.aiExplainQuality, async (params: unknown) => {
    try {
      const validated = validateInput(
        z.object({
          title: z.string().min(1).max(500),
          resolution: z.string().optional(),
          videoCodec: z.string().optional(),
          videoBitrate: z.number().optional(),
          audioCodec: z.string().optional(),
          audioChannels: z.number().optional(),
          hdrFormat: z.string().optional(),
          qualityTier: z.string().optional(),
          tierQuality: z.string().optional(),
          tierScore: z.number().optional(),
        }),
        params,
        'ai:explainQuality',
      )
      const explanation = await getGeminiService().explainQualityScore(validated)
      return { text: explanation }
    } catch (error) {
      console.error('Error in ai:explainQuality:', error)
      const formatted = formatError(error)
      if (formatted.rateLimited) return formatted
      throw formatted
    }
  })
}
