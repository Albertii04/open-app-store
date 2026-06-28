# Shell AI provider service + packaged deck editing — Design

**Date:** 2026-06-28
**Status:** Draft for review
**Author:** Albert (with Claude)

## Summary

Two coupled goals, one spec:

1. **Phase 1 — Shell AI provider service.** A shell-level (Open App Store)
   setting to choose the AI agent CLI that drives in-app authoring: **Claude
   Code**, **OpenAI Codex**, or **opencode**. Configurable binary path + model,
   one active provider global to the whole shell, consumed by any privileged
   tool (Presenter now, future app editor later). Works in dev **and** the
   packaged app.

2. **Phase 2 — Packaged deck editing.** Make Presenter's AI editor actually
   work in the distributed `.app`, not just `pnpm dev`. Decks live in writable
   storage (Application Support / `userData`) and are compiled on demand at
   runtime (no Vite dev server, no read-only bundle writes).

End state the user asked for: *pick a provider in settings and edit
presentations with that provider automatically, in the installed app.*

## Background — why it's broken today

Evidence gathered while diagnosing the live error (`spawn claude ENOENT` +
stuck "Iniciando preview en vivo…" in the packaged app):

- **Provider is hardcoded.** `authoring.ts` spawns `claude` directly
  (`sendChat`, ~line 801) with claude-specific flags and parses claude's
  `stream-json` output into a normalized `ChatEvent`
  (`{kind:'assistant'|'tool'|'done'|'error', text, sessionId?}`).
- **The ENOENT is a cwd error, not a missing binary.** `spawn(cmd, {cwd})`
  throws `ENOENT` naming the command when `cwd` doesn't exist. In packaged,
  `presentationsDir()` = `…app/Contents/Resources/tools/presenter/src/presentations`
  which **is not shipped** (electron-builder ships only `dist/`).
- **Decks are compiled at build time.** `presentations/index.ts` uses
  `import.meta.glob('./*/index.ts', {eager:true})` — deck `.vue`/`.ts` source is
  bundled by Vite into `dist/`. No runtime path adds/edits a deck.
- **Live preview is dev-only by design.** `getPreviewUrl()` rejects when
  `app.isPackaged`, and it spawns `node_modules/.bin/vite` which isn't shipped.
- **Writable storage already exists.** `userDecksDir()` =
  `userData/presentations` (today a dev-only backup). `userData` resolves to
  `~/Library/Application Support/@openappstore/desktop` — writable, outside the
  signed bundle, survives updates.

So: the provider abstraction is a clean refactor around one seam; packaged
editing requires relocating decks to `userData` and replacing the Vite dev
server with a runtime compiler.

## Provider capability matrix (researched)

| Capability | Claude Code | OpenAI Codex | opencode |
|---|---|---|---|
| Headless | `claude -p` | `codex exec` | `opencode run` |
| JSON stream | `--output-format stream-json` | `--json` (JSONL) | `run --format json` |
| Scope to folder | cwd + `--add-dir` | `--cd` + sandbox | `--dir` + cwd |
| Resume | `--resume <id>` | `codex exec resume <id>` | `--session <id>` / `-c` |
| Read-only mode | `--permission-mode plan` / `--allowedTools` | `--sandbox read-only` | permission config `edit:deny` |
| Edit mode | `--permission-mode acceptEdits` | `--sandbox workspace-write` | default (run) |
| Model | `--model` | `--model` | `--model provider/model` |
| Session id source | `result.session_id` | `thread.started` event | session JSON / `POST /session` |
| Auth | CLI-managed (`claude` login) | CLI-managed (`codex login` / `OPENAI_API_KEY`) | CLI-managed (`opencode auth login` / env) |

**Parity holds at the `ChatEvent` level.** Each CLI offers headless run, folder
scope, JSON stream, resume, read-only vs edit, and model selection. Known
divergences, handled inside each adapter and documented to the user:

- **Tool-restriction granularity.** Claude = fine-grained allowlist; Codex =
  coarse (sandbox mode only, no per-tool allowlist); opencode = per-tool via
  config. All three can do the two modes Presenter needs: *edit* and
  *read-only*.
- **Extra read-only reference dirs outside cwd.** Claude supports multiple
  `--add-dir`. Codex/opencode confine to cwd; an external reference dir is not
  guaranteed. Adapter advertises this; consumers that need it (Presenter's
  `--add-dir <source>`) degrade gracefully on Codex/opencode (reference read in
  place only when the provider supports it; otherwise a one-line notice).
