import type { ChatEvent } from '../../shared/types.js'

export type ProviderId = 'claude' | 'codex' | 'opencode'

export interface ProviderConfig {
  binPath?: string // empty → auto-detect
  model?: string
}

export interface AiSettings {
  active: ProviderId
  providers: Record<ProviderId, ProviderConfig>
}

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
