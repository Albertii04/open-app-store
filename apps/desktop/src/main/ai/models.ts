import { execFileSync } from 'node:child_process'
import { detectBinary } from './detect.js'
import type { ProviderId } from '../../shared/ai-types.js'

/** Curated model lists for providers that can't enumerate their own models.
 *  claude accepts aliases; codex has no list command (best-effort set). */
export const KNOWN_MODELS: Record<ProviderId, string[]> = {
  claude: ['opus', 'sonnet', 'haiku'],
  codex: ['gpt-5-codex', 'gpt-5', 'o3', 'o4-mini'],
  opencode: [],
}

/** List selectable models for a provider. opencode is queried live via
 *  `opencode models`; the others return their curated set. Always best-effort
 *  (returns [] on failure) — the UI adds a "default/auto" entry itself. */
export async function listModels(provider: ProviderId, binPath?: string): Promise<string[]> {
  if (provider === 'opencode') {
    const bin = detectBinary(['opencode'], binPath)
    if (!bin) return []
    try {
      const out = execFileSync(bin, ['models'], { encoding: 'utf8', timeout: 8000 })
      return out
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith('#'))
    } catch {
      return []
    }
  }
  return KNOWN_MODELS[provider] ?? []
}
