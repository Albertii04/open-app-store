import type { ChatEvent } from '../shared/types.js'
import { spawn, type ChildProcess } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { cp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { runAgent } from './ai/run.js'
import { getAiSettings } from './ai/settings.js'
import type { AgentHandle } from './ai/types.js'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { app, BrowserWindow, dialog } from 'electron'
import AdmZip from 'adm-zip'

/** Create `dest` (a .zip) from the single top-level folder inside `staging`. */
function zipFolder(staging: string, dest: string): void {
  const zip = new AdmZip()
  zip.addLocalFolder(staging) // entries keep their `<slug>/…` paths
  zip.writeZip(dest)
}

/** Extract a zip to `destDir`, refusing entries that escape it (zip-slip). */
function extractZip(zipPath: string, destDir: string): void {
  const root = resolve(destDir)
  const zip = new AdmZip(zipPath)
  for (const entry of zip.getEntries()) {
    const target = resolve(root, entry.entryName)
    // Reject any entry that resolves outside the destination ("../" traversal).
    const rel = relative(root, target)
    if (rel.startsWith('..') || isAbsolute(rel))
      throw new Error(`unsafe zip entry: ${entry.entryName}`)
    if (entry.isDirectory) {
      mkdirSync(target, { recursive: true })
    } else {
      mkdirSync(dirname(target), { recursive: true })
      writeFileSync(target, entry.getData())
    }
  }
}

/**
 * Privileged authoring host: runs a single Vite dev server for the Presenter so
 * the editor can show a live (HMR) preview while a presentation's code is edited.
 * Dev-only (needs the source tree); not available in a packaged build yet.
 */
let proc: ChildProcess | null = null
let url: string | null = null
let starting: Promise<string> | null = null

function presenterDir(): string {
  // Source assets the deck compiler + authoring need (template, blocks, engine).
  if (app.isPackaged) return join(process.resourcesPath, 'tools/presenter')
  return resolve(app.getAppPath(), '../tools/presenter')
}
function presentationsDir(): string {
  return join(app.getPath('userData'), 'presentations')
}
function templateDir(): string {
  // Outside src/ so it isn't type-checked or globbed in place; copied into
  // src/presentations/<id>/ where its relative imports (../../engine) resolve.
  return join(presenterDir(), 'template')
}

const USER_PREFIX = 'u-'

// PDF export page size in CSS px: 16:9 at 1280×720 (= 13.333in × 7.5in @96dpi).
const PDF_PAGE_W = 1280
const PDF_PAGE_H = 720

// ---- durable deck backup ----
// User decks live in the (gitignored) source tree so Vite can compile them, so
// they don't survive a repo move/clean or ship in CI builds. Mirror each to a
// durable copy under userData and restore them into the source tree on startup.

function userDecksDir(): string {
  return join(app.getPath('userData'), 'presentations')
}
function safeReaddir(dir: string): string[] {
  try {
    return readdirSync(dir)
  } catch {
    return []
  }
}
// Back up the deck CODE only. Skip read-in-place source material, attachments,
// build output and VCS — that stuff can be huge and may contain symlinks (e.g.
// a downloaded CLI) that make cpSync fail with EINVAL.
const DECK_SKIP = /(^|\/)(node_modules|\.git|dist|attachments|source|__MACOSX)(\/|$)/
const deckFilter = (s: string): boolean => !DECK_SKIP.test(s) && !s.endsWith('.sourcepath')

// Reference material is meant to be read in place (--add-dir), never copied into
// the deck. If the AI editor ignores that and copies a repo in anyway, these
// trees bloat the Vite project (slow HMR) and break backups. After each turn we
// delete any of them found inside the deck. `attachments` is intentionally NOT
// here — it holds real images the deck imports.
const DECK_JUNK = new Set(['node_modules', '.git', '.pnpm-store', 'source', 'dist', 'target', '__MACOSX'])

/** Remove any DECK_JUNK folders the editor created inside a deck (defense vs.
 *  the agent copying reference material in instead of reading it in place). */
async function pruneDeckJunk(presId: string): Promise<void> {
  const walk = async (dir: string): Promise<void> => {
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      if (!e.isDirectory()) continue
      const full = join(dir, e.name)
      if (DECK_JUNK.has(e.name)) await rm(full, { recursive: true, force: true }).catch(() => {})
      else await walk(full)
    }
  }
  await walk(join(presentationsDir(), presId))
}

