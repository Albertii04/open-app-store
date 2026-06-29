import { spawn } from 'node:child_process'
import type { AgentRunOptions, AgentHandle, ProviderAdapter } from '../types.js'
import type { ChatEvent } from '../../../shared/types.js'
import { agentEnv } from '../detect.js'

export function buildClaudeArgs(o: AgentRunOptions): string[] {
  const args = ['-p', '--output-format', 'stream-json', '--verbose']
  for (const d of o.readDirs) args.push('--add-dir', d)
  args.push('--allowedTools', 'Read,Edit,Write,Glob,Grep')
  args.push('--permission-mode', o.allowEdits ? 'acceptEdits' : 'plan')
  if (o.model) args.push('--model', o.model)
  if (o.resumeSessionId) args.push('--resume', o.resumeSessionId)
  args.push(o.message)
  return args
}

export function parseClaudeLine(line: string): ChatEvent[] {
  let msg: Record<string, unknown>
  try {
    msg = JSON.parse(line)
  } catch {
    return []
  }
  const out: ChatEvent[] = []
  if (msg.type === 'assistant') {
    const content = (msg.message as { content?: unknown[] })?.content ?? []
    for (const b of content as Array<Record<string, unknown>>) {
      if (b.type === 'text' && typeof b.text === 'string' && b.text.trim())
        out.push({ kind: 'assistant', text: b.text })
      else if (b.type === 'tool_use') {
        const file = (b.input as { file_path?: string })?.file_path
        out.push({ kind: 'tool', text: `${b.name}${file ? ' · ' + file.split('/').pop() : ''}` })
      }
    }
  } else if (msg.type === 'result') {
    out.push({
      kind: msg.is_error ? 'error' : 'done',
      text: String(msg.result ?? ''),
      sessionId: typeof msg.session_id === 'string' ? msg.session_id : undefined,
    })
  }
  return out
}

export const claudeAdapter: ProviderAdapter = {
  id: 'claude',
  label: 'Claude Code',
  binaryNames: ['claude'],
  supportsExternalReadDirs: true,
  versionArgs: ['--version'],
  run(bin, o, emit): AgentHandle {
    const child = spawn(bin, buildClaudeArgs(o), { cwd: o.cwd, env: agentEnv(), stdio: ['ignore', 'pipe', 'pipe'] })
    child.stderr?.on('data', () => {})
    let buf = ''
    child.stdout.on('data', (chunk: Buffer) => {
      buf += chunk.toString()
      let nl: number
      while ((nl = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, nl).trim()
        buf = buf.slice(nl + 1)
        if (line) for (const ev of parseClaudeLine(line)) emit(ev)
      }
    })
    child.on('error', (e) => emit({ kind: 'error', text: e.message }))
    child.on('exit', (_code, signal) => {
      if (signal) emit({ kind: 'error', text: 'Detenido.' })
    })
    return { stop: () => child.kill() }
  },
}
