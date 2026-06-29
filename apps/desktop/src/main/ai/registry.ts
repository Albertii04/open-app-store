import type { ProviderAdapter, ProviderId } from './types.js'
import { claudeAdapter } from './adapters/claude.js'
import { codexAdapter } from './adapters/codex.js'
import { opencodeAdapter } from './adapters/opencode.js'

export const ADAPTERS: Record<ProviderId, ProviderAdapter> = {
  claude: claudeAdapter,
  codex: codexAdapter,
  opencode: opencodeAdapter,
}

export function getAdapter(id: ProviderId): ProviderAdapter {
  return ADAPTERS[id]
}