/** Ensure the userData presentations directory exists. */
export function restoreUserDecks(): void {
  // Decks now live in userData directly — no src-tree sync needed.
  // TODO: seed a bundled example deck for fresh installs
  mkdirSync(presentationsDir(), { recursive: true })
}

/** No-op: decks already live in userData directly; no separate backup needed. */
export function backupUserDecks(): void {
  /* decks now live in userData directly; no separate backup needed */
}

/** Scaffold a new code presentation folder from the template. */
export async function createPresentation(name: string): Promise<{ id: string }> {
  const id = USER_PREFIX + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
  const dest = join(presentationsDir(), id)
  await cp(templateDir(), dest, { recursive: true })
  await writeFile(join(dest, 'presentation.json'), JSON.stringify({ id, name }, null, 2), 'utf8')
  backupUserDecks()
  return { id }
}

/** Remove a user presentation folder (only ids with the user prefix). */
export async function deletePresentation(id: string): Promise<void> {
  if (!id.startsWith(USER_PREFIX)) throw new Error('refusing to delete a non-user presentation')
  await rm(join(presentationsDir(), id), { recursive: true, force: true })
  await rm(join(userDecksDir(), id), { recursive: true, force: true }) // drop the backup too
}

/** Native folder picker; returns the chosen path or null. */
export async function pickFolder(): Promise<string | null> {
  const res = await dialog.showOpenDialog({ properties: ['openDirectory'] })
  return res.canceled || !res.filePaths[0] ? null : res.filePaths[0]
}

/** Register a reference folder Claude reads live (no copy). The path is stored
 *  in the presentation and added to Claude's --add-dir on every turn, so it
 *  reads the original in place — code, CLAUDE.md, design, images — and picks up
 *  later changes with no duplication. Pass '' to clear it. */
export async function setSourcePath(presId: string, srcPath: string): Promise<void> {
  if (!presId.startsWith(USER_PREFIX)) throw new Error('invalid presentation')
  await writeFile(join(presentationsDir(), presId, '.sourcepath'), srcPath.trim(), 'utf8')
}

/** Save an attached file/image into the presentation's attachments/ folder so
 *  the AI editor can Read it. Returns the absolute path of the saved file. */
export async function saveAttachment(
  presId: string,
  name: string,
  dataBase64: string,
): Promise<string> {
  if (!presId.startsWith(USER_PREFIX)) throw new Error('invalid presentation')
  // Strip path separators so a crafted name can't escape the folder.
  const safe = name.replace(/[/\\]/g, '_').replace(/^\.+/, '') || 'archivo'
  const dir = join(presentationsDir(), presId, 'attachments')
  mkdirSync(dir, { recursive: true })
  const dest = join(dir, safe)
  await writeFile(dest, Buffer.from(dataBase64, 'base64'))
  return dest
}

function slugify(name: string): string {
  return (
    name
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '') // strip accents
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'presentacion'
  )
}

/**
 * Export a presentation as a self-contained, runnable Vite project zip. The
 * deck folder depends on the shared engine via relative imports
 * (`../../../engine`), so the export mirrors that layout under `src/` and adds
 * the configs/entry needed to `npm install && npm run dev`. Returns the saved
 * path, or null if the user cancelled.
 */
