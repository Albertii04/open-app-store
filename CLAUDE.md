# CLAUDE.md — Alberts Toolbox (monorepo)

Project memory for Claude Code. Read this before touching anything.

## What this is

An open-source **Electron toolbox**: a desktop shell hosting many independent,
sandboxed **web tools**, with a git-based marketplace. Approach and full design
live in **`docs/superpowers/specs/2026-06-01-toolbox-design.md`** — read it first
for the why; this file is the operational map.

History: the repo started as a single presentation deck (Concep/Primlux). On
2026-06-01 it became a monorepo; the deck is now `tools/deck` (tool #1). Two dead
prototypes (a single-file HTML deck and a Slidev build) were deleted — do not
recreate them.

## Layout

```
apps/shell              Electron shell (main + preload + Vue renderer)
packages/sdk            @toolbox/sdk — manifest schema, capability model, window.toolbox typings, IPC names
packages/tool-host      @toolbox/tool-host — node-side registry: scan tool folders, validate manifests
tools/deck              the deck; has its own CLAUDE.md with deck-specific context
templates/tool-starter  minimal build-free tool to copy from
registry/index.json     marketplace catalog stub (future: its own public repo)
docs/superpowers/specs  design docs
```

Tooling: **pnpm workspaces + Turborepo**. Node ≥ 20. The shell uses
**electron-vite** (main/preload/renderer) and **electron-builder** (packaging).

## Key invariants — do not break these

- **The capability broker is the security spine.** Every native action a tool
  takes goes through `apps/shell/src/main/broker.ts`, which authorizes the call
  against the calling tool's manifest (`hasCapability`). Never add a native IPC
  handler that skips `authorize()`.
- **Tools are isolated.** Each tool runs in its own `WebContentsView` with
  `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`. Don't
  load tool code into the shell renderer or relax these flags.
- **Two preloads, two audiences.** `preload/shell.ts` → `window.shellApi` for the
  shell UI only. `preload/tool.ts` → `window.toolbox` for tools only. Keep them
  separate; the shell UI must never get the tool API and vice versa.
- **The manifest schema lives in `@toolbox/sdk`.** Capabilities, validation, and
  the `window.toolbox` shape are defined once there and imported everywhere.
  Change the contract there, not ad hoc in the shell.
- **Tools load as built artifacts** (`file://` to `dist/index.html`). A tool's
  Vite `base` must be `./` so assets resolve under `file://`.
- **`storage` and `net` are constrained:** storage is per-tool-id scoped; net is
  domain-allowlisted from the manifest. Don't widen these.

## Common tasks

- **Run it:** `pnpm install && pnpm build && pnpm dev`. Build before dev — the
  shell loads built tool artifacts, not dev servers.
- **Iterate the deck UI in a browser:** `pnpm dev:deck` (see `tools/deck/CLAUDE.md`).
- **Add a capability:** add the name to `CAPABILITY_NAMES` in
  `packages/sdk/src/manifest.ts`, add an IPC channel in `ipc.ts`, expose it in
  `preload/tool.ts` and the `ToolboxApi` in `api.ts`, implement + `authorize()`
  it in `broker.ts`.
- **Add a tool:** copy `templates/tool-starter/` to `tools/<name>/`, set the
  manifest, build. The registry scan picks it up.
- **Package:** `pnpm --filter @toolbox/shell package`.

## Gitflow

`main` (release) ← `develop` (integration) ← `feature/*`. CI builds/typechecks/
lints on PR and on main/develop. Tagging `v*` on main triggers cross-platform
packaged releases. Details in `CONTRIBUTING.md`. Commit/push only when asked.

## Status & phasing

Phase 1 (done): monorepo, gitflow/CI, SDK + tool-host, shell that boots & loads
the deck with the broker wired, marketplace stub. Phases 2–4 (scaffolder,
install prompt UI, live third-party install, signing) are in the spec. When you
finish a phase, update the spec's Status/Phasing and this file.

## The deck tool

`tools/deck` keeps its own `CLAUDE.md` and `README.md` with the presentation's
context (Concep workshop, Primlux voice, slide manifest, presenter mode). Read
those before editing the deck. Its paths changed in the migration: it now lives
at `tools/deck`, images symlink is `tools/deck/public/images -> ../images`.
