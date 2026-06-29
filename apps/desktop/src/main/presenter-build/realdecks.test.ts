import { describe, it, expect, vi } from 'vitest'
import { mkdtempSync, cpSync, existsSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

vi.mock('electron', () => ({ app: { getPath: () => tmpdir() } }))
import { compileDeckAt } from './compileDeck.js'

// Regression guard: compile every real deck that ships in the repo's presenter
// source tree (Vue + scoped styles + .css theme imports + .png assets + gsap).
// Vitest cwd is apps/desktop, so the presenter decks live two dirs up.
const SRC = join(process.cwd(), '..', 'tools', 'presenter', 'src', 'presentations')

const deckIds = existsSync(SRC)
  ? readdirSync(SRC, { withFileTypes: true })
      .filter((e) => e.isDirectory() && e.name.startsWith('u-'))
      .map((e) => e.name)
  : []

describe.skipIf(deckIds.length === 0)('real decks compile', () => {
  for (const id of deckIds) {
    it(`compiles ${id} (only known externals)`, async () => {
      const dir = mkdtempSync(join(tmpdir(), `deck-${id}-`))
      cpSync(join(SRC, id), dir, { recursive: true })
      const r = await compileDeckAt(dir)
      if (!r.ok) throw new Error(`${id} failed to compile: ${r.error}`)
      // Everything external must be a host-provided module (no stray http/css).
      const allowed = new Set(['vue', 'gsap', '@vueuse/core', 'presenter-engine'])
      for (const ext of r.externals) expect(allowed.has(ext), `unexpected external: ${ext}`).toBe(true)
    }, 30000)
  }
})
