# Presenter PDF Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Compartir" dropdown in the Presenter code editor that exports a presentation either as the existing `.zip` project or as a new PDF (one slide per page, full visual fidelity).

**Architecture:** A new renderer route `?export=<id>` mounts a dedicated `ExportDeck.vue` that stacks every slide as a fixed 1280×720 page with CSS page breaks and no GSAP (final/static state). The main process opens an offscreen `BrowserWindow` on that route — mirroring the existing `renderThumbnail` pattern — and calls `webContents.printToPDF({ preferCSSPageSize: true })`. New IPC channel `authoringExportPdf` mirrors `authoringExport` through the SDK, broker and preload.

**Tech Stack:** Electron 33 (`webContents.printToPDF`), Vue 3 (renderer), TypeScript, pnpm workspaces + turbo, `@openappstore/sdk` (compiled to `dist/`).

---

## Testing note

This repo has **no unit-test harness** (no vitest/jest in `apps/desktop`, `apps/tools/presenter`, or `packages/sdk`). The touched layers are Electron-runtime + Vue-DOM integration code that the codebase already verifies manually (the existing zip export and thumbnail render have no tests). Accordingly, each task is verified with **`typecheck`** plus a **manual run** of the app — not TDD. Adding a test framework is out of scope (YAGNI).

## File Structure

| File | Responsibility | Action |
|---|---|---|
| `packages/sdk/src/ipc.ts` | IPC channel name constants | Modify — add `authoringExportPdf` |
| `packages/sdk/src/api.ts` | `ToolboxApi.authoring` type | Modify — add `exportPresentationPdf` |
| `apps/desktop/src/main/authoring.ts` | Privileged authoring host (export/render) | Modify — add `exportPresentationPdf()` |
| `apps/desktop/src/main/broker.ts` | IPC handlers + capability auth | Modify — import + handle new channel |
| `apps/desktop/src/preload/tool.ts` | Renderer-facing `toolbox` API | Modify — add `exportPresentationPdf` |
| `apps/tools/presenter/src/engine/ExportDeck.vue` | Stacked all-slides print view | **Create** |
| `apps/tools/presenter/src/engine/index.ts` | Engine public exports | Modify — export `ExportDeck` |
| `apps/tools/presenter/src/main.ts` | Renderer route boot | Modify — add `?export=<id>` route |
| `apps/tools/presenter/src/CodeEditor.vue` | Editor UI (share button) | Modify — dropdown + `exportPdf()` |

---

### Task 1: SDK — new IPC channel + API type

**Goal:** Declare the `authoringExportPdf` channel and the `exportPresentationPdf` method on the shared `ToolboxApi` type, then rebuild the SDK so consumers see them.

**Files:**
- Modify: `packages/sdk/src/ipc.ts:28-29`
- Modify: `packages/sdk/src/api.ts:99` (after `exportPresentation`)

**Acceptance Criteria:**
- [ ] `IPC.authoringExportPdf` exists with value `'toolbox:authoring.exportPdf'`.
- [ ] `ToolboxApi.authoring.exportPresentationPdf(presId)` typed `Promise<string | null>`.
- [ ] `pnpm --filter @openappstore/sdk build` succeeds and `packages/sdk/dist/ipc.js` contains `exportPdf`.

**Verify:** `pnpm --filter @openappstore/sdk build && grep -q "authoring.exportPdf" packages/sdk/dist/ipc.js && echo OK`

**Steps:**

- [ ] **Step 1: Add the IPC channel**

In `packages/sdk/src/ipc.ts`, add the line after `authoringExport` (line 28):

```ts
  authoringExport: 'toolbox:authoring.export',
  authoringExportPdf: 'toolbox:authoring.exportPdf',
  authoringImport: 'toolbox:authoring.import',
```

- [ ] **Step 2: Add the API method**

In `packages/sdk/src/api.ts`, immediately after the `exportPresentation` declaration (line 99), add:

