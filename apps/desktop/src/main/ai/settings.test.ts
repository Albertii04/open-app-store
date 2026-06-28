import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = mkdtempSync(join(tmpdir(), 'oas-settings-'))
vi.mock('electron', () => ({ app: { getPath: () => dir } }))

import { getAiSettings, setAiSettings, _resetCache } from './settings.js'

beforeEach(() => _resetCache())

describe('ai settings', () => {
  it('returns defaults with no file', () => {
    expect(getAiSettings().active).toBe('claude')
  })
  it('persists a patch', () => {
    setAiSettings({ active: 'codex' })
    _resetCache()
    expect(getAiSettings().active).toBe('codex')
  })
  it('deep-merges provider config', () => {
    setAiSettings({ providers: { codex: { binPath: '/x/codex' } } })
    expect(getAiSettings().providers.codex.binPath).toBe('/x/codex')
    expect(getAiSettings().providers.claude).toBeDefined()
  })
})
