export type ProviderId = 'claude' | 'codex' | 'opencode'

export interface ProviderConfig {
  binPath?: string
  model?: string
}

export interface AiSettings {
  active: ProviderId
  providers: Record<ProviderId, ProviderConfig>
}

export interface AiSettingsPatch {
  active?: ProviderId
  providers?: Partial<Record<ProviderId, Partial<ProviderConfig>>>
}

export interface AiTestResult {
  ok: boolean
  version?: string
  error?: string
}

export const PROVIDER_LABELS: Record<ProviderId, string> = {
  claude: 'Claude Code',
  codex: 'OpenAI Codex',
  opencode: 'opencode',
}