```ts
    exportPresentation(presId: string): Promise<string | null>;
    /** Export the presentation to a PDF, one slide per page (opens a native
     *  save dialog). Returns the saved path, or null if cancelled. */
    exportPresentationPdf(presId: string): Promise<string | null>;
```

- [ ] **Step 3: Rebuild the SDK**

The SDK resolves via `exports` to `./dist/…`, so consumers (desktop main + preload) only see the change after a build.

Run: `pnpm --filter @openappstore/sdk build`
Expected: exits 0, no type errors.

- [ ] **Step 4: Verify the compiled output**

Run: `grep -q "authoring.exportPdf" packages/sdk/dist/ipc.js && echo OK`
Expected: `OK`

- [ ] **Step 5: Commit**

```bash
git add packages/sdk/src/ipc.ts packages/sdk/src/api.ts packages/sdk/dist
git commit -m "feat(sdk): add authoringExportPdf channel and API type"
```

---

### Task 2: Main — `exportPresentationPdf` in authoring.ts

**Goal:** Render every slide of a deck to a one-page-per-slide PDF via an offscreen window and save it through a native dialog.

**Files:**
- Modify: `apps/desktop/src/main/authoring.ts` (add function after `exportPresentation`, ~line 336)

**Acceptance Criteria:**
- [ ] `exportPresentationPdf(presId)` is exported.
- [ ] Shows a `.pdf` save dialog; returns `null` on cancel.
- [ ] Opens an offscreen `BrowserWindow` on `<previewUrl>?export=<presId>`, prints to PDF, writes the file, always destroys the window.
- [ ] No new imports needed (reuses `BrowserWindow`, `dialog`, `readFileSync`, `writeFileSync`, `rm`, `getPreviewUrl`, `slugify`, `presentationsDir`).

**Verify:** `pnpm --filter @openappstore/desktop typecheck` → passes. (Runtime verified manually in Task 5.)

**Steps:**

- [ ] **Step 1: Add the function**

In `apps/desktop/src/main/authoring.ts`, insert immediately after the closing brace of `exportPresentation` (after line 336, before the `const IMPORT_SKIP` line):

```ts
/**
 * Export a presentation to a PDF — one slide per page, rendered exactly as the
 * live deck (final/static state, no animation). Opens an offscreen window on the
 * Presenter's `?export=<id>` route and prints it. Dev-only: getPreviewUrl()
 * needs the dev server (like the zip export and thumbnails). Returns the saved
 * path, or null if the user cancelled.
 */
export async function exportPresentationPdf(presId: string): Promise<string | null> {
  const presFolder = join(presentationsDir(), presId)
  let name = presId
  try {
    name = JSON.parse(readFileSync(join(presFolder, 'presentation.json'), 'utf8')).name || presId
  } catch {
    /* fall back to the id */
  }
  const slug = slugify(name)

  const res = await dialog.showSaveDialog({
    title: 'Exportar presentación a PDF',
    defaultPath: `${slug}.pdf`,
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
  })
  if (res.canceled || !res.filePath) return null
  const dest = res.filePath

  // Throws if packaged (no dev server) — surfaced to the user as an error toast.
  const base = await getPreviewUrl()
  const win = new BrowserWindow({
    show: false,
    width: 1280,
    height: 720,
    paintWhenInitiallyHidden: true,
    webPreferences: { offscreen: false, backgroundThrottling: false },
  })
  try {
    await win.loadURL(`${base}?export=${presId}`)
    // Let webfonts load and slides settle before printing (mirrors renderThumbnail).
    await new Promise((r) => setTimeout(r, 1500))
    const pdf = await win.webContents.printToPDF({
      printBackground: true,
      preferCSSPageSize: true, // honour ExportDeck's @page { size: 13.333in 7.5in }
      margins: { top: 0, bottom: 0, left: 0, right: 0 },
    })
    await rm(dest, { force: true })
    writeFileSync(dest, pdf)
    return dest
  } finally {
    win.destroy()
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @openappstore/desktop typecheck`
Expected: passes (no errors). Note: this typechecks main against the SDK `dist` from Task 1.

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/main/authoring.ts
git commit -m "feat(desktop): exportPresentationPdf renders deck to one-page-per-slide PDF"
```

---

### Task 3: Wire IPC — broker handler + preload method

**Goal:** Expose `exportPresentationPdf` to the renderer through the broker (with `authoring` capability auth) and the preload bridge.

**Files:**
- Modify: `apps/desktop/src/main/broker.ts:15` (import) and `:205-208` (handler)
- Modify: `apps/desktop/src/preload/tool.ts:52` (authoring object)

**Acceptance Criteria:**
- [ ] Broker handles `IPC.authoringExportPdf`, calling `authorize(..., 'authoring')` then `exportPresentationPdf(presId)`.
- [ ] Preload exposes `authoring.exportPresentationPdf(presId)` via `ipcRenderer.invoke`.

**Verify:** `pnpm --filter @openappstore/desktop typecheck` → passes.

**Steps:**

- [ ] **Step 1: Import the function in the broker**

In `apps/desktop/src/main/broker.ts`, add `exportPresentationPdf,` to the import block from `./authoring.js` (alongside `exportPresentation`):

```ts
  setSourcePath,
  saveAttachment,
  exportPresentation,
  exportPresentationPdf,
  importPresentation,
