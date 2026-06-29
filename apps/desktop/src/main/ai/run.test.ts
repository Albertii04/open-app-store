import { describe, it, expect, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: () => '/nonexistent-userdata' } }))
// Force "no binary anywhere" so the friendly-error path is deterministic
// regardless of what CLIs happen to be installed on the test machine.
vi.mock('./detect.js', () => ({ detectBinary: () => null, candidateDirs: () => [] }))

import { runAgent } from './run.js'
import type { ChatEvent } from '../../shared/types.js'

describe('runAgent', () => {
  it('emits a friendly error and a no-op handle when no binary is found', () => {
    const events: ChatEvent[] = []
    const handle = runAgent(
      'codex',
      { cwd: '/tmp', message: 'x', readDirs: [], allowEdits: true },
      '/definitely/not/here',
      (e) => events.push(e),
    )
    expect(events[0].kind).toBe('error')
    expect(events[0].text).toMatch(/Codex|no encontrado|not found/i)
    handle.stop() // no-op, must not throw
  })
})