export async function exportPresentation(presId: string): Promise<string | null> {
  if (!presId.startsWith(USER_PREFIX)) throw new Error('invalid presentation')
  const presFolder = join(presentationsDir(), presId)
  let name = presId
  try {
    name = JSON.parse(readFileSync(join(presFolder, 'presentation.json'), 'utf8')).name || presId
  } catch {
    /* fall back to the id */
  }
  const slug = slugify(name)

  const res = await dialog.showSaveDialog({
    title: 'Exportar presentación',
    defaultPath: `${slug}.zip`,
    filters: [{ name: 'ZIP', extensions: ['zip'] }],
  })
  if (res.canceled || !res.filePath) return null
  const dest = res.filePath

  // mkdtemp creates a uniquely-named dir with safe perms (avoids predictable
  // os-temp paths / symlink races).
  const staging = mkdtempSync(join(tmpdir(), 'toolbox-export-'))
  const root = join(staging, slug)
  const src = join(root, 'src')
  mkdirSync(join(src, 'presentations'), { recursive: true })

  // Copy the shared engine and the deck, preserving the relative-import layout.
  await cp(join(presenterDir(), 'src/engine'), join(src, 'engine'), { recursive: true })
  await cp(presFolder, join(src, 'presentations', presId), {
    recursive: true,
    // Drop internal/heavy bits that aren't part of the shareable code project.
    filter: (s) => !s.includes(`${presId}/attachments`) && !s.endsWith('.sourcepath'),
  })

  // Entry that mounts just this deck (navigable: arrow keys advance slides).
  await writeFile(
    join(src, 'main.ts'),
    `import { createApp } from 'vue'
import './engine/engine.css'
import { AudienceDeck } from './engine'
import presentation from './presentations/${presId}'

createApp(AudienceDeck, { presentation, navigable: true }).mount('#app')
`,
    'utf8',
  )
  await writeFile(
    join(root, 'index.html'),
    `<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${name}</title>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
`,
    'utf8',
  )
  await writeFile(
    join(root, 'package.json'),
    JSON.stringify(
      {
        name: slug,
        private: true,
        version: '1.0.0',
        type: 'module',
        scripts: { dev: 'vite', build: 'vue-tsc -b && vite build', preview: 'vite preview' },
        dependencies: { gsap: '^3.15.0', vue: '^3.5.34' },
        devDependencies: {
          '@vitejs/plugin-vue': '^5.2.1',
          typescript: '~5.9.3',
          'vue-tsc': '^2.1.10',
          vite: '^5.4.11',
        },
      },
      null,
      2,
    ),
    'utf8',
  )
  await writeFile(
    join(root, 'vite.config.ts'),
    `import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({ plugins: [vue()] })
`,
    'utf8',
  )
  await writeFile(
    join(root, 'tsconfig.json'),
    JSON.stringify(
      {
        compilerOptions: {
          target: 'ESNext',
          module: 'ESNext',
          moduleResolution: 'Bundler',
          strict: true,
          jsx: 'preserve',
          resolveJsonModule: true,
          esModuleInterop: true,
          skipLibCheck: true,
          noEmit: true,
          lib: ['ESNext', 'DOM', 'DOM.Iterable'],
        },
        include: ['src'],
      },
      null,
      2,
    ),
    'utf8',
  )
  await writeFile(
    join(root, 'README.md'),
    `# ${name}

Presentación de código (Vue 3 + GSAP) exportada desde Open App Store.
Es un proyecto Vite normal: ábrelo en cualquier editor y edítalo.

## Arrancar

\`\`\`bash
npm install
npm run dev
\`\`\`

Abre la URL que imprime Vite. Flechas ← / → cambian de slide; F = pantalla completa.

## Estructura

- \`src/presentations/${presId}/\` — esta presentación (slides, componentes, tema).
- \`src/engine/\` — motor del deck (transiciones, navegación, chrome).
- \`src/main.ts\` — punto de entrada que monta el deck.
`,
    'utf8',
  )

  // Zip the staging root (so the archive has a single top-level folder).
  await rm(dest, { force: true }) // start clean
  try {
    zipFolder(staging, dest)
  } finally {
    await rm(staging, { recursive: true, force: true })
  }

  return dest
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/**
 * Export a presentation to a PDF — one slide per page, rendered exactly as the
 * live deck (final/static state). Opens an offscreen window on the Presenter's
 * `?export=<id>` route (a vertical stack of 1280×720 pages), screenshots each
 * page via the GPU compositor, then prints those images to the PDF.
 *
 * Why screenshot instead of printing the page directly: Chromium's print path
 * doesn't honour `mask-composite` or `background-clip: text`, so animated glow
 * borders fill solid and gradient-clipped titles leave ghost boxes. capturePage
 * uses the on-screen compositor, so the PDF matches the deck pixel-for-pixel.
 *
 * Dev-only: getPreviewUrl() needs the dev server (like the zip export and
 * thumbnails). Returns the saved path, or null if the user cancelled.
 */
export async function exportPresentationPdf(presId: string): Promise<string | null> {
  if (!presId.startsWith(USER_PREFIX)) throw new Error('invalid presentation')
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
    width: PDF_PAGE_W,
    height: PDF_PAGE_H,
    paintWhenInitiallyHidden: true,
    // Isolated, in-memory session: ExportDeck pre-sets slider state in
    // localStorage, and this keeps it from leaking into the live deck.
    webPreferences: { offscreen: false, backgroundThrottling: false, partition: 'export-pdf' },
  })
  try {
    await win.loadURL(`${base}?export=${presId}`)
    // Wait for webfonts (a fallback font reflows/overlaps), then a settle so slide
    // intro animations reach their final frame before we screenshot.
    await win.webContents.executeJavaScript('document.fonts.ready.then(() => true)')
    await sleep(1500)

    const count = (await win.webContents.executeJavaScript(
      'document.querySelectorAll(".export-page").length',
    )) as number
    if (!count) throw new Error('la presentación no tiene diapositivas')

    // Screenshot each 1280×720 page through the compositor.
    const shots: string[] = []
    for (let i = 0; i < count; i++) {
      await win.webContents.executeJavaScript(`window.scrollTo(0, ${i} * ${PDF_PAGE_H})`)
      await sleep(140)
      const img = await win.webContents.capturePage({
        x: 0,
        y: 0,
        width: PDF_PAGE_W,
        height: PDF_PAGE_H,
      })
      shots.push(img.toPNG().toString('base64'))
    }

    // Replace the DOM with the captured images (one per print page) and print
    // those — plain raster, immune to the print-path CSS gaps noted above.
    await win.webContents.executeJavaScript(`(() => {
      const s = document.createElement('style')
      s.textContent = '@page{size:13.333in 7.5in;margin:0} html,body{margin:0;padding:0;height:auto;width:auto;overflow:visible;background:#fff} #pdfwrap img{display:block;width:${PDF_PAGE_W}px;height:${PDF_PAGE_H}px;break-after:page;page-break-after:always} #pdfwrap img:last-child{break-after:auto;page-break-after:auto}'
      document.head.appendChild(s)
      document.body.innerHTML = '<div id="pdfwrap"></div>'
      return true
    })()`)
    for (const b64 of shots) {
      await win.webContents.executeJavaScript(
        `(() => { const img = new Image(); img.src = 'data:image/png;base64,' + ${JSON.stringify(b64)}; document.getElementById('pdfwrap').appendChild(img); return true })()`,
      )
    }
    await win.webContents.executeJavaScript(
      'Promise.all(Array.from(document.images).map((i) => i.decode().catch(() => {}))).then(() => true)',
    )
    await sleep(250)

    const pdf = await win.webContents.printToPDF({
      printBackground: true,
      preferCSSPageSize: true, // honour the @page { size: 13.333in 7.5in } above
      margins: { top: 0, bottom: 0, left: 0, right: 0 },
    })
    await rm(dest, { force: true })
    writeFileSync(dest, pdf)
    return dest
  } finally {
    win.destroy()
  }
}

