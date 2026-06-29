import { describe, it, expect } from 'vitest'
import { buildClaudeArgs, parseClaudeLine } from './claude.js'

describe('claude adapter', () => {
  it('builds edit-mode args with add-dirs + resume', () => {
    const a = buildClaudeArgs(
      { cwd: '/d', message: 'hi', readDirs: ['/a', '/b'], allowEdits: true, model: 'opus', resumeSessionId: 'sess1' },
    )
    expect(a).toContain('-p')
    expect(a).toContain('stream-json')
    expect(a.join(' ')).toContain('--add-dir /a')
    expect(a.join(' ')).toContain('--add-dir /b')
    expect(a.join(' ')).toContain('--permission-mode acceptEdits')
    expect(a.join(' ')).toContain('--model opus')
    expect(a.join(' ')).toContain('--resume sess1')
  })
  it('uses plan mode when edits disabled', () => {
    const a = buildClaudeArgs({ cwd: '/d', message: 'x', readDirs: [], allowEdits: false })
    expect(a.join(' ')).toContain('--permission-mode plan')
  })
  it('parses assistant text + tool_use', () => {
    const evs = parseClaudeLine(
      JSON.stringify({ type: 'assistant', message: { content: [
        { type: 'text', text: 'hello' },
        { type: 'tool_use', name: 'Edit', input: { file_path: '/x/Slide.vue' } },
      ] } }),
    )
    expect(evs[0]).toEqual({ kind: 'assistant', text: 'hello' })
    expect(evs[1]).toEqual({ kind: 'tool', text: 'Edit · Slide.vue' })
  })
  it('parses result → done with sessionId', () => {
    const evs = parseClaudeLine(JSON.stringify({ type: 'result', is_error: false, result: 'ok', session_id: 's9' }))
    expect(evs[0]).toEqual({ kind: 'done', text: 'ok', sessionId: 's9' })
  })
})
