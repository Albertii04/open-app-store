import { existsSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import type { AgentRunOptions, AgentHandle, ProviderAdapter } from '../types.js'
import type { ChatEvent } from '../../../shared/types.js'
import { streamAgent } from './streamAgent.js'

export function buildOpencodeArgs(o: AgentRunOptions): string[] {
  const args = ['run', '--format', 'json', '--dir', o.cwd]
  if (o.model) args.push('--model', o.model)
  if (o.resumeSessionId) args.push('--session', o.resumeSessionId)
  args.push(o.message)
  return args
}

const READONLY_CONFIG = {
  permission: { edit: 'deny', bash: 'deny', webfetch: 'deny', websearch: 'deny' },
}

export function makeOpencodeParser(): (line: string) => ChatEvent[] {
  let sessionId: string | undefined
  return (line: string): ChatEvent[] => {
    let msg: Record<string, unknown>
    try {
      msg = JSON.parse(line)
    } catch {
      return []
    }
    const props = (msg.properties as Record<string, unknown>) ?? {}
    switch (msg.type) {
      case 'session.created':
      case 'session.updated': {
        const info = (props.info as { id?: string }) ?? {}
        if (info.id) sessionId = info.id
        return []
      }
      case 'message.part.updated': {
        const part = (props.part as Record<string, unknown>) ?? {}
        if (part.type === 'text' && typeof part.text === 'string' && part.text.trim())
          return [{ kind: 'assistant', text: part.text }]
        if (part.type === 'tool') {
          const name = (part.tool as string) ?? 'tool'
          return [{ kind: 'tool', text: String(name) }]
        }
        return []
      }
      case 'session.idle':
        return [{ kind: 'done', text: '', sessionId }]
      case 'session.error':
        return [{ kind: 'error', text: String((props.error as string) ?? 'opencode error') }]
      default:
        return []
    }
  }
}

export const opencodeAdapter: ProviderAdapter = {
  id: 'opencode',
  label: 'opencode',
  binaryNames: ['opencode'],
  supportsExternalReadDirs: false,
  versionArgs: ['--version'],
  run(bin, o, emit): AgentHandle {
    let cfgPath: string | null = null
    let createdConfig = false
    if (!o.allowEdits) {
      const candidate = join(o.cwd, 'opencode.json')
      // Only write (and later remove) the config if it doesn't already exist.
      // Never clobber a user's own opencode.json.
      if (!existsSync(candidate)) {
        cfgPath = candidate
        try {
          writeFileSync(cfgPath, JSON.stringify(READONLY_CONFIG), 'utf8')
          createdConfig = true
        } catch {
          cfgPath = null
        }
      }
    }
    let cleaned = false
    const cleanup = (): void => {
      if (cleaned) return
      cleaned = true
      if (createdConfig && cfgPath) {
        try {
          rmSync(cfgPath)
        } catch {
          /* ignore */
        }
      }
    }
    return streamAgent(bin, buildOpencodeArgs(o), o.cwd, makeOpencodeParser(), emit, cleanup)
  },
}
