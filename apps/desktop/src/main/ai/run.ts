import { getAdapter } from './registry.js'
import { detectBinary } from './detect.js'
import type { AgentRunOptions, AgentHandle, ProviderId } from './types.js'
import type { ChatEvent } from '../../shared/types.js'

/**
 * Resolve the provider binary and run one turn. `overrideBin` (from settings or
 * a test) takes precedence over auto-detection. Emits a friendly error and
 * returns a no-op handle when no binary can be resolved.
 */
export function runAgent(
  id: ProviderId,
  opts: AgentRunOptions,
  overrideBin: string | undefined,
  emit: (e: ChatEvent) => void,
): AgentHandle {
  const adapter = getAdapter(id)
  // Use the configured path when it resolves, otherwise auto-detect. We do NOT
  // hard-fail on a set-but-missing path: binaries move when a CLI updates (e.g.
  // codex relocating out of an nvm dir), and silently finding the installed one
  // is far better UX than telling the user it's "not found" when it is.
  const bin = detectBinary(adapter.binaryNames, overrideBin)
  if (!bin) {
    emit({
      kind: 'error',
      text: `${adapter.label} no encontrado. Instálalo o indica su ruta en Ajustes › IA.`,
    })
    return { stop: () => {} }
  }
  return adapter.run(bin, opts, emit)
}