- **Auth is never handled by the app.** Each CLI owns its credentials. The app
  only resolves the binary and reports version; the user runs the CLI's own
  login once. No OAuth in-app.

---

## Phase 1 — Shell AI provider service

### Module layout (new, generic, presenter-agnostic)

```
apps/desktop/src/main/ai/
  types.ts          AgentRunOptions, ProviderAdapter, AgentHandle, AiSettings
  registry.ts       adapter map + resolve active adapter
  settings.ts       read/write Ai settings (new app-level settings store)
  detect.ts         binary auto-detection across PATH + common install dirs
  run.ts            ai.run(): resolve adapter+bin, spawn, normalize errors
  adapters/
    claude.ts
    codex.ts
    opencode.ts
```

The shell **owns** provider config. `authoring.ts` and future tools **consume**
it via `ai.run(...)`. Presenter-specific knowledge (blocks dirs, system
preamble, prune/thumbnail/backup) stays in `authoring.ts`.

### Adapter interface (the parity seam)

```ts
interface AgentRunOptions {
  cwd: string                    // folder the agent may edit (confinement)
  message: string
  readDirs: string[]             // read-only reference dirs (best-effort per provider)
  allowEdits: boolean            // edit vs read-only/plan
  model?: string
  resumeSessionId?: string | null
}

interface AgentHandle {
  stop(): void                   // kill the turn
}

interface ProviderAdapter {
  id: 'claude' | 'codex' | 'opencode'
  label: string
  binaryNames: string[]          // candidates for detect()
  supportsExternalReadDirs: boolean
  versionArgs: string[]          // e.g. ['--version'] for the Test button
  run(
    bin: string,
    opts: AgentRunOptions,
    emit: (e: ChatEvent) => void,
  ): AgentHandle
}
```

Each adapter maps `AgentRunOptions` to its flags, spawns the CLI (same
`spawn` + env + cwd lifecycle as today), parses its JSONL stdout, and emits the
existing `ChatEvent`. The renderer's chat UI is untouched — it already consumes
`ChatEvent`.

Flag mapping per adapter (validate exact event schema against the shipped CLI
version during implementation):

