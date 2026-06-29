import { describe, it, expect } from 'vitest'
import { buildCodexArgs, makeCodexParser } from './codex.js'

describe('codex adapter', () => {
  it('builds edit args', () => {
    const a = buildCodexArgs({ cwd: '/d', message: 'hi', readDirs: [], allowEdits: true, model: 'gpt-5' })
    expect(a.slice(0, 2)).toEqual(['exec', '--json'])
    expect(a.join(' ')).toContain('--cd /d')
    expect(a.join(' ')).toContain('--sandbox workspace-write')
    expect(a.join(' ')).not.toContain('--ask-for-approval')
    expect(a.join(' ')).toContain('--model gpt-5')
    expect(a[a.length - 1]).toBe('hi')
  })
  it('builds read-only + resume args (exec options before resume, prompt last)', () => {
    const a = buildCodexArgs({ cwd: '/d', message: 'x', readDirs: [], allowEdits: false, resumeSessionId: 'T1' })
    expect(a.join(' ')).toContain('--sandbox read-only')
    expect(a.join(' ')).toContain('resume T1')
    // exec options MUST precede the `resume` subcommand; prompt is last.
    expect(a.indexOf('--cd')).toBeLessThan(a.indexOf('resume'))
    expect(a.indexOf('--sandbox')).toBeLessThan(a.indexOf('resume'))
    expect(a[a.length - 1]).toBe('x')
    expect(a[a.indexOf('resume') + 1]).toBe('T1')
  })
  it('parses a stream into events with session id on done', () => {
    const p = makeCodexParser()
    expect(p(JSON.stringify({ type: 'thread.started', thread_id: 'T7' }))).toEqual([])
    expect(p(JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'hi' } })))
      .toEqual([{ kind: 'assistant', text: 'hi' }])
    expect(p(JSON.stringify({ type: 'item.completed', item: { type: 'file_change', path: '/x/A.vue' } })))
      .toEqual([{ kind: 'tool', text: 'edit · A.vue' }])
    expect(p(JSON.stringify({ type: 'turn.completed' })))
      .toEqual([{ kind: 'done', text: '', sessionId: 'T7' }])
  })
})
