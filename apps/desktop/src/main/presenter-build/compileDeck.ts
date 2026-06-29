import * as esbuild from 'esbuild-wasm'
import type { Plugin, Loader } from 'esbuild-wasm'
import { parse as parseSfc, compileScript, compileTemplate, compileStyle } from '@vue/compiler-sfc'
import { readFileSync, writeFileSync, statSync, mkdirSync } from 'node:fs'
import { join, dirname, resolve, extname } from 'node:path'
import { randomUUID } from 'node:crypto'

/**
 * Compile decks with esbuild-WASM (in-process WebAssembly), NOT the native
 * esbuild binary. The native binary is spawned as a child process, and in a
 * packaged Electron app its path resolves inside app.asar (a file) → the spawn
 * fails with ENOTDIR. WASM runs in-process — no spawn, no asar/path issues, and
 * dev and packaged behave identically. esbuild.wasm is read as bytes (works
 * straight from the asar). initialize() runs once per process.
 */
let initPromise: Promise<void> | null = null
function ensureInit(): Promise<void> {
  if (!initPromise) {
    // In Node, esbuild-wasm loads its own esbuild.wasm via fs (works straight
    // from the asar — it's a file read, not a spawn). worker:false runs it in
    // this thread. (`wasmModule`/`wasmURL` are browser-only.)
    initPromise = esbuild.initialize({ worker: false }).catch((e: unknown) => {
      // Tolerate "initialize called more than once" (same process, e.g. tests).
      if (!String(e).includes('more than once')) throw e
    })
  }
  return initPromise
}

export type CompileResult =
  | { ok: true; file: string; externals: string[] }
  | { ok: false; error: string }

/** Modules the host provides at runtime. Any bare import not in this set is an error. */
const HOST_MODULES = new Set(['vue', 'gsap', '@vueuse/core', 'presenter-engine'])

/** Engine-path regex: matches relative paths that navigate to an "engine" segment */
const ENGINE_RE = /(^|\/)engine($|\/)/

/**
 * Build a JS snippet that injects `css` as a <style> tag at runtime. Decks load
 * as a single Blob module with no file server, so all CSS (SFC <style> blocks
 * and imported .css files) must be embedded and self-injected rather than
 * emitted as a separate stylesheet. Font `@import url(https://…)` inside the CSS
 * survives as text and the browser fetches it from the injected style.
 */
function cssInjectJs(css: string): string {
  return (
    `{const __s=document.createElement('style');` +
    `__s.textContent=${JSON.stringify(css)};` +
    `document.head.appendChild(__s);}`
  )
}

/** Compile a single Vue SFC to a JS module string (script + inlined template +
 *  self-injecting scoped styles). Returned to esbuild as a `ts` module. */
function compileVueSfc(filename: string): { contents: string } | { errors: { text: string }[] } {
  const source = readFileSync(filename, 'utf-8')
  const { descriptor, errors: parseErrors } = parseSfc(source, { filename })
  if (parseErrors.length > 0)
    return { errors: parseErrors.map((e) => ({ text: String((e as Error).message ?? e) })) }

  // Vue convention: compileScript/compileTemplate take the RAW id (they stamp
  // `data-v-<id>` on elements); compileStyle takes the FULL `data-v-<id>`.
  const id = randomUUID().slice(0, 8)
  const scopeId = `data-v-${id}`
  const hasScoped = descriptor.styles.some((s) => s.scoped)

  let styleInject = ''
  for (const style of descriptor.styles) {
    const compiledStyle = compileStyle({ source: style.content, filename, id: scopeId, scoped: style.scoped })
    if (compiledStyle.errors.length === 0 && compiledStyle.code.trim())
      styleInject += `\n${cssInjectJs(compiledStyle.code)}`
  }

  let code: string
  if (descriptor.scriptSetup || descriptor.script) {
    const compiled = compileScript(descriptor, { id, inlineTemplate: true, genDefaultAs: '_sfc_main' })
    const scopeLine = hasScoped ? `\n_sfc_main.__scopeId = ${JSON.stringify(scopeId)}` : ''
    code = `${compiled.content}${scopeLine}${styleInject}\nexport default _sfc_main`
  } else if (descriptor.template) {
    const compiled = compileTemplate({
      source: descriptor.template.content,
      filename,
      id,
      scoped: hasScoped,
    })
    if (compiled.errors.length > 0)
      return { errors: compiled.errors.map((e) => ({ text: typeof e === 'string' ? e : String(e.message) })) }
    const scopeProp = hasScoped ? `, __scopeId: ${JSON.stringify(scopeId)}` : ''
    code = `${compiled.code}\nexport default { render${scopeProp} }${styleInject}`
  } else {
    code = `export default {}${styleInject}`
  }
  return { contents: code }
}