const IMPORT_SKIP = /(^|\/)(node_modules|\.git|dist|attachments|__MACOSX)(\/|$)/

/**
 * Older exported decks painted their letterbox with a GLOBAL rule in theme.css
 * (`body`/`#app`/`:root[data-deck]`). That mechanism is gone (it leaked between
 * decks), so such decks now import with no background. Migrate them: lift the
 * background value into the deck's scoped theme.vars (--deck-bg) and strip the
 * global rule. No-op for new-format decks (those already have --deck-bg).
 */
function migrateLegacyTheme(deckDir: string): void {
  const cssPath = join(deckDir, 'theme.css')
  const idxPath = join(deckDir, 'index.ts')
  // Read directly and bail on failure instead of exists()-then-read (no TOCTOU).
  let indexSrc: string
  let cssRaw: string
  try {
    indexSrc = readFileSync(idxPath, 'utf8')
    cssRaw = readFileSync(cssPath, 'utf8')
  } catch {
    return
  }
  if (/--deck-bg/.test(indexSrc) || !/vars\s*:\s*\{/.test(indexSrc)) return

  let bg: string | null = null
  const css = cssRaw.replace(
    /[^{}]*(?:\bbody\b|#app|\[data-deck\])[^{}]*\{[^}]*\}/g,
    (block) => {
      const m = block.match(/background\s*:\s*([^;]+);/)
      if (!m) return block // not a canvas-paint rule — leave it
      if (!bg) bg = m[1].replace(/!important/g, '').replace(/\s+/g, ' ').trim()
      return '' // drop the global paint
    },
  )
  if (!bg) return
  writeFileSync(
    idxPath,
    indexSrc.replace(/vars\s*:\s*\{/, (m) => `${m}\n    '--deck-bg': '${bg}',`),
    'utf8',
  )
  writeFileSync(cssPath, css.replace(/\n{3,}/g, '\n\n'), 'utf8')
}

/** Find the shallowest file named `target` under `dir` (BFS). Returns its
 *  containing directory, or null. Skips heavy/irrelevant folders. */
function findDeckRoot(dir: string, target = 'presentation.json'): string | null {
  const queue: string[] = [dir]
  const SKIP = new Set(['node_modules', '.git', 'dist', 'attachments', '__MACOSX'])
  while (queue.length) {
    const d = queue.shift() as string
    let entries: import('node:fs').Dirent[]
    try {
      entries = readdirSync(d, { withFileTypes: true })
    } catch {
      continue
    }
    if (entries.some((e) => e.isFile() && e.name === target)) return d
    for (const e of entries) if (e.isDirectory() && !SKIP.has(e.name)) queue.push(join(d, e.name))
  }
  return null
}

/** If `dir` holds exactly one (non-junk) subfolder and no files, return it —
 *  unwraps the common "everything inside a single top folder" zip shape. */
function unwrapSingle(dir: string): string {
  try {
    const entries = readdirSync(dir, { withFileTypes: true }).filter((e) => e.name !== '__MACOSX')
    if (entries.length === 1 && entries[0].isDirectory()) return join(dir, entries[0].name)
  } catch {
    /* ignore */
  }
  return dir
}

/** Where imported-but-not-yet-converted source material is kept (read in place
 *  by Claude via --add-dir, like an attached folder). Outside the project tree
 *  so Vite doesn't watch/rebuild on it. */
function importsDir(): string {
  return join(app.getPath('userData'), 'imports')
}

const IMPORT_ANALYSIS_PROMPT = `He importado un .zip cuyo contenido NO tiene el formato exacto de una presentación de Presenter, así que esta presentación está vacía (plantilla) y el material importado está en la carpeta adjunta (--add-dir): léela EN SITIO con Read/Glob/Grep.

Tu tarea ahora (modo análisis, sin editar todavía):
1. Analiza el material y di QUÉ es (un deck de otro framework, un export de PowerPoint/Keynote/Google Slides, HTML/web, imágenes, markdown, código, etc.).
2. Determina si es CONVERTIBLE a una presentación de Presenter (Vue 3 + GSAP sobre este engine) y con qué fidelidad (alta/media/baja). Sé honesto: si no es convertible, dilo claramente y explica por qué y qué haría falta.
3. Si es convertible, PROPÓN un plan de slides concreto para reconstruirla aquí: para cada slide, qué muestra y qué bloque de la librería usar (o si hace falta uno nuevo), más el tema/estilo (paleta, tipografía) que detectes en el material.

Cuando apruebe el plan con "Implementar", lo construyes. Inténtalo siempre que haya algo aprovechable.`

/**
 * Import a presentation from a zip.
 *
 * - "Perfect" zip (contains a real Presenter deck: presentation.json + index.ts):
 *   copied straight into a new presentation, ready to edit. mode = 'ready'.
 * - Anything else (no deck, partial, or some other format): scaffold a blank
 *   deck, stash the unzipped material as a read-in-place source folder, and
 *   return an analysis prompt so the AI editor inspects it, says whether it's
 *   importable, and attempts a conversion. mode = 'ai'.
 *
 * Returns the new id, name and mode (+ prompt for the AI path), or null if
 * cancelled.
 */
export async function importPresentation(): Promise<
  { id: string; name: string; mode: 'ready' | 'ai'; prompt?: string } | null
> {
  const res = await dialog.showOpenDialog({
    title: 'Importar presentación (.zip)',
    properties: ['openFile'],
    filters: [{ name: 'ZIP', extensions: ['zip'] }],
  })
  if (res.canceled || !res.filePaths[0]) return null
  const zipPath = res.filePaths[0]
  const fallbackName = basename(zipPath, '.zip') || 'Presentación importada'

  // mkdtemp: unique dir, safe perms (avoids predictable os-temp paths/races).
  const tmp = mkdtempSync(join(tmpdir(), 'toolbox-import-'))
  try {
    extractZip(zipPath, tmp)

    const deckRoot = findDeckRoot(tmp)
    // "Perfect" = the deck folder also has an index.ts. List the dir instead of
    // an exists()-then-use check (avoids a TOCTOU file race).
    const dirHas = (dir: string, file: string): boolean => {
      try {
        return readdirSync(dir).includes(file)
      } catch {
        return false
      }
    }
    const isPerfect = !!deckRoot && dirHas(deckRoot, 'index.ts')

    if (isPerfect && deckRoot) {
      // Clean Presenter deck → copy straight in.
      const id = USER_PREFIX + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
      const dest = join(presentationsDir(), id)
      await cp(deckRoot, dest, {
        recursive: true,
        filter: (s) => !IMPORT_SKIP.test(s) && !s.endsWith('.sourcepath'),
      })
      let name = fallbackName
      try {
        const meta = JSON.parse(readFileSync(join(dest, 'presentation.json'), 'utf8'))
        name = meta.name || fallbackName
        writeFileSync(
          join(dest, 'presentation.json'),
          JSON.stringify({ ...meta, id, name }, null, 2),
          'utf8',
        )
      } catch {
        writeFileSync(join(dest, 'presentation.json'), JSON.stringify({ id, name }, null, 2), 'utf8')
      }
      migrateLegacyTheme(dest) // recover background from pre-refactor exports
      backupUserDecks()
      return { id, name, mode: 'ready' }
    }

    // Imperfect → scaffold a blank deck and hand the material to the AI editor.
    // Prefer a name from a partial presentation.json if one exists.
    let name = fallbackName
    if (deckRoot) {
      try {
        name = JSON.parse(readFileSync(join(deckRoot, 'presentation.json'), 'utf8')).name || name
      } catch {
        /* keep fallback */
      }
    }
    const { id } = await createPresentation(name)
    const material = unwrapSingle(tmp)
    const importDir = join(importsDir(), id)
    mkdirSync(importsDir(), { recursive: true })
    await cp(material, importDir, {
      recursive: true,
      filter: (s) => !IMPORT_SKIP.test(s),
    })
    await setSourcePath(id, importDir)
    return { id, name, mode: 'ai', prompt: IMPORT_ANALYSIS_PROMPT }
  } finally {
    await rm(tmp, { recursive: true, force: true })
  }
}

/** The registered live source folder for a presentation, or null. */
function sourcePathOf(presId: string): string | null {
  try {
    const p = readFileSync(join(presentationsDir(), presId, '.sourcepath'), 'utf8').trim()
    return p || null
  } catch {
    return null
  }
}

// ---- cover thumbnails ----

function thumbsDir(): string {
  return join(app.getPath('userData'), 'thumbs')
}
function thumbFile(presId: string): string {
  return join(thumbsDir(), `${presId}.jpg`)
}

// Serialize renders — many offscreen windows at once is heavy.
let thumbChain: Promise<unknown> = Promise.resolve()
function queueThumb<T>(fn: () => Promise<T>): Promise<T> {
  const run = thumbChain.then(fn, fn)
  thumbChain = run.catch(() => {})
  return run
}

/** Render the deck's first slide to a JPG (offscreen) and cache it. Returns the
 *  cache file path. Heavy — runs one at a time via queueThumb. */
function renderThumbnail(presId: string): Promise<string> {
  return queueThumb(async () => {
    const base = await getPreviewUrl()
    const win = new BrowserWindow({
      show: false,
      width: 1280,
      height: 720,
      paintWhenInitiallyHidden: true,
      webPreferences: { offscreen: false, backgroundThrottling: false },
    })
    try {
      await win.loadURL(`${base}?pres=${presId}`)
      // Let fonts load and the intro animation settle before capturing.
      await new Promise((r) => setTimeout(r, 1300))
      const img = await win.webContents.capturePage()
      const jpg = img.toJPEG(86)
      mkdirSync(thumbsDir(), { recursive: true })
      writeFileSync(thumbFile(presId), jpg)
      return thumbFile(presId)
    } finally {
      win.destroy()
    }
  })
}

/** Cover image for a presentation as a JPEG data URL. Renders on first request
 *  (or when `force`), otherwise returns the cached render. */
export async function getThumbnail(presId: string, force = false): Promise<string | null> {
  const file = thumbFile(presId)
  try {
    if (force || !existsSync(file)) await renderThumbnail(presId)
    const buf = readFileSync(file)
    return `data:image/jpeg;base64,${buf.toString('base64')}`
  } catch {
    return null
  }
}

// ---- AI editor (Claude Code) ----

// Running chat process per presentation, so it can be stopped.
const chatProc = new Map<string, AgentHandle>()

/** Stop the running AI editor turn for a presentation. */
export function stopChat(presId: string): void {
  chatProc.get(presId)?.stop()
  chatProc.delete(presId)
}

/**
 * Drive a Claude Code session to edit a presentation folder. Spawns `claude -p`
 * with cwd = the folder (confinement), streams parsed progress via `emit`, and
 * resolves when the turn ends. Only Read/Edit/Write/Glob/Grep are allowed (no Bash).
 */
export function sendChat(
  presId: string,
  message: string,
  emit: (e: ChatEvent) => void,
  allowEdits = true,
  resumeSessionId?: string | null,
): Promise<void> {
  return new Promise((resolveP) => {
    const folder = join(presentationsDir(), presId)
    const blocks = join(presenterDir(), 'blocks')
    // A writable, self-growing library where Claude saves new reusable blocks.
    const userBlocks = join(presenterDir(), 'blocks-user')
    mkdirSync(userBlocks, { recursive: true })
    // Resume the conversation's own session if it has one (per-conversation
    // context); absent → first turn → prepend the preamble below.
    const prev = resumeSessionId || undefined
    const source = sourcePathOf(presId)

    const libsLine = `Hay dos librerías de bloques reutilizables: ${blocks} (oficiales) y ${userBlocks} (guardados de antes). LEE ${blocks}/INDEX.md (contrato del engine: SlideEntry, controls, useSliderState, defineExpose) y revisa ambas carpetas.`
    // The user's material is read IN PLACE (no copy): code, CLAUDE.md, diseño,
    // textos, imágenes. Only the images actually used in slides get copied into
    // the presentation, because Vite bundles assets from the project tree.
    const sourceLine = source
      ? `El material de referencia del usuario está en ${source} (carpeta añadida con acceso de lectura). LÉELO EN SITIO con Read/Glob/Grep — código, CLAUDE.md, diseño, textos, imágenes — y NO lo dupliques en la presentación. PROHIBIDO: copiar el repo o partes de él al deck, crear una carpeta source/ dentro de la presentación, o copiar node_modules/.git/código fuente. Excepción ÚNICA: una imagen que vayas a MOSTRAR en una slide, cópiala a assets/ e impórtala (Vite empaqueta desde el proyecto); todo lo demás se queda donde está. Si el usuario añade cosas a esa carpeta luego, las verás en el siguiente turno.`
      : ''

    // First turn of a session: prepend a preamble. In PLAN mode (no edits) Claude
    // analyses + proposes; in BUILD mode it edits/reuses blocks. Later turns resume.
    let prompt = message
    if (!prev) {
      prompt = allowEdits
        ? `Estás editando una presentación de código (Vue 3 + GSAP) sobre el engine de Presenter (cwd). ${sourceLine} ${libsLine} Reutiliza los bloques que encajen copiándolos a la presentación y siguiendo su block.md. Guarda bloques nuevos reutilizables en ${userBlocks}/<nombre>/; NO modifiques los oficiales de ${blocks} salvo que el usuario lo pida. Petición del usuario: ${message}`
        : `Estás PLANIFICANDO una presentación de código (Vue 3 + GSAP) sobre el engine de Presenter (cwd). ${sourceLine} ${libsLine} Tu tarea ahora: ANALIZA el material y PROPÓN un plan de slides concreto — para cada slide, di qué muestra y qué bloque de la librería usar (o si hace falta uno nuevo), y el estilo/tema. NO edites archivos todavía: solo analiza y propón, en texto. El usuario revisará y, cuando dé a "Implementar", lo construyes. Brief del usuario: ${message}`
    }

    const settings = getAiSettings()
    const active = settings.active
    const readDirs = [blocks, userBlocks, source].filter((d): d is string => !!d)

    const handle = runAgent(
      active,
      {
        cwd: folder,
        message: prompt,
        readDirs,
        allowEdits,
        model: settings.providers[active]?.model,
        resumeSessionId: prev ?? null,
      },
      settings.providers[active]?.binPath,
      (ev) => {
        emit(ev)
        if (ev.kind === 'done') {
          // The deck likely changed — prune copied-in junk, then refresh the
          // cover thumbnail + back up.
          void pruneDeckJunk(presId)
            .catch(() => {})
            .finally(() => {
              void renderThumbnail(presId).catch(() => {})
              backupUserDecks()
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
  })
}

export function getPreviewUrl(): Promise<string> {
  if (url) return Promise.resolve(url)
  if (starting) return starting
  if (app.isPackaged)
    return Promise.reject(new Error('authoring dev server only available when running from source'))

  starting = new Promise<string>((res, rej) => {
    let settled = false
    const done = (u: string): void => {
      if (settled) return
      settled = true
      url = u
      res(u)
    }
    const fail = (e: Error): void => {
      if (settled) return
      settled = true
      starting = null
      rej(e)
    }

    const dir = presenterDir()
    const bin = join(dir, 'node_modules/.bin/vite')
    // No --strictPort: if 5199 is busy (e.g. an orphaned dev server) Vite picks
    // the next free port; we parse whatever URL it prints.
    proc = spawn(bin, ['--port', '5199'], { cwd: dir, env: process.env })

    const scan = (buf: Buffer): void => {
      const m = buf.toString().match(/(http:\/\/localhost:\d+\/)/)
      if (m) done(m[1])
    }
    proc.stdout?.on('data', scan)
    proc.stderr?.on('data', scan)
    proc.on('error', fail)
    proc.on('exit', (code) => {
      proc = null
      if (!settled) {
        fail(new Error(`dev server exited before starting (code ${code})`))
      } else {
        // Server died after running; allow a fresh start next time.
        url = null
        starting = null
      }
    })
    setTimeout(() => fail(new Error('dev server start timeout')), 25000)
  })
  return starting
}

export function stopAuthoring(): void {
  if (proc) proc.kill()
  proc = null
  url = null
  starting = null
}