```

- [ ] **Step 2: Add the broker handler**

In `apps/desktop/src/main/broker.ts`, add immediately after the `IPC.authoringExport` handler (after line 208):

```ts
  ipcMain.handle(IPC.authoringExport, (e, presId: string) => {
    authorize(e.sender.id, 'authoring')
    return exportPresentation(presId)
  })
  ipcMain.handle(IPC.authoringExportPdf, (e, presId: string) => {
    authorize(e.sender.id, 'authoring')
    return exportPresentationPdf(presId)
  })
```

- [ ] **Step 3: Expose it in the preload**

In `apps/desktop/src/preload/tool.ts`, add after the `exportPresentation` line (line 52):

```ts
    exportPresentation: (presId) => ipcRenderer.invoke(IPC.authoringExport, presId),
    exportPresentationPdf: (presId) => ipcRenderer.invoke(IPC.authoringExportPdf, presId),
```

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @openappstore/desktop typecheck`
Expected: passes.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/main/broker.ts apps/desktop/src/preload/tool.ts
git commit -m "feat(desktop): wire authoringExportPdf through broker and preload"
```

---

### Task 4: Renderer — `ExportDeck.vue` + `?export` route

**Goal:** Add a print-oriented view that renders all slides stacked (one 1280×720 page each, static/final state) and a renderer route that mounts it.

**Files:**
- Create: `apps/tools/presenter/src/engine/ExportDeck.vue`
- Modify: `apps/tools/presenter/src/engine/index.ts`
- Modify: `apps/tools/presenter/src/main.ts:8` (import) and `:46` (route)

**Acceptance Criteria:**
- [ ] `ExportDeck.vue` renders one `.export-page` (1280×720) per slide, each containing the slide component inside the global `.slide-host`, with `break-after: page` and an `@page { size: 13.333in 7.5in; margin: 0 }` rule.
- [ ] No GSAP / no deck navigation runs (slides render at their natural static state; `[data-reveal]` elements stay visible since they are only hidden by the deck's GSAP, not by CSS).
- [ ] `ExportDeck` is exported from `engine/index.ts`.
- [ ] Visiting `<dev-server>?export=<id>` mounts `ExportDeck` for that presentation.

**Verify:** `pnpm --filter @openappstore/presenter typecheck` → passes; manual route check in Task 5.

**Steps:**

- [ ] **Step 1: Create `ExportDeck.vue`**

Create `apps/tools/presenter/src/engine/ExportDeck.vue`:

```vue
<script setup lang="ts">
import type { Presentation } from './types'

