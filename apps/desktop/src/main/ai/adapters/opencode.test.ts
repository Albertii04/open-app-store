import { describe, it, expect } from 'vitest'
import { buildOpencodeArgs, makeOpencodeParser } from './opencode.js'

describe('opencode adapter', () => {
  it('builds args', () => {
    const a = buildOpencodeArgs({ cwd: '/d', message: 'hi', readDirs: [], allowEdits: true, model: 'anthropic/x', resumeSessionId: 'ses_1' })
    expect(a.slice(0, 2)).toEqual(['run', '--format'])
    expect(a.join(' ')).toContain('--dir /d')
    expect(a.join(' ')).toContain('--model anthropic/x')
    expect(a.join(' ')).toContain('--session ses_1')
    expect(a[a.length - 1]).toBe('hi')
  })
  it('parses events', () => {
    const p = makeOpencodeParser()
    expect(p(JSON.stringify({ type: 'session.updated', properties: { info: { id: 'ses_9' } } }))).toEqual([])
    expect(p(JSON.stringify({ type: 'message.part.updated', properties: { part: { type: 'text', text: 'hi' } } })))
      .toEqual([{ kind: 'assistant', text: 'hi' }])
    expect(p(JSON.stringify({ type: 'session.idle' }))).toEqual([{ kind: 'done', text: '', sessionId: 'ses_9' }])
  })
})
