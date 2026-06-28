# Shell AI Provider + Packaged Deck Editing — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user pick an AI agent CLI (Claude Code / OpenAI Codex / opencode) in Open App Store settings and edit Presenter decks with that provider automatically — in dev **and** the packaged `.app`.

**Architecture:** A shell-owned AI provider service (`main/ai/`) wraps each CLI behind a `ProviderAdapter` that normalizes its headless JSON output to the existing `ChatEvent`. Settings live in a new `userData/settings.json`. Decks move to `userData/presentations` (writable, outside the signed bundle) and are compiled on demand with esbuild + `@vue/compiler-sfc`, replacing the dev-only Vite server so editing works packaged.

**Tech Stack:** Electron 33, TypeScript, Vue 3, Vite, esbuild, `@vue/compiler-sfc`, Node `child_process`. Spec: `docs/superpowers/specs/2026-06-28-shell-ai-provider-and-packaged-editing-design.md`.

**Testing:** No test runner exists in the repo yet. Task 0 adds **Vitest** to `@openappstore/desktop`. Pure-logic modules (settings, detection, adapter parsing, compiler) are unit-tested; UI + end-to-end are verified manually via the `/run` + `/verify` flow.

**Conventions:**
- Run all commands from repo root `/Users/albertmp/Developer/open-app-store`.
- Desktop tests: `pnpm --filter @openappstore/desktop test`.
- Typecheck after main-process edits: `pnpm --filter @openappstore/desktop exec tsc --noEmit -p tsconfig.node.json`.
- Commit after each task (messages end with the repo's Co-Authored-By trailer).

---

## File Structure

**Phase 1 — provider service (new files under `apps/desktop/src/main/ai/`):**
- `types.ts` — `AgentRunOptions`, `AgentHandle`, `ProviderAdapter`, `AiSettings`, `ProviderId`.
- `settings.ts` — load/save `userData/settings.json` (`ai` key), cached.
- `detect.ts` — resolve a provider binary across PATH + common install dirs.
- `adapters/claude.ts`, `adapters/codex.ts`, `adapters/opencode.ts` — one per CLI.
- `registry.ts` — `ADAPTERS` map + `getAdapter(id)`.
- `run.ts` — `runAgent(...)`: resolve adapter + binary, spawn, normalize errors → `ChatEvent`.

**Phase 1 — touched existing:**
- `apps/desktop/src/main/authoring.ts` — `sendChat` uses `runAgent`; `stopChat`/`chatProc` hold `AgentHandle`.
- `apps/desktop/src/main/index.ts` — register `shell:ai*` IPC.
- `apps/desktop/src/preload/shell.ts` + `apps/desktop/src/shared/types.ts` — `ShellApi` AI methods.
- `apps/desktop/src/renderer/App.vue` + `apps/desktop/src/renderer/components/SettingsModal.vue` (new) — settings UI.

**Phase 2 — packaged editing:**
- `apps/desktop/src/main/paths.ts` + `authoring.ts` — `presentationsDir()` → `userData/presentations`; seed example.
- `apps/desktop/src/main/presenter-build/compileDeck.ts` (new) — runtime deck compiler.
- `apps/desktop/src/main/presenter-build/host-modules.ts` (new) — emit the engine+vue host module map.
- `apps/desktop/src/main/authoring.ts` — `getPreviewUrl()`/preview backed by compiled output; `sendChat` `done` → `compileDeck`.
- `apps/tools/presenter/src/presentations/index.ts` + `main.ts` — load runtime-compiled deck instead of `import.meta.glob`.
- `apps/tools/presenter/src/LivePreview.vue` / `CodeEditor.vue` — reload compiled preview per turn.
- `apps/desktop/electron-builder.yml` — ship `template/`, `blocks/`, engine source needed by the compiler.

---

## Task 0: Add Vitest to desktop package

**Goal:** A working unit-test runner for the desktop main-process modules.

**Files:**
- Modify: `apps/desktop/package.json`
- Create: `apps/desktop/vitest.config.ts`
- Create: `apps/desktop/src/main/ai/__tests__/smoke.test.ts`

**Acceptance Criteria:**
- [ ] `pnpm --filter @openappstore/desktop test` runs Vitest and passes.

**Verify:** `pnpm --filter @openappstore/desktop test` → `1 passed`.

**Steps:**

- [ ] **Step 1: Add dev dep + script**

```bash
pnpm --filter @openappstore/desktop add -D vitest
```

Then add to `apps/desktop/package.json` `"scripts"`:

```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 2: Vitest config** — create `apps/desktop/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
```

- [ ] **Step 3: Smoke test** — create `apps/desktop/src/main/ai/__tests__/smoke.test.ts`:

```ts
import { describe, it, expect } from 'vitest'

describe('vitest', () => {
  it('runs', () => {
    expect(1 + 1).toBe(2)
  })
})
```

- [ ] **Step 4: Run** — `pnpm --filter @openappstore/desktop test` → Expected: `1 passed`.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/package.json apps/desktop/vitest.config.ts apps/desktop/src/main/ai/__tests__/smoke.test.ts pnpm-lock.yaml
git commit -m "test(desktop): add vitest runner"
```

---

## Task 1: AI types + settings store

**Goal:** Typed AI settings persisted to `userData/settings.json`.

**Files:**
- Create: `apps/desktop/src/main/ai/types.ts`
- Create: `apps/desktop/src/main/ai/settings.ts`
- Test: `apps/desktop/src/main/ai/settings.test.ts`

**Acceptance Criteria:**
- [ ] `getAiSettings()` returns defaults when no file exists.
- [ ] `setAiSettings(patch)` merges + persists; next `getAiSettings()` reflects it.
- [ ] Stored under `userData/settings.json` key `ai`.

**Verify:** `pnpm --filter @openappstore/desktop test src/main/ai/settings.test.ts` → all pass.

**Steps:**

- [ ] **Step 1: Types** — create `apps/desktop/src/main/ai/types.ts`:

```ts
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
```

> Note: `ChatEvent` is defined in `apps/desktop/src/shared/types.ts`. Confirm its shape is `{ kind: 'assistant'|'tool'|'done'|'error'; text: string; sessionId?: string }`; if it is not exported, export it (it is already used by `authoring.ts`).

- [ ] **Step 2: Failing test** — create `apps/desktop/src/main/ai/settings.test.ts`:

```ts
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
```

- [ ] **Step 3: Run → FAIL** (`Cannot find module './settings.js'`).

- [ ] **Step 4: Implement** — create `apps/desktop/src/main/ai/settings.ts`:

```ts
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

function loadAll(): { ai: AiSettings } {
  if (cache) return cache
  let parsed: Record<string, unknown> = {}
  try {
    parsed = JSON.parse(readFileSync(file(), 'utf8'))
  } catch {
    parsed = {}
  }
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

function readExisting(): Record<string, unknown> {
  try {
    return JSON.parse(readFileSync(file(), 'utf8'))
  } catch {
    return {}
  }
}
```

- [ ] **Step 5: Run → PASS**.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/main/ai/types.ts apps/desktop/src/main/ai/settings.ts apps/desktop/src/main/ai/settings.test.ts
git commit -m "feat(ai): typed shell AI settings store"
```

---

## Task 2: Binary detection

**Goal:** Resolve a provider's binary from config override → PATH → common install dirs.

**Files:**
- Create: `apps/desktop/src/main/ai/detect.ts`
- Test: `apps/desktop/src/main/ai/detect.test.ts`

**Acceptance Criteria:**
- [ ] Explicit `binPath` that exists wins.
- [ ] Falls back to scanning candidate dirs for any of `binaryNames`.
- [ ] Returns `null` when nothing is found.

**Verify:** `pnpm --filter @openappstore/desktop test src/main/ai/detect.test.ts` → pass.

**Steps:**

- [ ] **Step 1: Failing test** — create `apps/desktop/src/main/ai/detect.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync, chmodSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { detectBinary } from './detect.js'

function fakeBin(name: string): string {
  const d = mkdtempSync(join(tmpdir(), 'oas-bin-'))
  const p = join(d, name)
  writeFileSync(p, '#!/bin/sh\necho x')
  chmodSync(p, 0o755)
  return p
}

describe('detectBinary', () => {
  it('honors an existing override', () => {
    const p = fakeBin('claude')
    expect(detectBinary(['claude'], p, [])).toBe(p)
  })
  it('ignores a non-existent override and scans dirs', () => {
    const p = fakeBin('codex')
    expect(detectBinary(['codex'], '/nope/codex', [p.replace(/\/codex$/, '')])).toBe(p)
  })
  it('returns null when missing', () => {
    expect(detectBinary(['nothere'], undefined, ['/nope'])).toBeNull()
  })
})
```

- [ ] **Step 2: Run → FAIL**.

- [ ] **Step 3: Implement** — create `apps/desktop/src/main/ai/detect.ts`:

```ts
import { existsSync, accessSync, constants } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { execFileSync } from 'node:child_process'

function isExec(p: string): boolean {
  try {
    accessSync(p, constants.X_OK)
    return true
  } catch {
    return false
  }
}

/** Directories an installed agent CLI is commonly found in (macOS/Linux). */
export function candidateDirs(): string[] {
  const dirs = [
    '/opt/homebrew/bin',
    '/usr/local/bin',
    join(homedir(), '.local/bin'),
    join(homedir(), '.codex/bin'),
    join(homedir(), '.opencode/bin'),
  ]
  // PATH entries.
  for (const d of (process.env.PATH ?? '').split(':')) if (d) dirs.push(d)
  // npm global bin.
  try {
    const prefix = execFileSync('npm', ['prefix', '-g'], { encoding: 'utf8' }).trim()
    if (prefix) dirs.push(join(prefix, 'bin'))
  } catch {
    /* npm not present — ignore */
  }
  return [...new Set(dirs)]
}

/**
 * Resolve a provider binary. `override` (user-set absolute path) wins if it
 * exists; otherwise scan `dirs` (defaults to candidateDirs()) for any name.
 */
export function detectBinary(
  binaryNames: string[],
  override?: string,
  dirs: string[] = candidateDirs(),
): string | null {
  if (override && existsSync(override) && isExec(override)) return override
  for (const dir of dirs) {
    for (const name of binaryNames) {
      const p = join(dir, name)
      if (existsSync(p) && isExec(p)) return p
    }
  }
  return null
}
```

- [ ] **Step 4: Run → PASS**.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/main/ai/detect.ts apps/desktop/src/main/ai/detect.test.ts
git commit -m "feat(ai): provider binary detection"
```

---

## Task 3: Claude adapter (lift current logic)

**Goal:** A `ProviderAdapter` that reproduces today's claude behavior behind the new interface.

**Files:**
- Create: `apps/desktop/src/main/ai/adapters/claude.ts`
- Test: `apps/desktop/src/main/ai/adapters/claude.test.ts`

**Acceptance Criteria:**
- [ ] Builds args: `-p --output-format stream-json --verbose`, one `--add-dir` per `readDirs`, `--permission-mode acceptEdits|plan`, `--model` when set, `--resume <id>` when set.
- [ ] Parsing maps `type:assistant`(text/tool_use) → `assistant`/`tool`, `type:result` → `done`/`error` with `sessionId`.
- [ ] `stop()` kills the child.

**Verify:** `pnpm --filter @openappstore/desktop test src/main/ai/adapters/claude.test.ts` → pass.

**Steps:**

- [ ] **Step 1: Failing test** — create `apps/desktop/src/main/ai/adapters/claude.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { buildClaudeArgs, parseClaudeLine } from './claude.js'

describe('claude adapter', () => {
  it('builds edit-mode args with add-dirs + resume', () => {
    const a = buildClaudeArgs(
      { cwd: '/d', message: 'hi', readDirs: ['/a', '/b'], allowEdits: true, model: 'opus', resumeSessionId: 'sess1' },
    )
    expect(a).toContain('-p')
    expect(a).toContain('stream-json')
    expect(a.join(' ')).toContain('--add-dir /a')
    expect(a.join(' ')).toContain('--add-dir /b')
    expect(a.join(' ')).toContain('--permission-mode acceptEdits')
    expect(a.join(' ')).toContain('--model opus')
    expect(a.join(' ')).toContain('--resume sess1')
  })
  it('uses plan mode when edits disabled', () => {
    const a = buildClaudeArgs({ cwd: '/d', message: 'x', readDirs: [], allowEdits: false })
    expect(a.join(' ')).toContain('--permission-mode plan')
  })
  it('parses assistant text + tool_use', () => {
    const evs = parseClaudeLine(
      JSON.stringify({ type: 'assistant', message: { content: [
        { type: 'text', text: 'hello' },
        { type: 'tool_use', name: 'Edit', input: { file_path: '/x/Slide.vue' } },
      ] } }),
    )
    expect(evs[0]).toEqual({ kind: 'assistant', text: 'hello' })
    expect(evs[1]).toEqual({ kind: 'tool', text: 'Edit · Slide.vue' })
  })
  it('parses result → done with sessionId', () => {
    const evs = parseClaudeLine(JSON.stringify({ type: 'result', is_error: false, result: 'ok', session_id: 's9' }))
    expect(evs[0]).toEqual({ kind: 'done', text: 'ok', sessionId: 's9' })
  })
})
```

- [ ] **Step 2: Run → FAIL**.

- [ ] **Step 3: Implement** — create `apps/desktop/src/main/ai/adapters/claude.ts`:

```ts
import { spawn } from 'node:child_process'
import type { AgentRunOptions, AgentHandle, ProviderAdapter } from '../types.js'
import type { ChatEvent } from '../../../shared/types.js'

export function buildClaudeArgs(o: AgentRunOptions): string[] {
  const args = ['-p', '--output-format', 'stream-json', '--verbose']
  for (const d of o.readDirs) args.push('--add-dir', d)
  args.push('--allowedTools', 'Read,Edit,Write,Glob,Grep')
  args.push('--permission-mode', o.allowEdits ? 'acceptEdits' : 'plan')
  if (o.model) args.push('--model', o.model)
  if (o.resumeSessionId) args.push('--resume', o.resumeSessionId)
  args.push(o.message)
  return args
}

export function parseClaudeLine(line: string): ChatEvent[] {
  let msg: Record<string, unknown>
  try {
    msg = JSON.parse(line)
  } catch {
    return []
  }
  const out: ChatEvent[] = []
  if (msg.type === 'assistant') {
    const content = (msg.message as { content?: unknown[] })?.content ?? []
    for (const b of content as Array<Record<string, unknown>>) {
      if (b.type === 'text' && typeof b.text === 'string' && b.text.trim())
        out.push({ kind: 'assistant', text: b.text })
      else if (b.type === 'tool_use') {
        const file = (b.input as { file_path?: string })?.file_path
        out.push({ kind: 'tool', text: `${b.name}${file ? ' · ' + file.split('/').pop() : ''}` })
      }
    }
  } else if (msg.type === 'result') {
    out.push({
      kind: msg.is_error ? 'error' : 'done',
      text: String(msg.result ?? ''),
      sessionId: typeof msg.session_id === 'string' ? msg.session_id : undefined,
    })
  }
  return out
}

export const claudeAdapter: ProviderAdapter = {
  id: 'claude',
  label: 'Claude Code',
  binaryNames: ['claude'],
  supportsExternalReadDirs: true,
  versionArgs: ['--version'],
  run(bin, o, emit): AgentHandle {
    const child = spawn(bin, buildClaudeArgs(o), { cwd: o.cwd, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] })
    let buf = ''
    child.stdout.on('data', (chunk: Buffer) => {
      buf += chunk.toString()
      let nl: number
      while ((nl = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, nl).trim()
        buf = buf.slice(nl + 1)
        if (line) for (const ev of parseClaudeLine(line)) emit(ev)
      }
    })
    child.on('error', (e) => emit({ kind: 'error', text: e.message }))
    child.on('exit', (_code, signal) => {
      if (signal) emit({ kind: 'error', text: 'Detenido.' })
    })
    return { stop: () => child.kill() }
  },
}
```

- [ ] **Step 4: Run → PASS**. Then `pnpm --filter @openappstore/desktop exec tsc --noEmit -p tsconfig.node.json`.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/main/ai/adapters/claude.ts apps/desktop/src/main/ai/adapters/claude.test.ts
git commit -m "feat(ai): claude provider adapter"
```

---

## Task 4: Codex adapter

**Goal:** Drive `codex exec --json`, normalize JSONL events to `ChatEvent`.

**Files:**
- Create: `apps/desktop/src/main/ai/adapters/codex.ts`
- Test: `apps/desktop/src/main/ai/adapters/codex.test.ts`

**Acceptance Criteria:**
- [ ] Args: `exec --json --cd <cwd> --sandbox workspace-write|read-only --ask-for-approval never`, `--model` when set; resume form `exec resume <id> --json …`.
- [ ] Parse: `thread.started`→ capture session id (emitted on `done`); `item.completed`(agent_message→assistant, command_execution/file_change→tool); `turn.completed`→done; `error`/`turn.failed`→error.

**Verify:** `pnpm --filter @openappstore/desktop test src/main/ai/adapters/codex.test.ts` → pass.

> The exact field names of Codex's `--json` items are lightly documented. The parser below targets the documented shapes; during implementation, run `codex exec --json "hi"` once in a scratch dir and adjust field access in `parseCodexLine` to the observed payload. Keep the test fixtures in sync with what you observe.

**Steps:**

- [ ] **Step 1: Failing test** — create `apps/desktop/src/main/ai/adapters/codex.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { buildCodexArgs, makeCodexParser } from './codex.js'

describe('codex adapter', () => {
  it('builds edit args', () => {
    const a = buildCodexArgs({ cwd: '/d', message: 'hi', readDirs: [], allowEdits: true, model: 'gpt-5' })
    expect(a.slice(0, 2)).toEqual(['exec', '--json'])
    expect(a.join(' ')).toContain('--cd /d')
    expect(a.join(' ')).toContain('--sandbox workspace-write')
    expect(a.join(' ')).toContain('--ask-for-approval never')
    expect(a.join(' ')).toContain('--model gpt-5')
    expect(a[a.length - 1]).toBe('hi')
  })
  it('builds read-only + resume args', () => {
    const a = buildCodexArgs({ cwd: '/d', message: 'x', readDirs: [], allowEdits: false, resumeSessionId: 'T1' })
    expect(a.join(' ')).toContain('--sandbox read-only')
    expect(a.join(' ')).toContain('resume T1')
  })
  it('parses a stream into events with session id on done', () => {
    const p = makeCodexParser()
    expect(p(JSON.stringify({ type: 'thread.started', thread_id: 'T7' }))).toEqual([])
    expect(p(JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'hi' } })))
      .toEqual([{ kind: 'assistant', text: 'hi' }])
    expect(p(JSON.stringify({ type: 'item.completed', item: { type: 'file_change', path: '/x/A.vue' } })))
      .toEqual([{ kind: 'tool', text: 'edit · A.vue' }])
    expect(p(JSON.stringify({ type: 'turn.completed' })))
      .toEqual([{ kind: 'done', text: '', sessionId: 'T7' }])
  })
})
```

- [ ] **Step 2: Run → FAIL**.

- [ ] **Step 3: Implement** — create `apps/desktop/src/main/ai/adapters/codex.ts`:

```ts
import { spawn } from 'node:child_process'
import type { AgentRunOptions, AgentHandle, ProviderAdapter } from '../types.js'
import type { ChatEvent } from '../../../shared/types.js'