const props = defineProps<{ presentation: Presentation }>()
const slides = props.presentation.slides
const themeVars = props.presentation.theme?.vars ?? {}
</script>

<template>
  <!-- One fixed 1280×720 page per slide. The deck's GSAP never runs here, so
       [data-reveal] content sits at its natural (visible) state = final look.
       theme.vars supply --deck-bg and the palette, exactly like the live deck. -->
  <div class="export-root" :style="themeVars">
    <section v-for="(s, i) in slides" :key="i" class="export-page">
      <div class="slide-host">
        <component :is="s.component" />
      </div>
    </section>
  </div>
</template>

<style>
/* 16:9 page at 1280×720 = 13.333in × 7.5in @96dpi. Electron printToPDF with
   preferCSSPageSize:true honours this; one .export-page == one PDF page. */
@page { size: 13.333in 7.5in; margin: 0; }
html, body { margin: 0; }
.export-page {
  position: relative;
  width: 1280px;
  height: 720px;
  overflow: hidden;
  background: var(--deck-bg, var(--bg-canvas));
  break-after: page;
  page-break-after: always;
}
.export-page:last-child { break-after: auto; page-break-after: auto; }
</style>
```

- [ ] **Step 2: Export it from the engine**

In `apps/tools/presenter/src/engine/index.ts`, add after the `AudienceDeck` export:

```ts
export { default as AudienceDeck } from './AudienceDeck.vue'
export { default as ExportDeck } from './ExportDeck.vue'
```

- [ ] **Step 3: Import ExportDeck in main.ts**

In `apps/tools/presenter/src/main.ts`, extend the engine import (line 3):

```ts
import { AudienceDeck, PresenterConsole, ExportDeck } from './engine'
```

- [ ] **Step 4: Add the `?export` route**

In `apps/tools/presenter/src/main.ts`, inside `boot()`, add this block immediately before the `const presId = params.get('pres')` line (line 46):

```ts
  const exportId = params.get('export')
  if (exportId) {
    const p = getPresentation(exportId)
    if (p) {
      document.title = `${p.meta.name} — export`
      createApp(ExportDeck, { presentation: p }).mount('#app')
      return
    }
  }
  const presId = params.get('pres')
```

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @openappstore/presenter typecheck`
Expected: passes.

- [ ] **Step 6: Commit**

```bash
git add apps/tools/presenter/src/engine/ExportDeck.vue apps/tools/presenter/src/engine/index.ts apps/tools/presenter/src/main.ts
git commit -m "feat(presenter): ExportDeck stacked print view + ?export route"
```

---

### Task 5: UI — "Compartir" dropdown + `exportPdf()`

**Goal:** Turn the single-action "Compartir" button into a dropdown with "Exportar proyecto (.zip)" (existing) and "Exportar PDF" (new), wired to the preload methods.

**Files:**
- Modify: `apps/tools/presenter/src/CodeEditor.vue` — `Authoring` interface (~line 33), script (~line 148-161), button markup (line 535-548), styles (after line 1014)

**Acceptance Criteria:**
- [ ] Clicking "Compartir" opens a menu with two items; it does not export immediately.
- [ ] "Exportar proyecto (.zip)" runs the existing export; "Exportar PDF" calls `authoring.exportPresentationPdf`.
- [ ] Menu closes on item click, outside (backdrop) click, and Esc.
- [ ] Both actions share the `sharing` gate and push the same toast pattern; label shows `Exportando…` while busy.

**Verify:** `pnpm --filter @openappstore/presenter typecheck` → passes. Then manual run (below).

**Steps:**

- [ ] **Step 1: Extend the `Authoring` interface**

