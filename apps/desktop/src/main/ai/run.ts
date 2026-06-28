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
  // When an explicit path is provided, do not fall back to dir scanning — if
  // that path is wrong the user needs a clear error, not a silent fallback.
  const bin = detectBinary(
    adapter.binaryNames,
    overrideBin,
    overrideBin !== undefined ? [] : undefined,
  )
  if (!bin) {
    emit({
      kind: 'error',
      text: `${adapter.label} no encontrado. Instálalo o indica su ruta en Ajustes › IA.`,
    })
    return { stop: () => {} }
  }
  return adapter.run(bin, opts, emit)
}