const RESOLVE_EXTS = ['', '.ts', '.tsx', '.mts', '.js', '.jsx', '.mjs', '.vue', '.json', '.css']
const TS_LOADERS: Record<string, Loader> = {
  '.ts': 'ts',
  '.mts': 'ts',
  '.tsx': 'tsx',
  '.js': 'js',
  '.mjs': 'js',
  '.jsx': 'jsx',
  '.json': 'json',
}
const ASSET_EXTS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.avif', '.mp4', '.webm', '.woff', '.woff2', '.ttf', '.otf',
])

function isFile(p: string): boolean {
  try {
    return statSync(p).isFile()
  } catch {
    return false
  }
}

/** Node-style resolution from disk (the WASM compiler can't touch the fs). */
function resolveOnDisk(spec: string, fromDir: string): string | null {
  const base = resolve(fromDir, spec)
  for (const e of RESOLVE_EXTS) if (isFile(base + e)) return base + e
  for (const e of RESOLVE_EXTS.filter(Boolean)) {
    const idx = join(base, 'index' + e)
    if (isFile(idx)) return idx
  }
  return null
}

/**
 * The single plugin that makes esbuild-WASM work against on-disk decks: WASM has
 * no filesystem, so WE resolve (onResolve) and read (onLoad) every file with
 * Node fs and hand the bytes to the compiler. Bare imports (vue/gsap/engine) are
 * externalized; relative/absolute paths are read from disk and transformed
 * (.vue → SFC compile, .css → style-inject, images → data URL, .ts/.js → as-is).
 */
function fsPlugin(externals: Set<string>): Plugin {
  return {
    name: 'presenter-fs',
    setup(build) {
      build.onResolve({ filter: /.*/ }, (args) => {
        const p = args.path
        if (p.startsWith('.') || p.startsWith('/')) {
          if (ENGINE_RE.test(p)) {
            externals.add('presenter-engine')
            return { path: 'presenter-engine', external: true }
          }
          const fromDir = args.importer ? dirname(args.importer) : args.resolveDir || ''
          const abs = resolveOnDisk(p, fromDir)
          if (!abs) return { errors: [{ text: `No se pudo resolver "${p}" desde ${fromDir}` }] }
          return { path: abs, namespace: 'deck-fs' }
        }
        externals.add(p)
        return { path: p, external: true }
      })

      build.onLoad({ filter: /.*/, namespace: 'deck-fs' }, (args) => {
        const path = args.path
        const ext = extname(path).toLowerCase()
        if (ext === '.vue') {
          const r = compileVueSfc(path)
          return 'errors' in r ? r : { contents: r.contents, loader: 'ts', resolveDir: dirname(path) }
        }
        if (ext === '.css')
          return { contents: cssInjectJs(readFileSync(path, 'utf-8')), loader: 'js', resolveDir: dirname(path) }
        if (ASSET_EXTS.has(ext)) return { contents: readFileSync(path), loader: 'dataurl' }
        return {
          contents: readFileSync(path, 'utf-8'),
          loader: TS_LOADERS[ext] ?? 'js',
          resolveDir: dirname(path),
        }
      })
    },
  }
}

export async function compileDeckAt(deckDir: string): Promise<CompileResult> {
  const entry = join(deckDir, 'index.ts')
  const outDir = join(deckDir, '.build')
  const outFile = join(outDir, 'deck.js')

  mkdirSync(outDir, { recursive: true })

  const externals = new Set<string>()

  try {
    await ensureInit()
    // WASM can't read/write the fs: produce the bundle in memory (write:false +
    // the fsPlugin feeds/reads files) and write the result with Node fs.
    const result = await esbuild.build({
      entryPoints: [entry],
      bundle: true,
      write: false,
      // CJS (not ESM): the renderer evals this with a custom `require` that
      // returns host-provided modules from globalThis.__oasHost. This avoids
      // ESM import maps, whose injection timing (after the page's module graph
      // has loaded) makes bare specifiers like "vue" fail to resolve.
      format: 'cjs',
      platform: 'browser',
      target: 'es2022',
      sourcemap: 'inline',
      plugins: [fsPlugin(externals)],
      logLevel: 'silent',
    })

    const unknown = Array.from(externals).filter((e) => !HOST_MODULES.has(e))
    if (unknown.length)
      return {
        ok: false,
        error: `El deck importa módulos no disponibles: ${unknown.join(', ')}. Solo se permiten: ${[...HOST_MODULES].join(', ')}.`,
      }

    const files = result.outputFiles ?? []
    const js = files.find((f) => f.path.endsWith('.js'))?.text ?? files[0]?.text
    if (!js)
      return {
        ok: false,
        error: `esbuild no produjo salida (${files.length} archivos: ${files.map((f) => f.path).join(', ')})`,
      }
    writeFileSync(outFile, js, 'utf-8')

    return { ok: true, file: outFile, externals: Array.from(externals) }
  } catch (err: unknown) {
    const error = err instanceof Error ? err.message : String(err)
    return { ok: false, error }
  }
}

export async function compileDeck(presId: string): Promise<CompileResult> {
  const { app } = await import('electron')
  return compileDeckAt(join(app.getPath('userData'), 'presentations', presId))
}
