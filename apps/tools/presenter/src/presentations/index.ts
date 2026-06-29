import type { Presentation } from '../engine/types'

type ToolboxAuthoring = { authoring?: { compiledDeck(id: string): Promise<string> } }

/**
 * Load a deck by compiling it in the shell (main process) and importing the
 * returned ESM source as a Blob. Bare imports (vue/gsap/@vueuse/core/
 * presenter-engine) resolve via the import map installed by installHostModules().
 */
export async function loadPresentation(id: string): Promise<Presentation | undefined> {
  const tb = (window as unknown as { toolbox?: ToolboxAuthoring }).toolbox
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