- **claude.ts** — `-p --output-format stream-json --verbose --add-dir <readDirs…>
  --permission-mode {acceptEdits|plan} [--model] [--resume <id>]`. Parse
  `type:assistant` (text / tool_use) and `type:result` (session_id, is_error).
  (This is today's logic, lifted verbatim.)
- **codex.ts** — `exec --json --cd <cwd> --sandbox {workspace-write|read-only}
  --ask-for-approval never [--model] [resume <id>]`. Parse JSONL: `thread.started`
  → sessionId; `item.completed`(agent_message → assistant, command/file_change →
  tool); `turn.completed` → done; `error`/`turn.failed` → error.
- **opencode.ts** — `run --format json --dir <cwd> [--model prov/model]
  [--session <id>]`, with a temporary per-run permission config for read-only
  (`edit/bash/webfetch: deny`). Parse JSON events: `message.part.updated`
  (assistant text / tool parts), `session.idle` → done, errors → error; capture
  session id. (May upgrade to `opencode serve` + SSE later behind the same
  interface — no consumer change.)

### Settings store

New **app-level** settings file (distinct from per-tool `tool-storage`):
`userData/settings.json`, key `ai`.

```ts
interface AiSettings {
  active: 'claude' | 'codex' | 'opencode'
  providers: {
    [id: string]: { binPath?: string; model?: string }  // binPath empty → auto-detect
  }
}
```

Defaults: `active: 'claude'`, all `binPath` empty (auto-detect). `settings.ts`
exposes `getAiSettings()` / `setAiSettings(patch)` with lazy load + cache,
mirroring `storage.ts`.

### IPC + UI (shell renderer)

Settings UI lives in the **shell** (App.vue), so it uses direct shell IPC, not
the tool SDK. New handlers in `broker.ts` (or a small `settings` IPC group):

- `shell:aiGet` → `AiSettings`
- `shell:aiSet(patch)` → persist
- `shell:aiDetect(providerId)` → resolved binary path or null
- `shell:aiTest(providerId)` → `{ ok, version }` or `{ ok:false, error }` (runs
  `<bin> <versionArgs>`)

UI: a **Settings** panel in the shell (gear icon in the header). For each
provider: active-provider selector, binary path field (auto-detected value
shown, editable, "Browse…" via native open dialog), model field, status badge
(detected + version from Test), Test button. Friendly empty/error states.

### Consuming in `sendChat`

Replace the hardcoded `spawn('claude', …)` with:

```ts
const { active } = getAiSettings()
const handle = ai.run(active, {
  cwd: folder,
  message,
  readDirs: [blocks, userBlocks, source].filter(Boolean),
  allowEdits,
  model: getAiSettings().providers[active]?.model,
  resumeSessionId,
}, emit)
chatProc.set(presId, handle)   // handle.stop() replaces child.kill()
```

The `done` post-processing (prune junk → thumbnail → backup) stays in
`authoring.ts`. Errors normalized: binary not found → "Proveedor «X» no
encontrado. Configúralo en Ajustes." (no raw ENOENT); missing folder → explicit
message + create-if-needed.

### Detection

`detect.ts`: resolve each provider's `binaryNames` against `PATH`, then common
install dirs: `/opt/homebrew/bin`, `/usr/local/bin`, npm global bin
(`$(npm prefix -g)/bin`), `~/.local/bin`, `~/.codex/bin`, `~/.opencode/bin`.
Returns first hit. User override (`binPath`) always wins.

---

## Phase 2 — Packaged deck editing

Goal: the AI editor + live-ish preview work in the distributed `.app`.

### Decks become primary in `userData`

Today decks are globbed from `src/presentations` (build-time) with a `userData`
backup. Flip it: **`userData/presentations/<id>/` is the source of truth in both
dev and packaged.** This removes the read-only-bundle write path entirely.

- `presentationsDir()` → `userData/presentations` always (drop the `app.getPath`
  vs source-tree split for decks).
- Built-in example decks ship in `dist`/resources and are seeded into
  `userData/presentations` on first run if absent (read-only-import → writable
  copy), so the existing example still appears.
- Deck CRUD (`create`/`delete`/`attach`/`import`/`setSource`) already targets
  `presentationsDir()` — it follows the relocation for free.

### Runtime compiler (replaces the Vite dev server)

A deck is Vue/TS source; the browser can't run it raw. In packaged there's no
Vite. Add an **in-process compiler** in main:

```
apps/desktop/src/main/presenter-build/  (or inside the presenter tool-host)
  compileDeck.ts
```

`compileDeck(presId)`:

1. Read `userData/presentations/<id>/` (entry `index.ts` + `*.vue` + assets).
2. Compile SFCs with **`@vue/compiler-sfc`** (pure JS, bundleable) inside an
   **esbuild** plugin; transpile TS via esbuild. esbuild is already a repo
   dependency (`onlyBuiltDependencies`).
3. **Externalize** `vue` and the presenter engine (alias the deck's
   `../../engine` import to an external `presenter-engine` specifier) so the deck
   bundle stays tiny and reuses the already-loaded runtime.
4. Output a single ESM file: `userData/presentations/<id>/.build/deck.js`
   (+ source map). Bundle CSS likewise.
5. Return the built file path (or an error with diagnostics for the chat UI).

The already-built presenter page (`dist`) exposes `vue` + the engine to the deck
bundle via an **import map → blob URL** (page provides the modules; the deck's
external imports resolve to them). Implementation detail to validate in the plan;
the contract is "deck bundle imports `vue` and `presenter-engine`, the host
provides both."

### Rendering / preview

- **Play / view** (`?pres=<id>`): load the compiled `deck.js` for that id
  dynamically and mount it — same engine components (`AudienceDeck`,
  `PresenterConsole`, `ExportDeck`, `SoloDeck`) as today, just sourced from a
  runtime-compiled module instead of a build-time glob.
- **Editor preview** (`?edit=<id>`): replace the Vite-HMR iframe with a
  **compile-on-change** preview. After each AI turn (`done`) — and on manual
  edits — recompile the deck and reload the preview iframe pointing at the
  compiled output. Not HMR-granular, but a fast full reload per turn (turns are
  already seconds-long AI operations, so a sub-second recompile is invisible).
- `getPreviewUrl()` no longer rejects in packaged; it returns a URL backed by the
  compiled deck served from `userData` (via the existing tool-host static
  serving or a `file://`/custom-protocol route).
- PDF export (`ExportDeck`) already mounts compiled components — it consumes the
  same runtime-compiled module.

### Dev vs packaged unification

The runtime compiler runs in **both** dev and packaged. Dev no longer needs the
Vite dev server for decks (simpler, one code path). The presenter's own
app-shell (`dist`) is still Vite-built at package time; only **decks** move to
runtime compilation. This collapses the dev/packaged divergence that caused the
bug.

---

## End-to-end data flow (edit a deck in the packaged app)

1. User opens Presenter → `?edit=<id>` → chat UI.
2. Types a message → SDK `authoring.chat` → broker (capability `authoring`,
   builtin-only) → `sendChat`.
3. `sendChat` reads active provider from `AiSettings`, calls
   `ai.run(active, {cwd: userData/presentations/<id>, …}, emit)`.
4. Adapter spawns the chosen CLI in the deck folder, streams `ChatEvent`s back to
   the chat UI (assistant text, tool/edit activity).
5. On `done`: prune junk → **compileDeck(id)** → thumbnail → backup.
6. Preview iframe reloads the freshly compiled `deck.js`. User sees the change.

## Error handling

- Missing/misconfigured binary → friendly message pointing to Settings (not raw
  ENOENT).
- Missing deck folder → created or reported clearly.
- Compile errors → surfaced in the chat panel with the esbuild/Vue diagnostic
  (file + line), preview keeps last good build.
- Provider auth failures → pass through the CLI's own error text + a hint to run
  its login.
- Adapter parse resilience: unknown stdout lines ignored, never crash the turn.

## Security

- `authoring` capability stays **builtin/first-party only** (existing broker
  guard). Provider settings are shell-owned; tools can't set arbitrary binaries.
- Agent runs **confined to the deck folder** (cwd + provider read-only/edit
  mode). Read-only mode for "plan"/diagnostic turns.
- No writes inside the signed `.app` bundle — all deck data + builds in
  `userData`, preserving the Developer ID signature + notarization.
- esbuild runs in-process on local files only; no network. The compiled deck
  bundle executes in the same renderer sandbox as today's bundled decks.
- The chosen binary is user-configured + path-validated; the Test button surfaces
  what will run before it runs.

## Testing

- **Adapters:** unit-test flag construction + JSONL→`ChatEvent` parsing per
  provider against captured real CLI output fixtures (one `--help`/sample
  capture per provider, committed as fixtures).
- **Settings:** round-trip get/set; detection on a PATH stub; Test against a fake
  binary.
- **Compiler:** compile the example deck + a deck using engine imports; assert a
  loadable ESM module + that it mounts.
- **Integration (manual, via `/run` + verify):** in a packaged build, create a
  deck, run a turn with each installed provider, confirm edit + preview reload +
  play + PDF export.

## Scope

**In scope:** provider service (3 adapters) + settings UI; deck relocation to
`userData`; runtime deck compiler; packaged editor + preview + play + PDF via
compiled decks; dev/packaged unification.

**Out of scope (future):** the future "app editor" tool (will reuse the same
`ai.run` capability — that's why it's shell-level); opencode `serve`+SSE upgrade;
adding providers beyond the three; per-tool provider overrides (global only for
now); fine-grained HMR in the packaged preview (full reload per turn is fine).

## Risks / open items to validate in the plan

1. **External-module wiring** (deck bundle ↔ host `vue`+engine via import
   map/blob). Highest-uncertainty piece; prototype first.
2. **Deck import conventions.** Template scaffolds `../../engine` imports; the
   compiler must alias these reliably. Confirm all example/template imports.
3. **App size.** Adding `@vue/compiler-sfc` + relying on esbuild — measure the
   `.app` delta (expected ~10–20 MB).
4. **CLI schema drift.** Codex/opencode JSON event shapes are
   generated/lightly-documented; lock to the shipped version via fixtures and a
   version check.
5. **Decks-in-userData migration.** Seed example deck on first run; migrate any
   existing dev decks from `src/presentations` backup.

## Decisions made (during brainstorming)

- Transport: **A — uniform subprocess adapters** (headless JSON per CLI), not
  per-provider servers, not provider SDKs.
- Settings: **predefined providers + editable binary path + model, single global
  active provider, Test button.**
- Parity target: **same capability regardless of provider**, normalized to
  `ChatEvent`; divergences handled in-adapter + documented.
- Packaged editing: **P2-A — decks in `userData` (Application Support) + runtime
  esbuild + `@vue/compiler-sfc` compilation**; not shipping Vite (P2-B), not a
  declarative deck rewrite (P2-C).
- Combined Phase 1 + Phase 2 in a single spec, per user request.