export function buildCodexArgs(o: AgentRunOptions): string[] {
  const args = ['exec', '--json']
  if (o.resumeSessionId) args.push('resume', o.resumeSessionId)
  args.push('--cd', o.cwd)
  args.push('--sandbox', o.allowEdits ? 'workspace-write' : 'read-only')
  args.push('--ask-for-approval', 'never')
  args.push('--skip-git-repo-check')
  if (o.model) args.push('--model', o.model)
  args.push(o.message)
  return args
}

/** Stateful parser: remembers the session id from thread.started to attach on done. */
export function makeCodexParser(): (line: string) => ChatEvent[] {
  let sessionId: string | undefined
  return (line: string): ChatEvent[] => {
    let msg: Record<string, unknown>
    try {
      msg = JSON.parse(line)
    } catch {
      return []
    }
    const t = msg.type
    if (t === 'thread.started') {
      sessionId = (msg.thread_id as string) ?? (msg.session_id as string)
      return []
    }
    if (t === 'item.completed') {
      const item = (msg.item as Record<string, unknown>) ?? {}
      if (item.type === 'agent_message' && typeof item.text === 'string')
        return [{ kind: 'assistant', text: item.text }]
      if (item.type === 'file_change' || item.type === 'command_execution') {
        const path = (item.path as string) ?? (item.command as string) ?? ''
        const label = item.type === 'file_change' ? 'edit' : 'run'
        return [{ kind: 'tool', text: `${label}${path ? ' · ' + String(path).split('/').pop() : ''}` }]
      }
      return []
    }
    if (t === 'turn.completed') return [{ kind: 'done', text: '', sessionId }]
    if (t === 'error' || t === 'turn.failed')
      return [{ kind: 'error', text: String((msg.message as string) ?? 'Codex error') }]
    return []
  }
}

