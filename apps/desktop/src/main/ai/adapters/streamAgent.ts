import { spawn } from 'node:child_process'
import { agentEnv } from '../detect.js'
import type { AgentHandle } from '../types.js'
import type { ChatEvent } from '../../../shared/types.js'

/**
 * Shared agent-process driver: spawns the CLI with a rich PATH, parses its
 * newline-delimited stdout into ChatEvents, and GUARANTEES exactly one terminal
 * event (`done` or `error`). If the process exits without the parser having
 * produced a terminal event, one is synthesized from the exit code — so the
 * caller's promise always settles (no "reply was never sent" hangs).
 *
 * @param parse  per-line parser → ChatEvents (may be stateful, created per run)
 * @param onClose optional cleanup run once when the process ends
 */
export function streamAgent(
  bin: string,
  args: string[],
  cwd: string,
  parse: (line: string) => ChatEvent[],
  emit: (e: ChatEvent) => void,
  onClose?: () => void,
): AgentHandle {
  let terminated = false
  const out = (ev: ChatEvent): void => {
    if (ev.kind === 'done' || ev.kind === 'error') {
      if (terminated) return
      terminated = true
    }
    emit(ev)
  }

  const child = spawn(bin, args, { cwd, env: agentEnv(), stdio: ['ignore', 'pipe', 'pipe'] })
  // Drain stderr so a chatty CLI can't fill the pipe buffer and deadlock, but
  // keep the tail so a non-zero exit can report WHY (instead of a bare code).
  let errTail = ''
  child.stderr?.on('data', (c: Buffer) => {
    errTail = (errTail + c.toString()).slice(-2000)
  })

  let buf = ''
  child.stdout.on('data', (chunk: Buffer) => {
    buf += chunk.toString()
    let nl: number
    while ((nl = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, nl).trim()
      buf = buf.slice(nl + 1)
      if (line) for (const ev of parse(line)) out(ev)
    }
  })

  child.on('error', (e) => {
    onClose?.()
    out({ kind: 'error', text: e.message })
  })
  child.on('exit', (code, signal) => {
    onClose?.()
    if (terminated) return
    if (signal) out({ kind: 'error', text: 'Detenido.' })
    else if (code === 0) out({ kind: 'done', text: '' })
    else {
      // Surface the CLI's own stderr (the real reason) instead of a bare code.
      const reason = errTail.trim().split('\n').filter(Boolean).slice(-6).join('\n')
      out({
        kind: 'error',
        text: reason
          ? `El proceso terminó con código ${code ?? '?'}:\n${reason}`
          : `El proceso terminó con código ${code ?? '?'}.`,
      })
    }
  })

  return { stop: () => child.kill() }
}
