import { build, type Plugin } from 'esbuild'
import { parse as parseSfc, compileScript, compileTemplate } from '@vue/compiler-sfc'
import { readFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { randomUUID } from 'node:crypto'

export type CompileResult =
  | { ok: true; file: string; externals: string[] }
  | { ok: false; error: string }

/** Engine-path regex: matches relative paths that navigate to an "engine" segment */
const ENGINE_RE = /(^|\/)engine($|\/)/

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

        if (descriptor.scriptSetup || descriptor.script) {
          // inlineTemplate:true makes compileScript embed the render fn in setup
          // — produces a single clean `export default _defineComponent({...})`
          const compiled = compileScript(descriptor, {
            id: scopeId,
            inlineTemplate: true,
          })
          code = compiled.content
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
          code = `${compiled.code}\nexport default { render }`
        } else {
          // Empty SFC — export empty object
          code = `export default {}`
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
      loader: { '.json': 'json' },
      plugins: [makeVuePlugin(), makeExternalizerPlugin(externals)],
      logLevel: 'silent',
    })

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
