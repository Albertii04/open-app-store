import * as vue from 'vue'
import * as gsapMod from 'gsap'
import * as vueuse from '@vueuse/core'
import * as engine from '../engine'

/**
 * Expose the modules that runtime-compiled deck bundles import as externals
 * (`vue`, `gsap`, `@vueuse/core`, `presenter-engine`) via an import map that
 * points each bare specifier at a blob-URL ES-module shim re-exporting the
 * already-loaded module. MUST run once, before the first deck `import()`.
 */
let installed = false

function shimUrl(mod: Record<string, unknown>): string {
  ;(globalThis as Record<string, unknown>).__oas_mod ??= {}
  const store = (globalThis as Record<string, unknown>).__oas_mod as Record<string, unknown>
  const key = `m${Object.keys(store).length}`
  store[key] = mod
  const names = Object.keys(mod).filter((n) => n !== 'default')
  const body =
    `const m = globalThis.__oas_mod.${key};\n` +
    names.map((n) => `export const ${n} = m[${JSON.stringify(n)}];`).join('\n') +
    `\nexport default ('default' in m ? m.default : m);`
  return URL.createObjectURL(new Blob([body], { type: 'text/javascript' }))
}

export function installHostModules(): void {
  if (installed) return
  installed = true
  const imports: Record<string, string> = {
    vue: shimUrl(vue as Record<string, unknown>),
    gsap: shimUrl(gsapMod as Record<string, unknown>),
    '@vueuse/core': shimUrl(vueuse as Record<string, unknown>),
    'presenter-engine': shimUrl(engine as Record<string, unknown>),
  }
  const el = document.createElement('script')
  el.type = 'importmap'
  el.textContent = JSON.stringify({ imports })
  document.head.appendChild(el)
}