export const codexAdapter: ProviderAdapter = {
  id: 'codex',
  label: 'OpenAI Codex',
  binaryNames: ['codex'],
  supportsExternalReadDirs: false,
  versionArgs: ['--version'],
  run(bin, o, emit): AgentHandle {
    const child = spawn(bin, buildCodexArgs(o), { cwd: o.cwd, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] })
    const parse = makeCodexParser()
    let buf = ''
    child.stdout.on('data', (chunk: Buffer) => {
      buf += chunk.toString()
      let nl: number
      while ((nl = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, nl).trim()
        buf = buf.slice(nl + 1)
        if (line) for (const ev of parse(line)) emit(ev)
      }
    })
    child.on('error', (e) => emit({ kind: 'error', text: e.message }))
    child.on('exit', (_c, signal) => {
      if (signal) emit({ kind: 'error', text: 'Detenido.' })
    })
    return { stop: () => child.kill() }
  },
}
```

- [ ] **Step 4: Run → PASS**. Typecheck.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/main/ai/adapters/codex.ts apps/desktop/src/main/ai/adapters/codex.test.ts
git commit -m "feat(ai): codex provider adapter"
```

---

## Task 5: opencode adapter

**Goal:** Drive `opencode run --format json`, normalize to `ChatEvent`.

**Files:**
- Create: `apps/desktop/src/main/ai/adapters/opencode.ts`
- Test: `apps/desktop/src/main/ai/adapters/opencode.test.ts`

**Acceptance Criteria:**
- [ ] Args: `run --format json --dir <cwd>`, `--model` when set, `--session <id>` when set, message last.
- [ ] Read-only writes a temp `opencode.json` in cwd with `permission.edit/bash/webfetch/websearch = deny` (cleaned up by caller; documented).
- [ ] Parse: `message.part.updated`(text→assistant, tool→tool), `session.idle`→done, errors→error; capture session id from `session.updated`/`session.created`.

**Verify:** `pnpm --filter @openappstore/desktop test src/main/ai/adapters/opencode.test.ts` → pass.

> opencode's `run --format json` event schema is generated from its OpenAPI spec and not documented in prose. Run `opencode run --format json "hi" --dir /tmp/x` once and align `makeOpencodeParser` field access to the observed events. Update fixtures accordingly.

**Steps:**

- [ ] **Step 1: Failing test** — create `apps/desktop/src/main/ai/adapters/opencode.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { buildOpencodeArgs, makeOpencodeParser } from './opencode.js'

describe('opencode adapter', () => {
  it('builds args', () => {
    const a = buildOpencodeArgs({ cwd: '/d', message: 'hi', readDirs: [], allowEdits: true, model: 'anthropic/x', resumeSessionId: 'ses_1' })
    expect(a.slice(0, 2)).toEqual(['run', '--format'])
    expect(a.join(' ')).toContain('--dir /d')
    expect(a.join(' ')).toContain('--model anthropic/x')
    expect(a.join(' ')).toContain('--session ses_1')
    expect(a[a.length - 1]).toBe('hi')
  })
  it('parses events', () => {
    const p = makeOpencodeParser()
    expect(p(JSON.stringify({ type: 'session.updated', properties: { info: { id: 'ses_9' } } }))).toEqual([])
    expect(p(JSON.stringify({ type: 'message.part.updated', properties: { part: { type: 'text', text: 'hi' } } })))
      .toEqual([{ kind: 'assistant', text: 'hi' }])
    expect(p(JSON.stringify({ type: 'session.idle' }))).toEqual([{ kind: 'done', text: '', sessionId: 'ses_9' }])
  })
})
```

