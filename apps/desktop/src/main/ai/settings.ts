import { app } from 'electron'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { DEFAULT_AI_SETTINGS, type AiSettings, type ProviderId, type ProviderConfig } from './types.js'

function file(): string {
  return join(app.getPath('userData'), 'settings.json')
}

let cache: { ai: AiSettings } | null = null

export function _resetCache(): void {
  cache = null
}

function readExisting(): Record<string, unknown> {
  try {
    return JSON.parse(readFileSync(file(), 'utf8'))
  } catch {
    return {}
  }
}

function loadAll(): { ai: AiSettings } {
  if (cache) return cache
  const parsed = readExisting()
  const ai = (parsed.ai as Partial<AiSettings>) ?? {}
  cache = {
    ai: {
      active: ai.active ?? DEFAULT_AI_SETTINGS.active,
      providers: {
        claude: { ...DEFAULT_AI_SETTINGS.providers.claude, ...(ai.providers?.claude ?? {}) },
        codex: { ...DEFAULT_AI_SETTINGS.providers.codex, ...(ai.providers?.codex ?? {}) },
        opencode: { ...DEFAULT_AI_SETTINGS.providers.opencode, ...(ai.providers?.opencode ?? {}) },
      },
    },
  }
  return cache
}

export function getAiSettings(): AiSettings {
  return loadAll().ai
}

export interface AiSettingsPatch {
  active?: ProviderId
  providers?: Partial<Record<ProviderId, Partial<ProviderConfig>>>
}

export function setAiSettings(patch: AiSettingsPatch): AiSettings {
  const cur = getAiSettings()
  const next: AiSettings = {
    active: patch.active ?? cur.active,
    providers: {
      claude: { ...cur.providers.claude, ...(patch.providers?.claude ?? {}) },
      codex: { ...cur.providers.codex, ...(patch.providers?.codex ?? {}) },
      opencode: { ...cur.providers.opencode, ...(patch.providers?.opencode ?? {}) },
    },
  }
  mkdirSync(app.getPath('userData'), { recursive: true })
  writeFileSync(file(), JSON.stringify({ ...readExisting(), ai: next }, null, 2), 'utf8')
  cache = { ai: next }
  return next
}
