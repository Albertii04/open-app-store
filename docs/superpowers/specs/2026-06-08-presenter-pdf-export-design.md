# Presenter — Export to PDF (share dropdown)

**Date:** 2026-06-08
**Status:** Approved design

## Goal

In the presenter tool, the "Compartir" button currently exports a presentation
as a `.zip` project. Add a dropdown so the user can choose between:

1. **Exportar proyecto (.zip)** — existing flow, unchanged.
2. **Exportar PDF** — new flow: render the deck to a PDF, one slide per page,
   full visual fidelity.

## Decisions (from brainstorming)

- **PDF content:** slides rendered exactly as in the live deck (16:9), one slide
  per page. Maximum visual fidelity.
- **Reveals/steps:** final state — all `[data-reveal]` content visible, no
  animation. One page per slide (not one page per reveal step).
- **UI:** the "Compartir" button click opens a menu with the two options
  (not a split button, not an immediate default action).
- **Render mechanism:** a hidden `BrowserWindow` reuses the *same* URL loading as
  the current presenter tool window (dev server or `file://` build), adding only
  `?export=<presId>`.

## Approach

Electron `webContents.printToPDF()` on an offscreen `BrowserWindow` that loads the
presenter renderer in a dedicated "export" mode. This uses the real Vue render so
the PDF is pixel-identical to the live deck, and reuses the dialog + IPC plumbing
already used by zip export.

Rejected alternatives:
- **html-to-canvas + jspdf** in the renderer — fragile font/scaling/GSAP issues,
  no native page sizing.
- **vite build + puppeteer** — heavy (full build per export), large dependency.

## Components

### 1. UI dropdown — `apps/tools/presenter/src/CodeEditor.vue`

- Replace the single-action `Compartir` button with a button that toggles a small
  popover menu, styled to match existing `.ce-share`.
- Menu items:
  - **Exportar proyecto (.zip)** → existing `share()` (calls
    `authoring.exportPresentation(presId)`).
  - **Exportar PDF** → new `exportPdf()` (calls
    `authoring.exportPresentationPdf(presId)`).
- Menu closes on outside-click and Esc.
- `sharing` ref gates both actions; both push the same success/error toast pattern
  via `pushMsg`. Label shows `Exportando…` while busy.

### 2. Renderer export mode — `ExportDeck.vue` (new) + app entry detection

- On app load, detect `?export=<presId>` in the URL.
  - If present: render `ExportDeck` fullscreen instead of the normal presenter UI.
- `ExportDeck.vue`:
  - Loads the same `Presentation` for `presId` used by the live deck.
  - Renders every `SlideEntry.component` in document order, each inside a stage box
    sized to the deck aspect ratio (16:9), applying the presentation `theme.vars`.
  - Each slide box uses CSS `break-after: page` so each becomes one PDF page.
  - No GSAP, no transitions: `[data-reveal]` elements sit at their natural visible
    (final) state.
  - After all slides mount and `document.fonts.ready` resolves, signals the main
    process that it is ready to print (IPC, e.g. `authoringExportReady`).

### 3. Main process — `apps/desktop/src/main/authoring.ts`

New `exportPresentationPdf(presId)`:
1. Show a native save dialog filtered to `.pdf` (mirror of the zip dialog).
2. Create a hidden `BrowserWindow` (`show: false`), loading the tool renderer with
   the **same URL logic as the existing tool window**, plus `?export=<presId>`.
3. Wait for the renderer's `export-ready` signal.
4. Call `webContents.printToPDF({ landscape: true, printBackground: true,
   pageSize: <custom 16:9>, margins: 0 })`.
5. Write the buffer to the chosen path, close the hidden window, return the path.

### 4. IPC wiring

- New channel `authoringExportPdf` (mirror of `authoringExport`):
  - `apps/desktop/src/main/broker.ts` — `ipcMain.handle` with `authorize(...,
    'authoring')` then call `exportPresentationPdf(presId)`.
  - `apps/desktop/src/preload/tool.ts` — expose `exportPresentationPdf(presId)` via
    `ipcRenderer.invoke(IPC.authoringExportPdf, presId)`.
  - Add `authoringExportPdf` (and the renderer→main `authoringExportReady`) to the
    shared `IPC` channel constants.

## Data flow

```
click Compartir → menu opens → click "Exportar PDF"
  → exportPdf() → preload invoke(authoringExportPdf, presId)
  → broker authorize → main.exportPresentationPdf:
       save dialog → hidden BrowserWindow(?export=presId)
       → renderer renders ExportDeck → 'export-ready'
       → printToPDF → write file
  → path returned → success toast
```

## Reused, unchanged

- `Presentation` / `SlideEntry` / `ThemeTokens` types (`engine/types.ts`).
- Theme system (`theme.vars`, wordmark).
- Existing zip export path and its dialog/IPC pattern (used as the template).

## Error handling

- Same try/catch + toast pattern as `share()`: errors push a `role: 'error'`
  message; `sharing` always reset in `finally`.
- If the save dialog is cancelled, return without writing (no error).
- Hidden window always closed (success or failure).

## Testing

- Export a known presentation to PDF; verify page count == slide count.
- Verify a slide with `[data-reveal]` content shows all content (final state).
- Verify theme colors/background present (`printBackground`) and 16:9 aspect.
- Verify zip export still works from the new menu (regression).
- Verify dialog cancel produces no file and no error toast.

## Known limitations (v1)

- Slides whose final appearance depends on multi-step GSAP/control state render at
  their default static state, not a simulated last step. Acceptable for v1.
