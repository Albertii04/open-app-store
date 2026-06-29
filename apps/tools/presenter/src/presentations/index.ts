import type { Presentation } from '../engine/types'

type ToolboxAuthoring = { authoring?: { compiledDeck(id: string): Promise<string> } }

/**
 * Find the toolbox bridge. The preload only exposes `window.toolbox` on the
 * shell's tool frame; when the deck renders inside the editor's preview iframe
 * (a same-origin child of that frame) the bridge lives on the parent/top window
 * instead, so fall back to those.
 */
function findToolbox(): ToolboxAuthoring | undefined {
  const w = window as unknown as { toolbox?: ToolboxAuthoring }
  if (w.toolbox?.authoring?.compiledDeck) return w.toolbox
  for (const frame of [window.parent, window.top]) {
    try {
      const tb = (frame as unknown as { toolbox?: ToolboxAuthoring })?.toolbox
      if (tb?.authoring?.compiledDeck) return tb
    } catch {
      /* cross-origin — ignore */
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
  const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }))
  try {
    const mod = (await import(/* @vite-ignore */ url)) as { default?: Presentation; presentation?: Presentation }
    return mod.default ?? mod.presentation
  } finally {
    URL.revokeObjectURL(url)
  }
}
