import { describe, it, expect, vi } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const ud = mkdtempSync(join(tmpdir(), 'oas-compile-'))
vi.mock('electron', () => ({ app: { getPath: () => ud } }))
import { compileDeckAt } from './compileDeck.js'

function writeDeck(dir: string): void {
  mkdirSync(join(dir, 'slides'), { recursive: true })
  writeFileSync(join(dir, 'presentation.json'), JSON.stringify({ id: 'd1', name: 'D1' }))
  writeFileSync(
    join(dir, 'slides', 'Intro.vue'),
    `<template><h1>{{ msg }}</h1></template>
<script setup lang="ts">import { ref } from 'vue'; const msg = ref('hi')</script>`,
  )
  writeFileSync(
    join(dir, 'slides.ts'),
    `import Intro from './slides/Intro.vue'
export const slides = [{ component: Intro, title: 'Intro', notes: '' }]`,
  )
  writeFileSync(
    join(dir, 'index.ts'),
    `import meta from './presentation.json'
import { slides } from './slides'
export default { meta, slides }`,
  )
}

describe('compileDeckAt', () => {
  it('compiles a deck with a vue slide, externalizing vue', async () => {
    const deck = mkdtempSync(join(tmpdir(), 'deck-'))
    writeDeck(deck)
    const r = await compileDeckAt(deck)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(existsSync(r.file)).toBe(true)
      expect(r.externals).toContain('vue')
    }
  })

  it('aliases the engine import to external presenter-engine', async () => {
    const deck = mkdtempSync(join(tmpdir(), 'deck2-'))
    mkdirSync(deck, { recursive: true })
    writeFileSync(
      join(deck, 'index.ts'),
      `import { AudienceDeck } from '../../engine'
export default { x: AudienceDeck }`,
    )
    const r = await compileDeckAt(deck)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.externals).toContain('presenter-engine')
  })

  it('rejects a deck that imports an unknown bare module (lodash)', async () => {
    const deck = mkdtempSync(join(tmpdir(), 'deck3-'))
    mkdirSync(deck, { recursive: true })
    writeFileSync(
      join(deck, 'index.ts'),
      `import { cloneDeep } from 'lodash'
export default { cloneDeep }`,
    )
    const r = await compileDeckAt(deck)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('lodash')
  })
})