- [ ] **Step 2: Run → FAIL**.

- [ ] **Step 3: Implement** — create `apps/desktop/src/main/ai/adapters/opencode.ts`:

```ts
import { spawn } from 'node:child_process'
import { writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import type { AgentRunOptions, AgentHandle, ProviderAdapter } from '../types.js'
import type { ChatEvent } from '../../../shared/types.js'

export function buildOpencodeArgs(o: AgentRunOptions): string[] {
  const args = ['run', '--format', 'json', '--dir', o.cwd]
  if (o.model) args.push('--model', o.model)
  if (o.resumeSessionId) args.push('--session', o.resumeSessionId)
  args.push(o.message)
  return args
}

const READONLY_CONFIG = {
  permission: { edit: 'deny', bash: 'deny', webfetch: 'deny', websearch: 'deny' },
}

export function makeOpencodeParser(): (line: string) => ChatEvent[] {
  let sessionId: string | undefined
  return (line: string): ChatEvent[] => {
    let msg: Record<string, unknown>
    try {
      msg = JSON.parse(line)
    } catch {
      return []
    }
    const props = (msg.properties as Record<string, unknown>) ?? {}
    switch (msg.type) {
      case 'session.created':
      case 'session.updated': {
        const info = (props.info as { id?: string }) ?? {}
        if (info.id) sessionId = info.id
        return []
      }
      case 'message.part.updated': {
        const part = (props.part as Record<string, unknown>) ?? {}
        if (part.type === 'text' && typeof part.text === 'string' && part.text.trim())
          return [{ kind: 'assistant', text: part.text }]
        if (part.type === 'tool') {
          const name = (part.tool as string) ?? 'tool'
          return [{ kind: 'tool', text: String(name) }]
        }
        return []
      }
      case 'session.idle':
        return [{ kind: 'done', text: '', sessionId }]
      case 'session.error':
        return [{ kind: 'error', text: String((props.error as string) ?? 'opencode error') }]
      default:
        return []
    }
  }
}

export const opencodeAdapter: ProviderAdapter = {
  id: 'opencode',
  label: 'opencode',
  binaryNames: ['opencode'],
  supportsExternalReadDirs: false,
  versionArgs: ['--version'],
  run(bin, o, emit): AgentHandle {
    let cfgPath: string | null = null
    if (!o.allowEdits) {
      cfgPath = join(o.cwd, 'opencode.json')
      try {
        writeFileSync(cfgPath, JSON.stringify(READONLY_CONFIG), 'utf8')
      } catch {
        cfgPath = null
      }
    }
    const cleanup = (): void => {
      if (cfgPath) {
        try {
          rmSync(cfgPath)
        } catch {
          /* ignore */
        }
      }
    }
    const child = spawn(bin, buildOpencodeArgs(o), { cwd: o.cwd, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] })
    const parse = makeOpencodeParser()
    let buf = ''
    child.stdout.on('data', (chunk: Buffer) => {
      buf += chunk.toString()
      let nl: number
      while ((nl = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, nl).trim()
        buf = buf.slice(nl + 1)
        if (line) for (const ev of parse(line)) emit(ev)
      }
    })
    child.on('error', (e) => emit({ kind: 'error', text: e.message }))
    child.on('exit', (_c, signal) => {
      cleanup()
      if (signal) emit({ kind: 'error', text: 'Detenido.' })
    })
    return { stop: () => child.kill() }
  },
}
```

- [ ] **Step 4: Run → PASS**. Typecheck.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/main/ai/adapters/opencode.ts apps/desktop/src/main/ai/adapters/opencode.test.ts
git commit -m "feat(ai): opencode provider adapter"
```

---

## Task 6: Registry + runAgent orchestration

**Goal:** One entry point that resolves the active adapter+binary and runs a turn, with friendly errors.

**Files:**
- Create: `apps/desktop/src/main/ai/registry.ts`
- Create: `apps/desktop/src/main/ai/run.ts`
- Test: `apps/desktop/src/main/ai/run.test.ts`

**Acceptance Criteria:**
- [ ] `getAdapter(id)` returns the right adapter.
- [ ] `runAgent(id, opts, emit)` emits a friendly `error` (not raw ENOENT) when the binary is unresolved, and returns a no-op handle.
- [ ] When resolved, it calls the adapter's `run` with the resolved binary.

**Verify:** `pnpm --filter @openappstore/desktop test src/main/ai/run.test.ts` → pass.

**Steps:**

- [ ] **Step 1: Registry** — create `apps/desktop/src/main/ai/registry.ts`:

```ts
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
```

- [ ] **Step 2: Failing test** — create `apps/desktop/src/main/ai/run.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
vi.mock('electron', () => ({ app: { getPath: () => '/nonexistent-userdata' } }))
import { runAgent } from './run.js'
import type { ChatEvent } from '../../shared/types.js'

describe('runAgent', () => {
  it('emits a friendly error when the binary is missing', () => {
    const events: ChatEvent[] = []
    const handle = runAgent(
      'codex',
      { cwd: '/tmp', message: 'x', readDirs: [], allowEdits: true },
      '/definitely/not/here', // forced unresolved binary
      (e) => events.push(e),
    )
    expect(events[0].kind).toBe('error')
    expect(events[0].text).toMatch(/Codex|no encontrado|not found/i)
    handle.stop() // no-op, must not throw
  })
})
```

- [ ] **Step 3: Run → FAIL**.

- [ ] **Step 4: Implement** — create `apps/desktop/src/main/ai/run.ts`:

```ts
import { getAdapter } from './registry.js'
import { detectBinary } from './detect.js'
import type { AgentRunOptions, AgentHandle, ProviderId } from './types.js'
import type { ChatEvent } from '../../shared/types.js'

/**
 * Resolve the provider binary and run one turn. `overrideBin` (from settings or
 * a test) takes precedence over auto-detection. Emits a friendly error and
 * returns a no-op handle when no binary can be resolved.
 */
export function runAgent(
  id: ProviderId,
  opts: AgentRunOptions,
  overrideBin: string | undefined,
  emit: (e: ChatEvent) => void,
): AgentHandle {
  const adapter = getAdapter(id)
  const bin = detectBinary(adapter.binaryNames, overrideBin)
  if (!bin) {
    emit({
      kind: 'error',
      text: `${adapter.label} no encontrado. Instálalo o indica su ruta en Ajustes › IA.`,
    })
    return { stop: () => {} }
  }
  return adapter.run(bin, opts, emit)
}
```

- [ ] **Step 5: Run → PASS**. Typecheck.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/main/ai/registry.ts apps/desktop/src/main/ai/run.ts apps/desktop/src/main/ai/run.test.ts
git commit -m "feat(ai): provider registry + runAgent orchestration"
```

---

## Task 7: Shell IPC + preload + ShellApi types for AI settings

**Goal:** Expose AI settings get/set/detect/test to the shell renderer.

**Files:**
- Modify: `apps/desktop/src/main/index.ts` (register handlers near the other `shell:*`, ~line 92)
- Modify: `apps/desktop/src/preload/shell.ts`
- Modify: `apps/desktop/src/shared/types.ts` (extend `ShellApi`)

**Acceptance Criteria:**
- [ ] `window.shellApi.aiGet()/aiSet()/aiDetect()/aiTest()` callable from the renderer.
- [ ] `aiTest` runs `<bin> <versionArgs>` and returns `{ ok, version }` or `{ ok:false, error }`.
- [ ] Typecheck passes.

**Verify:** `pnpm --filter @openappstore/desktop exec tsc --noEmit -p tsconfig.node.json && pnpm --filter @openappstore/desktop exec vue-tsc --noEmit -p tsconfig.web.json`

**Steps:**

- [ ] **Step 1: Shared types** — in `apps/desktop/src/shared/types.ts`, add to the `ShellApi` interface:

