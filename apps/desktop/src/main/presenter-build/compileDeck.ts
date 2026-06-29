import { build, type Plugin } from 'esbuild'
import { parse as parseSfc, compileScript, compileTemplate, compileStyle } from '@vue/compiler-sfc'
import { readFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { randomUUID } from 'node:crypto'

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

/** esbuild plugin: load imported `.css` files as self-injecting JS modules. */
function makeCssPlugin(): Plugin {
  return {
    name: 'presenter-css',
    setup(build) {
      build.onLoad({ filter: /\.css$/ }, (args) => {
        const css = readFileSync(args.path, 'utf-8')
        return { contents: cssInjectJs(css), loader: 'js' }
      })
    },
  }
}

/**
 * esbuild plugin that:
 *  - Externalizes all bare (npm) specifiers
 *  - Remaps any relative path touching "engine" to the external `presenter-engine`
 *  - Leaves other relative/absolute paths alone (let esbuild bundle them)
 *  - Collects all externalized names into `externals`
 */
function makeExternalizerPlugin(externals: Set<string>): Plugin {
  return {
    name: 'presenter-externalizer',
    setup(build) {
      build.onResolve({ filter: /.*/ }, (args) => {
        const p = args.path

        // Relative or absolute path — check for engine alias first
        if (p.startsWith('.') || p.startsWith('/')) {
          if (ENGINE_RE.test(p)) {
            externals.add('presenter-engine')
            return { path: 'presenter-engine', external: true }
          }
          // Let esbuild handle the rest (bundle it)
          return undefined
        }

        // Bare specifier — externalize it
        externals.add(p)
        return { path: p, external: true }
      })
    },
  }
}

/**
 * Hand-rolled esbuild plugin for Vue 3 SFCs using @vue/compiler-sfc.
 * Uses inlineTemplate:true so compileScript emits a single default export
 * with the render function inlined in setup — no double-export problem.
 */
function makeVuePlugin(): Plugin {
  return {
    name: 'presenter-vue-sfc',
    setup(build) {
      build.onLoad({ filter: /\.vue$/ }, (args) => {
        const source = readFileSync(args.path, 'utf-8')
        const filename = args.path

        const { descriptor, errors: parseErrors } = parseSfc(source, { filename })
        if (parseErrors.length > 0) {
          return {
            errors: parseErrors.map((e) => {
              const loc = 'loc' in e ? e.loc : undefined
              return {
                text: String(e.message),
                location: loc
                  ? {
                      file: filename,
                      line: loc.start.line,
                      column: loc.start.column,
                    }
                  : undefined,
              }
            }),
          }
        }

        const scopeId = `data-v-${randomUUID().slice(0, 8)}`
        let code: string

        // Compile each <style> block (honoring `scoped`) and self-inject it, so
        // component styles survive in the standalone Blob bundle. Uses the same
        // scopeId as the script/template so scoped selectors match.
        let styleInject = ''
        for (const style of descriptor.styles) {
          const compiledStyle = compileStyle({
            source: style.content,
            filename,
            id: scopeId,
            scoped: style.scoped,
          })
          if (compiledStyle.errors.length === 0 && compiledStyle.code.trim())
            styleInject += `\n${cssInjectJs(compiledStyle.code)}`
        }

        if (descriptor.scriptSetup || descriptor.script) {
          // inlineTemplate:true makes compileScript embed the render fn in setup
          // — produces a single clean `export default _defineComponent({...})`
          const compiled = compileScript(descriptor, {
            id: scopeId,
            inlineTemplate: true,
          })
          code = compiled.content + styleInject
        } else if (descriptor.template) {
          // Template-only component (no script): compile template separately
          const compiled = compileTemplate({
            source: descriptor.template.content,
            filename,
            id: scopeId,
            scoped: descriptor.styles.some((s) => s.scoped),
          })
          if (compiled.errors.length > 0) {
            return {
              errors: compiled.errors.map((e) => ({
                text: typeof e === 'string' ? e : String(e.message),
              })),
            }
          }
          // Wrap template render fn as a simple component
          code = `${compiled.code}\nexport default { render }${styleInject}`
        } else {
          // Empty SFC — export empty object
          code = `export default {}${styleInject}`
        }

        return {
          contents: code,
          loader: 'ts',
          resolveDir: dirname(filename),
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
    await build({
      entryPoints: [entry],
      outfile: outFile,
      bundle: true,
      format: 'esm',
      platform: 'browser',
      target: 'es2022',
      sourcemap: true,
      // Decks load as a single Blob module (no file server), so asset imports
      // are inlined as data URLs rather than emitted as separate files.
      loader: {
        '.json': 'json',
        '.png': 'dataurl',
        '.jpg': 'dataurl',
        '.jpeg': 'dataurl',
        '.gif': 'dataurl',
        '.webp': 'dataurl',
        '.svg': 'dataurl',
        '.avif': 'dataurl',
        '.mp4': 'dataurl',
        '.webm': 'dataurl',
        '.woff': 'dataurl',
        '.woff2': 'dataurl',
        '.ttf': 'dataurl',
      },
      plugins: [makeVuePlugin(), makeCssPlugin(), makeExternalizerPlugin(externals)],
      logLevel: 'silent',
    })

    const unknown = Array.from(externals).filter((e) => !HOST_MODULES.has(e))
    if (unknown.length)
      return {
        ok: false,
        error: `El deck importa módulos no disponibles: ${unknown.join(', ')}. Solo se permiten: ${[...HOST_MODULES].join(', ')}.`,
      }

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
