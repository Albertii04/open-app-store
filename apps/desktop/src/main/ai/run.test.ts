import { describe, it, expect, vi } from 'vitest'
vi.mock('electron', () => ({ app: { getPath: () => '/nonexistent-userdata' } }))
import { runAgent } from './run.js'
import type { ChatEvent } from '../../shared/types.js'

describe('runAgent', () => {
  it('emits a friendly error when the binary is missing', () => {
    const events: ChatEvent[] = []
    const handle = runAgent(
      'codex',
      { cwd: '/tmp', message: 'x', readDirs: [], allowEdits: true },
      '/definitely/not/here',
      (e) => events.push(e),
    )
    expect(events[0].kind).toBe('error')
    expect(events[0].text).toMatch(/Codex|no encontrado|not found/i)
    handle.stop()
  })
})
