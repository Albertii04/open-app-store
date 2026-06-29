import * as vue from 'vue'
import * as gsapMod from 'gsap'
import * as vueuse from '@vueuse/core'
import * as engine from '../engine'

/**
 * Expose the modules that runtime-compiled deck bundles depend on
 * (`vue`, `gsap`, `@vueuse/core`, `presenter-engine`) on `globalThis.__oasHost`.
 * Decks are compiled to CJS and evaluated by `loadPresentation` with a custom
 * `require` that reads from this map — so a deck and the host share ONE Vue
 * instance (and the same engine), which the engine's components need to render
 * the deck's slides. Must run once before any deck loads. (An ESM import map was
 * tried first but its injection always lands after the page's module graph has
 * begun loading, so bare specifiers like "vue" fail to resolve.)
 */
declare global {
  // eslint-disable-next-line no-var
  var __oasHost: Record<string, unknown> | undefined
}

let installed = false

export function installHostModules(): void {
  if (installed) return
  installed = true
  globalThis.__oasHost = {
    vue,
    gsap: gsapMod,
    '@vueuse/core': vueuse,
    'presenter-engine': engine,
  }
}