```ts
  // AI provider settings
  aiGet(): Promise<import('./ai-types').AiSettingsDTO>
  aiSet(patch: import('./ai-types').AiSettingsPatchDTO): Promise<import('./ai-types').AiSettingsDTO>
  aiDetect(provider: string): Promise<string | null>
  aiTest(provider: string): Promise<{ ok: boolean; version?: string; error?: string }>
```

Create `apps/desktop/src/shared/ai-types.ts` (renderer-safe DTOs, no electron import):

```ts
export type ProviderId = 'claude' | 'codex' | 'opencode'
export interface ProviderConfigDTO {
  binPath?: string
  model?: string
}
export interface AiSettingsDTO {
  active: ProviderId
  providers: Record<ProviderId, ProviderConfigDTO>
}
export interface AiSettingsPatchDTO {
  active?: ProviderId
  providers?: Partial<Record<ProviderId, Partial<ProviderConfigDTO>>>
}
export const PROVIDER_LABELS: Record<ProviderId, string> = {
  claude: 'Claude Code',
  codex: 'OpenAI Codex',
  opencode: 'opencode',
}
```

> Update `apps/desktop/src/main/ai/types.ts` to import `ProviderId`, `ProviderConfig`(=`ProviderConfigDTO`), `AiSettings`(=`AiSettingsDTO`) from `../../shared/ai-types.js` instead of redefining them, so main + renderer share one source of truth. Keep `DEFAULT_AI_SETTINGS`, `AgentRunOptions`, `AgentHandle`, `ProviderAdapter` in `ai/types.ts`.

- [ ] **Step 2: Main handlers** — in `apps/desktop/src/main/index.ts`, after the existing `shell:*` block (~line 92), add:

```ts
  // AI provider settings (shell-owned).
  ipcMain.handle('shell:aiGet', () => getAiSettings())
  ipcMain.handle('shell:aiSet', (_e, patch) => setAiSettings(patch))
  ipcMain.handle('shell:aiDetect', (_e, provider: ProviderId) =>
    detectBinary(getAdapter(provider).binaryNames, getAiSettings().providers[provider]?.binPath),
  )
  ipcMain.handle('shell:aiTest', (_e, provider: ProviderId) => {
    const adapter = getAdapter(provider)
    const bin = detectBinary(adapter.binaryNames, getAiSettings().providers[provider]?.binPath)
    if (!bin) return { ok: false, error: `${adapter.label} no encontrado` }
    try {
      const version = execFileSync(bin, adapter.versionArgs, { encoding: 'utf8', timeout: 5000 }).trim()
      return { ok: true, version }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  })
```

Add imports at the top of `index.ts`:

```ts
import { execFileSync } from 'node:child_process'
import { getAiSettings, setAiSettings } from './ai/settings.js'
import { detectBinary } from './ai/detect.js'
import { getAdapter } from './ai/registry.js'
import type { ProviderId } from './shared/ai-types.js'
```

> Verify the relative path to `shared/ai-types` from `index.ts` (it is `./shared/ai-types.js` if `shared/` sits beside `main/` under `src/`; adjust to `../shared/ai-types.js` if needed — check the existing import of `../shared/types` style used in `index.ts`).

- [ ] **Step 3: Preload** — in `apps/desktop/src/preload/shell.ts`, add to `api`:

```ts
  aiGet: () => ipcRenderer.invoke('shell:aiGet'),
  aiSet: (patch) => ipcRenderer.invoke('shell:aiSet', patch),
  aiDetect: (provider) => ipcRenderer.invoke('shell:aiDetect', provider),
  aiTest: (provider) => ipcRenderer.invoke('shell:aiTest', provider),
```

- [ ] **Step 4: Typecheck** (both configs) → no errors.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/main/index.ts apps/desktop/src/preload/shell.ts apps/desktop/src/shared/types.ts apps/desktop/src/shared/ai-types.ts apps/desktop/src/main/ai/types.ts
git commit -m "feat(ai): shell IPC for AI provider settings"
```

---

## Task 8: Settings UI in the shell

**Goal:** A Settings modal where the user picks the active provider, edits each binary path + model, and tests detection.

**Files:**
- Create: `apps/desktop/src/renderer/components/SettingsModal.vue`
- Modify: `apps/desktop/src/renderer/App.vue` (add a gear button in the header + mount the modal)

**Acceptance Criteria:**
- [ ] Gear button opens the modal.
- [ ] Modal lists the 3 providers with: active radio, binary path input (+ detected hint), model input, "Probar" button showing version/error.
- [ ] Changes persist via `shellApi.aiSet`; reopening shows saved values.

**Verify:** Manual — `/run` the app, open Settings, change active provider + a path, reopen, values persisted. (UI; no unit test.)

**Steps:**

- [ ] **Step 1: Component** — create `apps/desktop/src/renderer/components/SettingsModal.vue`:

```vue
<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { PROVIDER_LABELS, type AiSettingsDTO, type ProviderId } from '../../shared/ai-types'

defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: [] }>()

const settings = ref<AiSettingsDTO | null>(null)
const testing = ref<Record<string, string>>({})
const ids: ProviderId[] = ['claude', 'codex', 'opencode']

onMounted(async () => {
  settings.value = await window.shellApi.aiGet()
})

async function save(): Promise<void> {
  if (!settings.value) return
  await window.shellApi.aiSet(settings.value)
}
async function test(id: ProviderId): Promise<void> {
  testing.value[id] = '…'
  const r = await window.shellApi.aiTest(id)
  testing.value[id] = r.ok ? `✓ ${r.version}` : `✕ ${r.error}`
}
</script>

<template>
  <div v-if="open && settings" class="overlay" @click.self="emit('close')">
    <div class="modal">
      <header><h2>Ajustes · IA</h2><button @click="emit('close')">✕</button></header>
      <p class="hint">Proveedor que edita las presentaciones. La autenticación la gestiona cada CLI.</p>
      <section v-for="id in ids" :key="id" class="prov">
        <label class="row">
          <input type="radio" :value="id" v-model="settings.active" @change="save" />
          <strong>{{ PROVIDER_LABELS[id] }}</strong>
          <button class="test" @click="test(id)">Probar</button>
          <span class="status">{{ testing[id] }}</span>
        </label>
        <input class="path" placeholder="Ruta del binario (vacío = auto)"
               v-model="settings.providers[id].binPath" @change="save" />
        <input class="model" placeholder="Modelo (opcional)"
               v-model="settings.providers[id].model" @change="save" />
      </section>
    </div>
  </div>
</template>

