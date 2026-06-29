import type { AgentRunOptions, AgentHandle, ProviderAdapter } from '../types.js'
import type { ChatEvent } from '../../../shared/types.js'
import { streamAgent } from './streamAgent.js'

export function buildCodexArgs(o: AgentRunOptions): string[] {
  const args = ['exec', '--json']
  if (o.resumeSessionId) args.push('resume', o.resumeSessionId)
  args.push('--cd', o.cwd)
  // `codex exec` is non-interactive (no approval prompts); the sandbox mode is
  // what gates edits. Note: `--ask-for-approval` is NOT valid on `exec` and
  // makes the CLI reject the whole command.
  args.push('--sandbox', o.allowEdits ? 'workspace-write' : 'read-only')
  args.push('--skip-git-repo-check')
  if (o.model) args.push('--model', o.model)
  args.push(o.message)
  return args
}

/** Stateful parser: remembers the session id from thread.started to attach on done. */
export function makeCodexParser(): (line: string) => ChatEvent[] {
  let sessionId: string | undefined
  return (line: string): ChatEvent[] => {
    let msg: Record<string, unknown>
    try {
      msg = JSON.parse(line)
    } catch {
      return []
    }
    const t = msg.type
    if (t === 'thread.started') {
      sessionId = (msg.thread_id as string) ?? (msg.session_id as string)
      return []
    }
    if (t === 'item.completed') {
      const item = (msg.item as Record<string, unknown>) ?? {}
      if (item.type === 'agent_message' && typeof item.text === 'string')
        return [{ kind: 'assistant', text: item.text }]
      if (item.type === 'file_change' || item.type === 'command_execution') {
        const path = (item.path as string) ?? (item.command as string) ?? ''
        const label = item.type === 'file_change' ? 'edit' : 'run'
        return [{ kind: 'tool', text: `${label}${path ? ' · ' + String(path).split('/').pop() : ''}` }]
      }
      return []
    }
    if (t === 'turn.completed') return [{ kind: 'done', text: '', sessionId }]
    if (t === 'error' || t === 'turn.failed') {
      const err = (msg.error as { message?: string } | undefined)?.message ?? (msg.message as string)
      return [{ kind: 'error', text: String(err ?? 'Codex error') }]
    }
    return []
  }
}

export const codexAdapter: ProviderAdapter = {
  id: 'codex',
  label: 'OpenAI Codex',
  binaryNames: ['codex'],
  supportsExternalReadDirs: false,
  versionArgs: ['--version'],
  run(bin, o, emit): AgentHandle {
    return streamAgent(bin, buildCodexArgs(o), o.cwd, makeCodexParser(), emit)
  },
}