In `apps/tools/presenter/src/CodeEditor.vue`, add the method after `exportPresentation` (line 33):

```ts
  exportPresentation(presId: string): Promise<string | null>
  exportPresentationPdf(presId: string): Promise<string | null>
```

- [ ] **Step 2: Replace the `share()` function with menu state + two actions**

Replace the whole `share()` block (lines 148-161) with:

```ts
const sharing = ref(false)
const shareMenuOpen = ref(false)
function toggleShareMenu(): void {
  if (!sharing.value) shareMenuOpen.value = !shareMenuOpen.value
}
function closeShareMenu(): void {
  shareMenuOpen.value = false
}
async function exportZip(): Promise<void> {
  closeShareMenu()
  if (sharing.value || !authoring) return
  sharing.value = true
  try {
    const path = await authoring.exportPresentation(props.presId)
    if (path) pushMsg({ role: 'tool', text: 'Exportado: ' + path })
  } catch (e) {
    pushMsg({ role: 'error', text: 'No se pudo exportar: ' + String(e) })
  } finally {
    sharing.value = false
    scroll()
  }
}
async function exportPdf(): Promise<void> {
  closeShareMenu()
  if (sharing.value || !authoring) return
  sharing.value = true
  try {
    const path = await authoring.exportPresentationPdf(props.presId)
    if (path) pushMsg({ role: 'tool', text: 'Exportado PDF: ' + path })
  } catch (e) {
    pushMsg({ role: 'error', text: 'No se pudo exportar el PDF: ' + String(e) })
  } finally {
    sharing.value = false
    scroll()
  }
}
```

- [ ] **Step 3: Close the menu on Esc**

In `CodeEditor.vue`, find the `onMounted(` block that calls `window.addEventListener('message', onDeckMsg)` (line 187) and the matching `onUnmounted` (line 250). Add an Esc handler.

Add this function next to `closeShareMenu` (from Step 2):

```ts
function onShareKey(e: KeyboardEvent): void {
  if (e.key === 'Escape') closeShareMenu()
}
```

In `onMounted`, after the existing `window.addEventListener('message', onDeckMsg)`:

```ts
  window.addEventListener('message', onDeckMsg)
  window.addEventListener('keydown', onShareKey)
```

In `onUnmounted`, after the existing `window.removeEventListener('message', onDeckMsg)`:

```ts
  window.removeEventListener('message', onDeckMsg)
  window.removeEventListener('keydown', onShareKey)
```

- [ ] **Step 4: Replace the button markup with the dropdown**

In `CodeEditor.vue`, replace the whole `<button class="ce-share" …>…</button>` element (lines 535-548) with:

```vue
          <div class="ce-share-wrap">
            <button
              class="ce-share"
              title="Compartir presentación"
              :disabled="sharing"
              @click="toggleShareMenu"
            >
              <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="18" cy="5" r="3" />
                <circle cx="6" cy="12" r="3" />
                <circle cx="18" cy="19" r="3" />
                <path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4" />
              </svg>
              <span>{{ sharing ? 'Exportando…' : 'Compartir' }}</span>
            </button>
            <template v-if="shareMenuOpen">
              <div class="ce-share-backdrop" @click="closeShareMenu"></div>
              <div class="ce-share-menu" role="menu">
                <button class="ce-share-item" @click="exportZip">Exportar proyecto (.zip)</button>
                <button class="ce-share-item" @click="exportPdf">Exportar PDF</button>
              </div>
            </template>
          </div>
```

- [ ] **Step 5: Add the dropdown styles**

In `CodeEditor.vue`, add after the `.ce-share:disabled { … }` rule (after line 1014):