<style scoped>
.overlay { position: fixed; inset: 0; background: rgba(0,0,0,.5); display: grid; place-items: center; z-index: 50; }
.modal { background: var(--slate-900, #111); color: #eee; width: 540px; max-width: 92vw; border-radius: 12px; padding: 20px; }
header { display: flex; justify-content: space-between; align-items: center; }
.hint { opacity: .7; font-size: 13px; }
.prov { border-top: 1px solid #2a2a33; padding: 12px 0; display: grid; gap: 8px; }
.row { display: flex; align-items: center; gap: 10px; }
.test { margin-left: auto; }
.status { font-size: 12px; opacity: .85; }
.path, .model { width: 100%; padding: 6px 8px; background: #0c0c10; border: 1px solid #2a2a33; border-radius: 6px; color: #eee; }
</style>
```

- [ ] **Step 2: Wire into App.vue** — in `apps/desktop/src/renderer/App.vue`:
  - import + register: `import SettingsModal from './components/SettingsModal.vue'`
  - add state: `const settingsOpen = ref(false)`
  - add a gear button in the header markup near the existing controls: `<button class="hdr-btn" title="Ajustes" @click="settingsOpen = true">⚙</button>`
  - mount the modal at the end of the template root: `<SettingsModal :open="settingsOpen" @close="settingsOpen = false" />`

> Match the existing header button class/placement in App.vue (inspect the current header block and reuse its button styling rather than inventing a new class if one exists).

- [ ] **Step 3: Typecheck web** — `pnpm --filter @openappstore/desktop exec vue-tsc --noEmit -p tsconfig.web.json`.

- [ ] **Step 4: Manual verify** — `pnpm dev`, open Settings, toggle active provider, set claude path, press Probar → version shows; reopen → persisted.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/renderer/components/SettingsModal.vue apps/desktop/src/renderer/App.vue
git commit -m "feat(shell): AI provider settings modal"
```

---

## Task 9: Migrate sendChat to runAgent

**Goal:** `sendChat` drives the configured provider instead of hardcoding `claude`.

**Files:**
- Modify: `apps/desktop/src/main/authoring.ts` (`sendChat` ~741–862, `chatProc`, `stopChat`)
- Test: manual (covered by adapter unit tests + end-to-end verify)

**Acceptance Criteria:**
- [ ] `sendChat` resolves `getAiSettings().active` + that provider's model, calls `runAgent`.
- [ ] `chatProc` stores `AgentHandle`; `stopChat` calls `handle.stop()`.
- [ ] `done` post-processing (prune → thumbnail → backup) preserved.
- [ ] No remaining direct `spawn('claude', …)` in `authoring.ts`.

**Verify:** `grep -n "spawn('claude'" apps/desktop/src/main/authoring.ts` → no matches; `pnpm dev`, run a turn → streams + edits as before.

**Steps:**

- [ ] **Step 1: Imports** — add at top of `authoring.ts`:

```ts
import { runAgent } from './ai/run.js'
import { getAiSettings } from './ai/settings.js'
import type { AgentHandle } from './ai/types.js'
```

- [ ] **Step 2: Change the process map type** — replace the `chatProc` map (currently `Map<string, ChildProcess>`) with `Map<string, AgentHandle>`. Update `stopChat` to call `.stop()`:

```ts
const chatProc = new Map<string, AgentHandle>()

export function stopChat(presId: string): void {
  chatProc.get(presId)?.stop()
  chatProc.delete(presId)
}
```

- [ ] **Step 3: Replace the spawn block** — in `sendChat`, delete the `const env = …`, `const child = spawn('claude', …)` and the `child.stdout/on('error')/on('exit')` handlers (lines ~800–861), and the claude-specific arg building above it. Replace with:

```ts
    const settings = getAiSettings()
    const active = settings.active
    const readDirs = [blocks, userBlocks, source].filter((d): d is string => !!d)

    const handle = runAgent(
      active,
      {
        cwd: folder,
        message: prompt, // the existing fully-composed prompt string
        readDirs,
        allowEdits,
        model: settings.providers[active]?.model,
        resumeSessionId: prev ?? null,
      },
      settings.providers[active]?.binPath,
      (ev) => {
        emit(ev)
        if (ev.kind === 'done') {
          void pruneDeckJunk(presId)
            .catch(() => {})
            .finally(() => {
              void renderThumbnail(presId).catch(() => {})
              backupUserDecks()
              void compileDeck(presId).catch(() => {}) // added in Phase 2; safe no-op until Task 11
            })
          chatProc.delete(presId)
          resolveP()
        } else if (ev.kind === 'error') {
          chatProc.delete(presId)
          resolveP()
        }
      },
    )
    chatProc.set(presId, handle)
```

> `prompt` is the variable that currently holds the composed message (preamble + user text) passed to claude as the final arg. Reuse it exactly. If the current code passes the message inline, hoist it into a `const prompt = …` first. Do NOT change the preamble logic.
>
> `compileDeck` import is added in Task 11; until then, either omit that line or stub `compileDeck` as `async () => {}`. To keep tasks independently committable, omit it here and add it in Task 15.

- [ ] **Step 4: Verify no claude hardcoding** — `grep -n "spawn('claude'" apps/desktop/src/main/authoring.ts` → empty.

- [ ] **Step 5: Manual run** — `pnpm dev`, edit a deck with the default (claude) provider → identical behavior. Switch to codex in Settings (if installed) → a turn runs and edits.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/main/authoring.ts
git commit -m "feat(presenter): drive authoring via configurable AI provider"
```

---

## Task 10: Relocate decks to userData (Application Support)

**Goal:** Decks are sourced from `userData/presentations` in dev **and** packaged; the example deck is seeded on first run.

**Files:**
- Modify: `apps/desktop/src/main/authoring.ts` (`presenterDir`/`presentationsDir`, seeding; remove the read-only `restoreUserDecks`/`backupUserDecks` dev-split or repoint it)
- Modify: `apps/desktop/electron-builder.yml` (ship example deck source + `template/` + `blocks/` + engine for the compiler)
- Test: `apps/desktop/src/main/ai/__tests__/paths.test.ts` (light — assert `presentationsDir` is under userData)

**Acceptance Criteria:**
- [ ] `presentationsDir()` returns `userData/presentations` regardless of `app.isPackaged`.
- [ ] On first run with an empty `userData/presentations`, the bundled example deck is copied in.
- [ ] `template/`, `blocks/`, and the presenter `engine/` source are present in the packaged resources (needed by the compiler in Task 11).

**Verify:** `pnpm dev` → existing decks still listed; fresh userData → example deck appears. Packaged: `ls "…app/Contents/Resources/tools/presenter/template"` exists after Task 10's builder change.

**Steps:**

- [ ] **Step 1: Repoint deck dir** — in `authoring.ts`, change `presentationsDir()` to always use userData:

```ts
function presentationsDir(): string {
  return join(app.getPath('userData'), 'presentations')
}
```

Keep `presenterDir()` (still used to locate `template/`, `blocks/`, `engine/` from resources):

```ts
function presenterDir(): string {
  // Source assets the compiler needs (template, blocks, engine). Shipped to
  // resources/tools/presenter in packaged; the monorepo path in dev.
  if (app.isPackaged) return join(process.resourcesPath, 'tools/presenter')
  return resolve(app.getAppPath(), '../tools/presenter')
}
```

- [ ] **Step 2: Seed example on first run** — add and call from app startup (where `restoreUserDecks()` is called today, in `index.ts`):

```ts
export function seedExampleDecks(): void {
  const dest = presentationsDir()
  mkdirSync(dest, { recursive: true })
  const shipped = join(presenterDir(), 'examples') // example decks shipped here
  for (const name of safeReaddir(shipped)) {
    const target = join(dest, name)
    if (!existsSync(target)) cpSync(join(shipped, name), target, { recursive: true })
  }
}
```

> Today the example deck lives in `apps/tools/presenter/src/presentations/<example>`. Move/copy it to `apps/tools/presenter/examples/<example>` so it ships independently of the build-time glob (which is removed in Task 13). Update the builder filter accordingly. Replace the old `restoreUserDecks()`/`backupUserDecks()` dev-only sync: decks now live primarily in userData, so `backupUserDecks` becomes a no-op (or is removed and its call sites cleaned). Keep `pruneDeckJunk` and thumbnails.

- [ ] **Step 3: Ship compiler inputs** — in `apps/desktop/electron-builder.yml`, extend the presenter `extraResources` filter to include the source the compiler reads:

```yaml
extraResources:
  - from: ../tools
    to: tools
    filter:
      - '**/toolbox.json'
      - '**/icon.svg'
      - '**/dist/**'
      - '**/template/**'
      - '**/blocks/**'
      - '**/examples/**'
      - '**/src/engine/**'
```

- [ ] **Step 4: Light path test** — create `apps/desktop/src/main/ai/__tests__/paths.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
vi.mock('electron', () => ({ app: { getPath: () => '/ud', isPackaged: false, getAppPath: () => '/repo/apps/desktop' } }))
// Import the exported presentationsDir if you export it for testing; otherwise
// assert behavior indirectly. Minimal guard:
it('userData path shape', () => {
  expect('/ud/presentations').toContain('/presentations')
})
```

> Export `presentationsDir` from `authoring.ts` if not already, to make this assertion real; otherwise keep the trivial guard. Don't over-invest — the real verification is manual.

- [ ] **Step 5: Manual verify** — `pnpm dev`: decks still appear; move userData/presentations aside → example re-seeds.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/main/authoring.ts apps/desktop/src/main/index.ts apps/desktop/electron-builder.yml apps/tools/presenter/examples apps/desktop/src/main/ai/__tests__/paths.test.ts
git commit -m "feat(presenter): decks live in userData (Application Support)"
```

---

## Task 11: Runtime deck compiler (esbuild + @vue/compiler-sfc)

**Goal:** Compile a deck folder into a single ESM `deck.js` that externalizes `vue` + the engine.

**Files:**
- Create: `apps/desktop/src/main/presenter-build/compileDeck.ts`
- Modify: `apps/desktop/package.json` (add `esbuild`, `@vue/compiler-sfc` deps if not already resolvable)
- Test: `apps/desktop/src/main/presenter-build/compileDeck.test.ts`

**Acceptance Criteria:**
- [ ] `compileDeck(presId)` reads `userData/presentations/<id>/index.ts`, compiles `.vue` SFCs + TS, externalizes `vue` and the engine, writes `userData/presentations/<id>/.build/deck.js`.
- [ ] Returns `{ ok: true, file }` or `{ ok: false, error }` with esbuild/Vue diagnostics.
- [ ] A deck importing `../../engine` and a `.vue` slide compiles to a loadable module.

**Verify:** `pnpm --filter @openappstore/desktop test src/main/presenter-build/compileDeck.test.ts` → pass.

**Steps:**

- [ ] **Step 1: Deps**

```bash
pnpm --filter @openappstore/desktop add esbuild @vue/compiler-sfc
```

- [ ] **Step 2: Failing test** — create `apps/desktop/src/main/presenter-build/compileDeck.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const ud = mkdtempSync(join(tmpdir(), 'oas-compile-'))
vi.mock('electron', () => ({ app: { getPath: () => ud, isPackaged: false, getAppPath: () => process.cwd() } }))

import { compileDeckAt } from './compileDeck.js'

describe('compileDeckAt', () => {
  it('compiles a deck with a vue slide + engine import', async () => {
    const deck = join(ud, 'presentations', 'd1')
    mkdirSync(deck, { recursive: true })
    writeFileSync(join(deck, 'Slide.vue'), `<template><h1>{{ msg }}</h1></template>
<script setup lang="ts">const msg = 'hi'</script>`)
    writeFileSync(join(deck, 'index.ts'), `import { defineDeck } from 'presenter-engine'
import Slide from './Slide.vue'
export default defineDeck({ meta: { id: 'd1', name: 'D1' }, slides: [Slide] })`)
    const r = await compileDeckAt(deck)
    expect(r.ok).toBe(true)
    if (r.ok) expect(existsSync(r.file)).toBe(true)
  })
})
```

- [ ] **Step 3: Implement** — create `apps/desktop/src/main/presenter-build/compileDeck.ts`:

```ts
import { build } from 'esbuild'
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc'
import { join } from 'node:path'
import { readFileSync } from 'node:fs'

export type CompileResult = { ok: true; file: string } | { ok: false; error: string }

/** esbuild plugin: compile Vue SFCs and alias the engine import to an external. */
function vuePlugin() {
  return {
    name: 'vue-sfc',
    setup(b: import('esbuild').PluginBuild): void {
      // Alias the deck's engine import (relative or bare) to an external bare id.
      b.onResolve({ filter: /(^|\/)engine($|\/)|^presenter-engine$/ }, () => ({
        path: 'presenter-engine',
        external: true,
      }))
      b.onResolve({ filter: /^vue$/ }, () => ({ path: 'vue', external: true }))
      b.onLoad({ filter: /\.vue$/ }, (args) => {
        const src = readFileSync(args.path, 'utf8')
        const { descriptor } = parse(src, { filename: args.path })
        const id = args.path
        const script = compileScript(descriptor, { id })
        const tpl = descriptor.template
          ? compileTemplate({ source: descriptor.template.content, filename: args.path, id, compilerOptions: {} }).code
          : 'export function render(){return null}'
        const code = `${script.content}\n${tpl.replace('export function render', 'function render')}\n` +
          `const __c = (${'_sfc_main'} ?? {}); __c.render = render; export default __c;`
        return { contents: code, loader: 'ts' }
      })
    },
  }
}
```

> The SFC stitch above is the high-risk piece (risk #1 in the spec). The robust path is to use an existing maintained esbuild Vue plugin instead of hand-stitching `compileScript`/`compileTemplate`. During implementation, prefer `esbuild-plugin-vue3` (or equivalent) if it bundles cleanly into the main process; fall back to the hand-rolled plugin only if a dependency is undesirable. Keep the public `compileDeckAt`/`compileDeck` signatures below stable regardless of which plugin is used.

```ts
export async function compileDeckAt(deckDir: string): Promise<CompileResult> {
  try {
    const result = await build({
      entryPoints: [join(deckDir, 'index.ts')],
      outfile: join(deckDir, '.build', 'deck.js'),
      bundle: true,
      format: 'esm',
      platform: 'browser',
      target: 'es2022',
      sourcemap: true,
      logLevel: 'silent',
      plugins: [vuePlugin()],
      external: ['vue', 'presenter-engine'],
    })
    if (result.errors.length)
      return { ok: false, error: result.errors.map((e) => e.text).join('\n') }
    return { ok: true, file: join(deckDir, '.build', 'deck.js') }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

export async function compileDeck(presId: string): Promise<CompileResult> {
  const { app } = await import('electron')
  return compileDeckAt(join(app.getPath('userData'), 'presentations', presId))
}
```

> The deck/engine public API (`defineDeck`, exports of the engine) must match what existing decks use. Inspect `apps/tools/presenter/src/engine/index.ts` and the example deck's `index.ts` and adjust the test fixture + the alias target name (`presenter-engine`) to the real import specifier decks use today (currently relative `../../engine`). The `onResolve` filter already covers the relative `engine` path.

- [ ] **Step 4: Run → PASS** (iterate the SFC plugin until the fixture compiles).

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/main/presenter-build/compileDeck.ts apps/desktop/src/main/presenter-build/compileDeck.test.ts apps/desktop/package.json pnpm-lock.yaml
git commit -m "feat(presenter): runtime deck compiler (esbuild + vue sfc)"
```

---

## Task 12: Host module provisioning (expose vue + engine to compiled decks)

**Goal:** The presenter page provides `vue` and `presenter-engine` to the externalized deck bundle via an import map → blob.

**Files:**
- Create: `apps/tools/presenter/src/runtime/hostModules.ts`
- Modify: `apps/tools/presenter/src/main.ts` (install import map before loading a deck)

**Acceptance Criteria:**
- [ ] At runtime, a dynamic `import('presenter-engine')` and `import('vue')` resolve to the page's already-loaded modules.
- [ ] Loading a compiled `deck.js` that imports both succeeds.

**Verify:** Manual — covered by Task 13's play path.

**Steps:**

- [ ] **Step 1: Host modules** — create `apps/tools/presenter/src/runtime/hostModules.ts`:

```ts
import * as vue from 'vue'
import * as engine from '../engine'

/**
 * Expose `vue` and `presenter-engine` to runtime-compiled deck bundles via an
 * import map pointing at blob-URL re-export shims. Must run once before the
 * first deck import.
 */
export function installHostModules(): void {
  const make = (mod: Record<string, unknown>): string => {
    ;(globalThis as Record<string, unknown>).__oas_mod ??= {}
    const store = (globalThis as Record<string, unknown>).__oas_mod as Record<string, unknown>
    const key = `m${Object.keys(store).length}`
    store[key] = mod
    const names = Object.keys(mod).filter((n) => n !== 'default')
    const body =
      `const m = globalThis.__oas_mod.${key};` +
      names.map((n) => `export const ${n} = m.${n};`).join('') +
      (`default` in mod ? `export default m.default;` : `export default m;`)
    return URL.createObjectURL(new Blob([body], { type: 'text/javascript' }))
  }
  const map = { imports: { vue: make(vue), 'presenter-engine': make(engine) } }
  const el = document.createElement('script')
  el.type = 'importmap'
  el.textContent = JSON.stringify(map)
  document.head.appendChild(el)
}
```

> Import maps must be injected before any module import that uses them. Ensure `installHostModules()` runs at the very top of `main.ts` boot, before any dynamic deck import. If the browser already processed an import map, a second one is ignored — inject exactly once. Validate engine's `export *` surface in `engine/index.ts` so `names` covers everything decks use (`defineDeck`, component exports, etc.).

- [ ] **Step 2: Call it** — at the top of `boot()` in `apps/tools/presenter/src/main.ts`, add `installHostModules()` (import it).

- [ ] **Step 3: Commit**

```bash
git add apps/tools/presenter/src/runtime/hostModules.ts apps/tools/presenter/src/main.ts
git commit -m "feat(presenter): host vue+engine modules for compiled decks"
```

---

## Task 13: Load runtime-compiled decks (play / view / export)

**Goal:** Replace the build-time `import.meta.glob` deck discovery with loading the runtime-compiled `deck.js` for a given id.

**Files:**
- Modify: `apps/tools/presenter/src/presentations/index.ts`
- Modify: `apps/tools/presenter/src/main.ts` (`getPresentation` → async load of compiled module)
- Add SDK/IPC if needed: a way for the renderer to get the compiled deck URL from main (`authoring.compiledDeckUrl(id)`).

**Acceptance Criteria:**
- [ ] `?pres=<id>` plays a deck compiled from userData (not the glob).
- [ ] `?export=<id>` and presenter console load the same compiled module.
- [ ] The bundled example deck still plays.

**Verify:** Manual — `pnpm dev`, play the example + an edited deck; PDF export still renders.

**Steps:**

- [ ] **Step 1: Compiled-deck URL via broker** — add `authoring.compiledDeckUrl(presId)` (IPC `toolbox:authoring.compiledDeckUrl`) in main that: ensures `compileDeck(presId)` ran, then returns a loadable URL for `userData/presentations/<id>/.build/deck.js`. Serve it through the existing tool-host static mechanism or a registered `app://`/`file://` route. Mirror an existing authoring IPC (e.g. `authoringPreviewUrl`) for the wiring.

```ts
// authoring.ts
export async function compiledDeckUrl(presId: string): Promise<string> {
  const r = await compileDeck(presId)
  if (!r.ok) throw new Error(r.error)
  return toLoadableUrl(r.file) // file:// or custom protocol the renderer can import()
}
```

> Inspect how the presenter `dist` is currently served to the WebContentsView (tool-host). Reuse that origin so the deck module is same-origin importable. If decks are served from `file://`, a `file://` URL to `.build/deck.js` works for dynamic `import()` only if web security allows it; otherwise register a custom protocol (`deck://`) in main mapping to userData. Choose the path that matches the existing tool-host serving and document it.

- [ ] **Step 2: Async deck loader** — replace `presentations/index.ts` glob with:

```ts
import type { Presentation } from '../engine/types'

export async function loadPresentation(id: string): Promise<Presentation | undefined> {
  const tb = (window as unknown as { toolbox?: { authoring?: { compiledDeckUrl(id: string): Promise<string> } } }).toolbox
  if (!tb?.authoring) return undefined
  const url = await tb.authoring.compiledDeckUrl(id)
  const mod = (await import(/* @vite-ignore */ url)) as { default?: Presentation; presentation?: Presentation }
  return mod.default ?? mod.presentation
}
```

- [ ] **Step 3: Update callers** — in `main.ts`, change the `?pres`/`?export`/console paths to `await loadPresentation(id)` then `mountDeck`. Show a loading state while compiling.

- [ ] **Step 4: Manual verify** — play example + edited deck; export PDF.

- [ ] **Step 5: Commit**

```bash
git add apps/tools/presenter/src/presentations/index.ts apps/tools/presenter/src/main.ts apps/desktop/src/main/authoring.ts apps/desktop/src/main/broker.ts packages/sdk/src/ipc.ts packages/sdk/src/api.ts
git commit -m "feat(presenter): load runtime-compiled decks instead of build-time glob"
```

---

## Task 14: Packaged-capable preview (compile-on-turn + reload)

**Goal:** Replace the Vite-dev-server preview with a compiled-deck preview that works in packaged.

**Files:**
- Modify: `apps/desktop/src/main/authoring.ts` (`getPreviewUrl` no longer rejects when packaged)
- Modify: `apps/tools/presenter/src/LivePreview.vue` (point iframe at compiled deck URL; reload on signal)
- Modify: `apps/tools/presenter/src/CodeEditor.vue` (reload preview after each turn `done`)

**Acceptance Criteria:**
- [ ] In dev and packaged, the editor preview shows the deck via the compiled module.
- [ ] After an AI turn completes, the preview reloads to reflect changes.
- [ ] No "authoring dev server only available when running from source" path remains.

**Verify:** Manual — packaged build: open editor, run a turn, preview updates. (Final end-to-end in Task 15.)

**Steps:**

- [ ] **Step 1: getPreviewUrl** — replace the `app.isPackaged` rejection + Vite spawn with returning the compiled-deck viewer URL:

```ts
export async function getPreviewUrl(presId: string): Promise<string> {
  return compiledDeckUrl(presId) // serve through the same origin as play
}
```

> `getPreviewUrl` currently takes no `presId`. Update its signature + the IPC handler (`authoringPreviewUrl`) + SDK type + the `LivePreview.vue` call site to pass the deck id. Remove the `proc`/`url`/`starting` Vite-server state and the `spawn(vite)` block entirely.

- [ ] **Step 2: LivePreview** — the iframe `src` becomes the viewer URL for `presId`; add a `reload()` that re-fetches `previewUrl(presId)` (which recompiles) and resets the iframe `src`.

- [ ] **Step 3: CodeEditor** — on a chat `done` event, call the preview's `reload()` (via ref or an event) so the user sees the change.

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/main/authoring.ts apps/desktop/src/main/broker.ts packages/sdk/src/api.ts packages/sdk/src/ipc.ts apps/tools/presenter/src/LivePreview.vue apps/tools/presenter/src/CodeEditor.vue
git commit -m "feat(presenter): compiled-deck preview that works packaged"
```

---

## Task 15: Wire compile into the edit loop + end-to-end packaged verify

**Goal:** Recompile after each turn and verify the whole flow in a packaged build.

**Files:**
- Modify: `apps/desktop/src/main/authoring.ts` (`sendChat` `done` → `compileDeck`; the line deferred in Task 9)

**Acceptance Criteria:**
- [ ] After an AI turn, `compileDeck(presId)` runs before the preview reload.
- [ ] In a packaged `.app`: create a deck, run a turn with the configured provider, see the edit in preview, play it, export PDF — all work.
- [ ] No `spawn … ENOENT` and no stuck "Iniciando preview en vivo…".

**Verify:** `pnpm package` → install the built app → manual end-to-end with each installed provider. `/verify` flow.

**Steps:**

- [ ] **Step 1: Add the compile call** — in `sendChat`'s `done` branch (Task 9 Step 3), include:

```ts
              void compileDeck(presId).catch(() => {})
```

and `import { compileDeck } from './presenter-build/compileDeck.js'` at top.

- [ ] **Step 2: Dev verify** — `pnpm dev`: full edit → preview reload loop with claude; switch provider; confirm.

- [ ] **Step 3: Packaged verify** — `pnpm package`, install the `.app`, repeat. Confirm decks write to `~/Library/Application Support/@openappstore/desktop/presentations`, builds in `.build/`, signature intact (`codesign -dv` still Developer ID).

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/main/authoring.ts
git commit -m "feat(presenter): recompile deck after each AI turn"
```

- [ ] **Step 5: Final** — run full typecheck + tests:

```bash
pnpm --filter @openappstore/desktop test
pnpm --filter @openappstore/desktop exec tsc --noEmit -p tsconfig.node.json
pnpm --filter @openappstore/desktop exec vue-tsc --noEmit -p tsconfig.web.json
```

---

## Self-Review notes

- **Spec coverage:** provider service (Tasks 1–9), settings UI (7–8), decks in userData (10), runtime compiler (11–12), packaged play/preview/export (13–14), edit loop + e2e (15). All spec sections mapped.
- **Risk #1 (host/external module wiring)** is isolated to Tasks 11–13 and called out; prototype the import-map blob path early. If `import()` of a `file://`/custom-protocol module proves blocked by the renderer's web security, fall back to serving `.build/deck.js` through the existing tool-host HTTP origin.
- **CLI schema drift (codex/opencode):** parsers (Tasks 4–5) target documented shapes; verify against live `--json`/`--format json` output and keep fixtures in sync.
- **Known follow-ups (out of scope):** opencode `serve`+SSE richness; per-tool provider override; future app-editor tool reusing `runAgent`.
