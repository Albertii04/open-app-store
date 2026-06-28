import type { ChatEvent } from '../../shared/types.js'

// Re-export renderer-safe DTOs from the shared package (single source of truth).
export type { ProviderId, ProviderConfig, AiSettings } from '../../shared/ai-types.js'
import type { ProviderId, AiSettings } from '../../shared/ai-types.js'

export interface AgentRunOptions {
  cwd: string
  message: string
  readDirs: string[]
  allowEdits: boolean
  model?: string
  resumeSessionId?: string | null
}

export interface AgentHandle {
  stop(): void
}

export interface ProviderAdapter {
  id: ProviderId
  label: string
  binaryNames: string[]
  supportsExternalReadDirs: boolean
  versionArgs: string[]
  run(bin: string, opts: AgentRunOptions, emit: (e: ChatEvent) => void): AgentHandle
}

export const DEFAULT_AI_SETTINGS: AiSettings = {
  active: 'claude',
  providers: { claude: {}, codex: {}, opencode: {} },
}