```css
.ce-share-wrap {
  position: relative;
}
.ce-share-backdrop {
  position: fixed;
  inset: 0;
  z-index: 40;
}
.ce-share-menu {
  position: absolute;
  top: calc(100% + 4px);
  right: 0;
  z-index: 41;
  min-width: 210px;
  display: flex;
  flex-direction: column;
  padding: 0.25rem;
  background: var(--slate-900);
  border: 1px solid var(--rule);
  border-radius: 4px;
  box-shadow: 0 8px 24px -8px rgba(0, 0, 0, 0.6);
}
.ce-share-item {
  text-align: left;
  padding: 0.42rem 0.6rem;
  border-radius: 3px;
  font-size: 0.72rem;
  color: var(--fg-secondary);
}
.ce-share-item:hover {
  background: var(--slate-800, rgba(255, 255, 255, 0.06));
  color: var(--fg-primary);
}
```

- [ ] **Step 6: Typecheck**

Run: `pnpm --filter @openappstore/presenter typecheck`
Expected: passes.

- [ ] **Step 7: Manual run — full feature verification**

Restart the desktop dev app so the rebuilt SDK + main/preload changes load:

```bash
# stop the running dev app, then:
pnpm dev
```

In the app:
1. Open a user presentation in the code editor (the AI editor view).
2. Click **Compartir** → the menu appears with two items (no immediate export).
3. Click **Exportar proyecto (.zip)** → save dialog appears, zip still exports (regression check). Cancel or save.
4. Click **Compartir** → **Exportar PDF** → save dialog (`.pdf`) appears; choose a path.
5. Open the saved PDF. Verify:
   - Page count == slide count.
   - Each page shows the slide at 16:9 with theme background/colors (`printBackground`).
   - `[data-reveal]` content is fully visible (final state).
6. Press **Compartir**, then **Esc** and an outside click — menu closes both ways.

Expected: all pass. (Known v1 limit: slides whose final look depends on multi-step GSAP/control state render at their default static state.)

- [ ] **Step 8: Commit**

```bash
git add apps/tools/presenter/src/CodeEditor.vue
git commit -m "feat(presenter): Compartir dropdown with PDF export option"
```

---

## Self-Review

**Spec coverage:**
- Dropdown (click opens menu, zip + PDF) → Task 5. ✓
- PDF = slides as-is, 1 per page, full fidelity → Task 4 (`ExportDeck`) + Task 2 (`printToPDF`). ✓
- Reveals = final state, 1 page/slide → Task 4 (no GSAP, `break-after: page`). ✓
- Hidden window reuses same URL + `?export=presId` → Task 2 (`getPreviewUrl()` + `?export`). ✓
- IPC mirror of `authoringExport` → Tasks 1 & 3. ✓
- Reuse types/theme, zip path unchanged → Task 4 (types/theme), Task 5 keeps `exportPresentation`. ✓

**Spec deviation (intentional):** The spec mentioned an `authoringExportReady` IPC handshake from renderer to main. This plan instead uses a **fixed 1500ms settle delay** before `printToPDF`, mirroring the proven `renderThumbnail` pattern already in `authoring.ts`. Simpler, one fewer channel, consistent with existing code. No `authoringExportReady` channel is added.

**Placeholder scan:** none — every step contains the real code/command.

**Type consistency:** `exportPresentationPdf(presId: string): Promise<string | null>` is identical across SDK type (Task 1), preload (Task 3), and the `Authoring` interface (Task 5). Channel `IPC.authoringExportPdf` is used identically in broker (Task 3) and preload (Task 3). Route param `export` matches between `ExportDeck` mount (Task 4) and the main-process URL `?export=${presId}` (Task 2).

## Build-order notes

- Task 1 must build the SDK (`pnpm --filter @openappstore/sdk build`) before Tasks 2–3 typecheck, because desktop imports the SDK from `dist/`.
- The Presenter renderer is served by the authoring dev server (port 5199) spawned on demand; the offscreen export window loads a fresh page each call, so renderer changes (Task 4) are picked up without a manual presenter rebuild. The **desktop** app must be restarted after Tasks 1–3 (main/preload + SDK changes).
