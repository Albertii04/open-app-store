import type { Presentation } from '../engine/types'

type ToolboxAuthoring = { authoring?: { compiledDeck(id: string): Promise<string> } }

/**
 * Find the toolbox bridge. The preload only exposes `window.toolbox` on the
 * shell's tool frame. A deck can render in contexts that lack it:
 *  - the editor's preview iframe → bridge is on `window.parent` / `window.top`
 *  - a Play/Presenter/Audience window opened via `window.open` → bridge is on
 *    `window.opener` (walk the opener chain, since console→audience nests).
 * All are same-origin, so reaching across is allowed.
 */
function findToolbox(): ToolboxAuthoring | undefined {
  const has = (f: unknown): ToolboxAuthoring | undefined => {
    try {
      const tb = (f as { toolbox?: ToolboxAuthoring } | null)?.toolbox
      return tb?.authoring?.compiledDeck ? tb : undefined
    } catch {
      return undefined // cross-origin
    }
  }
  const self = has(window)
  if (self) return self
  for (const f of [window.parent, window.top]) {
    const tb = has(f)
    if (tb) return tb
  }
  // Walk the opener chain (Play/Presenter/Audience windows).
  let opener: Window | null = window.opener
  for (let i = 0; opener && i < 5; i++) {
    const tb = has(opener) ?? has(opener.parent) ?? has(opener.top)
    if (tb) return tb
    try {
      opener = opener.opener
    } catch {
      break
    }
  }
  return undefined
}

/**
 * Load a deck by compiling it in the shell (main process) and importing the
 * returned ESM source as a Blob. Bare imports (vue/gsap/@vueuse/core/
 * presenter-engine) resolve via the import map installed by installHostModules().
 */
export async function loadPresentation(id: string): Promise<Presentation | undefined> {
  const tb = findToolbox()
  if (!tb?.authoring?.compiledDeck) return undefined
  const code = await tb.authoring.compiledDeck(id)
  // The deck is compiled to CJS. Evaluate it with a `require` that returns the
  // host-provided modules (vue/gsap/@vueuse/core/presenter-engine) so the deck
  // shares the host's Vue instance + engine. No import map, no module graph.
  const host = globalThis.__oasHost ?? {}
  const require = (spec: string): unknown => {
    if (spec in host) return host[spec]
    throw new Error(`módulo no disponible en el host: ${spec}`)
  }
  const module = { exports: {} as Record<string, unknown> }
  const factory = new Function('require', 'module', 'exports', code) as (
    r: typeof require,
    m: typeof module,
    e: Record<string, unknown>,
  ) => void
  factory(require, module, module.exports)
  const exp = module.exports as { default?: Presentation; presentation?: Presentation }
  return exp.default ?? exp.presentation
}
