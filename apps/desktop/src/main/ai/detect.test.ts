import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync, chmodSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { detectBinary } from './detect.js'

function fakeBin(name: string): string {
  const d = mkdtempSync(join(tmpdir(), 'oas-bin-'))
  const p = join(d, name)
  writeFileSync(p, '#!/bin/sh\necho x')
  chmodSync(p, 0o755)
  return p
}

describe('detectBinary', () => {
  it('honors an existing override', () => {
    const p = fakeBin('claude')
    expect(detectBinary(['claude'], p, [])).toBe(p)
  })
  it('ignores a non-existent override and scans dirs', () => {
    const p = fakeBin('codex')
    expect(detectBinary(['codex'], '/nope/codex', [p.replace(/\/codex$/, '')])).toBe(p)
  })
  it('returns null when missing', () => {
    expect(detectBinary(['nothere'], undefined, ['/nope'])).toBeNull()
  })
})
