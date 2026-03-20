import { ipcRenderer } from 'electron'

export const aiApi = {
  // ============================================================================
  // AI (GEMINI)
  // ============================================================================
  aiIsConfigured: () => ipcRenderer.invoke('ai:isConfigured'),
  aiGetRateLimitInfo: () => ipcRenderer.invoke('ai:getRateLimitInfo'),
  aiTestApiKey: (apiKey: string) => ipcRenderer.invoke('ai:testApiKey', apiKey),
  aiSendMessage: (params: {
    messages: Array<{ role: 'user' | 'assistant'; content: string }>
    system?: string
    maxTokens?: number
  }) => ipcRenderer.invoke('ai:sendMessage', params),
  aiStreamMessage: (params: {
    messages: Array<{ role: 'user' | 'assistant'; content: string }>
    system?: string
    maxTokens?: number
    requestId: string
  }) => ipcRenderer.invoke('ai:streamMessage', params),
  onAiStreamDelta: (callback: (data: { requestId: string; delta: string }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: { requestId: string; delta: string }) => callback(data)
    ipcRenderer.on('ai:streamDelta', handler)
    return () => ipcRenderer.removeListener('ai:streamDelta', handler)
  },
  onAiStreamComplete: (callback: (data: { requestId: string; usage?: { input_tokens: number; output_tokens: number } }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: { requestId: string; usage?: { input_tokens: number; output_tokens: number } }) => callback(data)
    ipcRenderer.on('ai:streamComplete', handler)
    return () => ipcRenderer.removeListener('ai:streamComplete', handler)
  },
  aiChatMessage: (params: {
    messages: Array<{ role: 'user' | 'assistant'; content: string }>
    requestId: string
    viewContext?: {
      currentView: 'dashboard' | 'library'
      libraryTab?: 'movies' | 'tv' | 'music'
      selectedItem?: { title: string; type?: string; id?: number }
      activeSourceId?: string
      activeFilters?: string
    }
  }) => ipcRenderer.invoke('ai:chatMessage', params),
  onAiToolUse: (callback: (data: { requestId: string; toolName: string; input: Record<string, unknown> }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: { requestId: string; toolName: string; input: Record<string, unknown> }) => callback(data)
    ipcRenderer.on('ai:toolUse', handler)
    return () => ipcRenderer.removeListener('ai:toolUse', handler)
  },
  onAiChatStreamDelta: (callback: (data: { requestId: string; delta: string }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: { requestId: string; delta: string }) => callback(data)
    ipcRenderer.on('ai:chatStreamDelta', handler)
    return () => ipcRenderer.removeListener('ai:chatStreamDelta', handler)
  },
  onAiChatStreamComplete: (callback: (data: { requestId: string }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: { requestId: string }) => callback(data)
    ipcRenderer.on('ai:chatStreamComplete', handler)
    return () => ipcRenderer.removeListener('ai:chatStreamComplete', handler)
  },

  // AI Analysis Reports
  aiQualityReport: (params: { requestId: string }) =>
    ipcRenderer.invoke('ai:qualityReport', params),
  aiUpgradePriorities: (params: { requestId: string }) =>
    ipcRenderer.invoke('ai:upgradePriorities', params),
  aiCompletenessInsights: (params: { requestId: string }) =>
    ipcRenderer.invoke('ai:completenessInsights', params),
  onAiAnalysisStreamDelta: (callback: (data: { requestId: string; delta: string }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: { requestId: string; delta: string }) => callback(data)
    ipcRenderer.on('ai:analysisStreamDelta', handler)
    return () => ipcRenderer.removeListener('ai:analysisStreamDelta', handler)
  },
  onAiAnalysisStreamComplete: (callback: (data: { requestId: string }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: { requestId: string }) => callback(data)
    ipcRenderer.on('ai:analysisStreamComplete', handler)
    return () => ipcRenderer.removeListener('ai:analysisStreamComplete', handler)
  },
  aiWishlistAdvice: (params: { requestId: string }) =>
    ipcRenderer.invoke('ai:wishlistAdvice', params),
  aiExplainQuality: (params: {
    title: string
    resolution?: string
    videoCodec?: string
    videoBitrate?: number
    audioCodec?: string
    audioChannels?: number
    hdrFormat?: string
    qualityTier?: string
    tierQuality?: string
    tierScore?: number
  }) => ipcRenderer.invoke('ai:explainQuality', params),
}

export interface AiAPI {
  // ============================================================================
  // AI (GEMINI)
  // ============================================================================
  aiIsConfigured: () => Promise<boolean>
  aiGetRateLimitInfo: () => Promise<{ limited: boolean; retryAfterSeconds: number }>
  aiTestApiKey: (apiKey: string) => Promise<{ success: boolean; error?: string }>
  aiSendMessage: (params: {
    messages: Array<{ role: 'user' | 'assistant'; content: string }>
    system?: string
    maxTokens?: number
  }) => Promise<{ text: string; usage: { input_tokens: number; output_tokens: number } }>
  aiStreamMessage: (params: {
    messages: Array<{ role: 'user' | 'assistant'; content: string }>
    system?: string
    maxTokens?: number
    requestId: string
  }) => Promise<{ text: string; usage: { input_tokens: number; output_tokens: number } }>
  onAiStreamDelta: (callback: (data: { requestId: string; delta: string }) => void) => () => void
  onAiStreamComplete: (callback: (data: { requestId: string; usage?: { input_tokens: number; output_tokens: number } }) => void) => () => void
  aiChatMessage: (params: {
    messages: Array<{ role: 'user' | 'assistant'; content: string }>
    requestId: string
    viewContext?: {
      currentView: 'dashboard' | 'library'
      libraryTab?: 'movies' | 'tv' | 'music'
      selectedItem?: { title: string; type?: string; id?: number }
      activeSourceId?: string
      activeFilters?: string
    }
  }) => Promise<{ text: string; usage: { input_tokens: number; output_tokens: number }; requestId: string; actionableItems?: Array<{ title: string; year?: number; tmdb_id?: string; media_type: 'movie' | 'tv' }>; rateLimited?: boolean; retryAfterSeconds?: number }>
  onAiToolUse: (callback: (data: { requestId: string; toolName: string; input: Record<string, unknown> }) => void) => () => void
  onAiChatStreamDelta: (callback: (data: { requestId: string; delta: string }) => void) => () => void
  onAiChatStreamComplete: (callback: (data: { requestId: string }) => void) => () => void
  
  // AI Analysis Reports
  aiQualityReport: (params: { requestId: string }) => Promise<{ text: string; requestId: string }>
  aiUpgradePriorities: (params: { requestId: string }) => Promise<{ text: string; requestId: string }>
  aiCompletenessInsights: (params: { requestId: string }) => Promise<{ text: string; requestId: string }>
  onAiAnalysisStreamDelta: (callback: (data: { requestId: string; delta: string }) => void) => () => void
  onAiAnalysisStreamComplete: (callback: (data: { requestId: string }) => void) => () => void
  aiWishlistAdvice: (params: { requestId: string }) => Promise<{ text: string; requestId: string }>
  aiExplainQuality: (params: {
    title: string
    resolution?: string
    videoCodec?: string
    videoBitrate?: number
    audioCodec?: string
    audioChannels?: number
    hdrFormat?: string
    qualityTier?: string
    tierQuality?: string
    tierScore?: number
  }) => Promise<{ text: string }>
}
