import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { getGeminiService, resetGeminiServiceForTesting } from '@main/services/GeminiService'
import { cleanupTestDb } from '@tests/TestUtils'

describe('GeminiService', () => {
  beforeEach(async () => {
    resetGeminiServiceForTesting()
    vi.clearAllMocks()
  })

  afterEach(() => {
    cleanupTestDb()
  })

  it('should detect tool-use loops when the same tool calls are repeated 3 times', async () => {
    const service = getGeminiService()

    const generateContentMock = vi.fn()

    // Create a spy/mock on the client
    const hooks = service as unknown as {
      getClient: () => { models: { generateContent: typeof generateContentMock } }
      isConfigured: () => boolean
      checkRateLimit: () => void
    }
    vi.spyOn(hooks, 'getClient').mockReturnValue({
      models: {
        generateContent: generateContentMock
      }
    })

    vi.spyOn(hooks, 'isConfigured').mockReturnValue(true)
    vi.spyOn(hooks, 'checkRateLimit').mockImplementation(() => {})

    // Setup mock responses to create a loop
    generateContentMock.mockResolvedValue({
      functionCalls: [{ name: 'test_tool', args: { foo: 'bar' } }],
      usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 10 }
    })

    const executeTool = vi.fn().mockResolvedValue('success')

    const result = await service.sendMessageWithTools({
      messages: [{ role: 'user', content: 'hello' }],
      tools: [{ name: 'test_tool', description: 'test', parameters: { type: 'object' } }],
      executeTool
    })

    expect(result.text).toContain('I encountered an issue processing your request. Please try rephrasing your question.')
    expect(generateContentMock).toHaveBeenCalledTimes(3)

    // Check that we called executeTool 2 times.
    // The third generation detects the loop and breaks *before* executing the tool.
    expect(executeTool).toHaveBeenCalledTimes(2)
  })

  it('should NOT detect tool-use loops if tool calls are different', async () => {
    const service = getGeminiService()

    const generateContentMock = vi.fn()

    const hooks = service as unknown as {
      getClient: () => { models: { generateContent: typeof generateContentMock } }
      isConfigured: () => boolean
      checkRateLimit: () => void
    }
    vi.spyOn(hooks, 'getClient').mockReturnValue({
      models: {
        generateContent: generateContentMock
      }
    })

    vi.spyOn(hooks, 'isConfigured').mockReturnValue(true)
    vi.spyOn(hooks, 'checkRateLimit').mockImplementation(() => {})

    // Setup mock responses to create a non-looping sequence
    generateContentMock
      .mockResolvedValueOnce({
        functionCalls: [{ name: 'test_tool', args: { foo: 'bar1' } }],
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 10 }
      })
      .mockResolvedValueOnce({
        functionCalls: [{ name: 'test_tool', args: { foo: 'bar2' } }],
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 10 }
      })
      .mockResolvedValueOnce({
        functionCalls: [{ name: 'test_tool', args: { foo: 'bar3' } }],
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 10 }
      })
      .mockResolvedValueOnce({
        text: 'Final response',
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 10 }
      })

    const executeTool = vi.fn().mockResolvedValue('success')

    const result = await service.sendMessageWithTools({
      messages: [{ role: 'user', content: 'hello' }],
      tools: [{ name: 'test_tool', description: 'test', parameters: { type: 'object' } }],
      executeTool
    })

    expect(result.text).toBe('Final response')
    expect(generateContentMock).toHaveBeenCalledTimes(4)
    expect(executeTool).toHaveBeenCalledTimes(3)
  })
})
