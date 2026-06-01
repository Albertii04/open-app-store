# Albert's Toolbox — design

**Date:** 2026-06-01
**Author:** Albert Marimón (with Claude)
**Status:** approved, phase 1 in implementation

## Summary

An open-source **Electron toolbox**: a desktop shell that hosts many small,
independent **web tools**. Each tool is sandboxed in its own view and can only
touch native capabilities it declares in a manifest, brokered by the shell. A
**git-based marketplace** (a JSON catalog in a public GitHub repo, zero backend)
lets anyone publish a tool by pull request and lets users browse/install.

The existing Concep/Primlux presentation deck becomes the first tool
(`primlux.deck`), proving the model end to end.

Chosen approach: **A — isolated views + git registry** (vs B web-route monolith,
C npm dynamic import). Only A satisfies *public + untrusted + native-capable +
no backend*; B and C cannot safely run untrusted third-party tools because they
share one renderer/process.

## Goals

- A tool is **fast to author** — minimum viable tool is a `toolbox.json` + one
  HTML file, no build step required.
- Tools are **isolated** — a tool cannot read another tool's data, touch the
  shell, or reach native APIs it didn't declare.
- The marketplace needs **no server** — a JSON index in a GitHub repo, bundles
  shipped as GitHub Release zips, contribution via PR.
- Cross-platform packaged binaries (mac / win / linux) via automated releases.

## Non-goals (for now)

- Third-party install from day one — **first-party tools first**; arbitrary
  third-party install is gated behind the capability prompt and lands once the
  broker is battle-tested.
- Auth, accounts, server-side search, paid tools.
- Code signing / notarization of tool bundles (SHA-pinning + PR review for now).

## Architecture

Monorepo, pnpm workspaces + Turborepo:

```
apps/shell        Electron app (main + preload + Vue renderer)
packages/sdk      @toolbox/sdk — manifest schema, capability model, window.toolbox typings, IPC channel names
packages/tool-host @toolbox/tool-host — node-side tool registry (scan folders, validate manifests)
tools/deck        the presentation, now tool #1 (primlux.deck)
templates/tool-starter  copy-to-start minimal tool
registry/index.json     local stub of the public marketplace catalog
```

### Processes & isolation

- **Main process** owns lifecycle, the `ToolManager`, the `CapabilityBroker`,
  and all native implementations.
- **Shell renderer** (Vue) draws a fixed 248px sidebar + content area (home grid
  / marketplace). It talks to main through `window.shellApi` (a dedicated
  preload), never through the tool API.
- **Each tool** runs in its own `WebContentsView` with `sandbox: true`,
  `contextIsolation: true`, `nodeIntegration: false`. The view is positioned to
  the right of the sidebar; only one tool is visible at a time. The shell
  renderer (and thus the sidebar) is never covered, so navigation/close always
  works.

### The capability spine

1. A tool declares `capabilities` in `toolbox.json`. `[]` = pure web, can do
   nothing native.
2. The tool's preload injects `window.toolbox`; every method is async and
   `ipcRenderer.invoke`s a namespaced channel.
3. The **broker** in main maps each tool view's `webContents.id` → its manifest.
   On every call it looks up the manifest and rejects (`CAPABILITY_DENIED`) if
   the capability wasn't declared. This check is the single security spine.

Capabilities: `fs.read`, `fs.write`, `dialog`, `shell.open`, `clipboard`,
`storage`, `net` (domain-allowlisted), `notifications`, `gpu`.

- **`net`** requires an explicit `{ name: 'net', domains: [...] }` allowlist; the
  broker blocks any host not in it.
- **`storage`** is always scoped to the tool's id (one JSON file per tool under
  `userData/tool-storage/`); tools cannot read each other's keys.

### Tool loading

`@toolbox/tool-host` scans a directory of tool folders, validates each
`toolbox.json` against the SDK schema, resolves the built `entry` to a `file://`
URL. Builtin tools live in `tools/` (dev) or `resources/tools/` (packaged).
Installed tools (future) live in `userData/tools/`.

### Marketplace (git-based, no backend)

- Catalog = `registry/index.json`, eventually its own public repo. Each entry:
  id, name, version, description, author, capabilities, icon URL, **download URL**
  (a GitHub Release zip of the built tool), **sha256**.
- Discover: shell fetches the index, renders a grid.
- Install (future phase): download zip → verify SHA → unzip into
  `userData/tools/<id>/` → read manifest → show capability prompt → enable.
- Publish: contributor PRs an entry + attaches a release. Merge = listed. Same
  shape as Obsidian community plugins / Raycast store.

## Build, dev, packaging

- `pnpm build` → Turborepo builds `sdk` → `tool-host` → `tools/*` → `shell`.
- Shell uses `electron-vite` (main / preload / renderer in one config). Two
  preload entries: `shell` (window.shellApi) and `tool` (window.toolbox).
- Tools are loaded as **built artifacts** (`file://` to `dist/index.html`) — a
  tool's `base` must be `./` so assets resolve under `file://`.
- `pnpm --filter @toolbox/shell package` → electron-builder produces
  dmg/zip/nsis/AppImage; builtin tools ship via `extraResources`.

## Gitflow & CI

- Branches: `main` (release), `develop` (integration), `feature/*`.
- `.github/workflows/ci.yml` — on PR and pushes to main/develop: install, build,
  typecheck, lint.
- `.github/workflows/release.yml` — on `v*` tag: matrix-build packaged binaries
  for mac/win/linux and attach to a GitHub Release.

## Phasing

**Phase 1 (this spec, landing now):** monorepo + Turborepo + gitflow + CI/release
workflows; SDK + tool-host contracts; Electron shell that boots, lists tools,
and loads the deck in an isolated view with the full broker wired; deck migrated
to `tools/deck`; marketplace as a read-only stub; tool-starter template.

**Phase 2:** create-tool scaffolder (`pnpm create-tool`); per-capability install
prompt UI; richer storage; a couple more first-party tools.

**Phase 3:** live marketplace fetch from the public registry repo; third-party
install flow (download → SHA verify → capability consent → enable); update
checks.

**Phase 4:** signing/notarization; optional auto-update; community contribution
docs and registry repo split-out.

## Risks / open questions

- **WebContentsView layout** across multi-DPI / fullscreen / devtools — needs
  testing on real hardware.
- **fs.read/write** currently trust the path the tool passes (gated only by the
  capability). Phase 2 may narrow this to dialog-granted paths only.
- electron-vite ↔ Vite major-version alignment with the deck's Vite 8 — isolated
  per package by pnpm, but watch for hoisting issues.
