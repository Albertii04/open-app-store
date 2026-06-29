import type { ToolManifest } from '@openappstore/sdk'

export type ToolSource = 'builtin' | 'installed'

/**
 * Per-webContents registry that tracks which tool manifest (+ source) owns each
 * renderer. Used by the capability broker to authorize IPC calls.
 *
 * Kept in its own module so both broker.ts and authoring.ts can import it
 * without creating a circular dependency.
 */
const byWc = new Map<number, { manifest: ToolManifest; source: ToolSource }>()

export function registerToolView(
  webContentsId: number,
  manifest: ToolManifest,
  source: ToolSource,
): void {
  byWc.set(webContentsId, { manifest, source })
}

export function unregisterToolView(webContentsId: number): void {
  byWc.delete(webContentsId)
}

/** Look up the registered manifest + source for a webContents, or undefined. */
export function lookupToolView(
  webContentsId: number,
): { manifest: ToolManifest; source: ToolSource } | undefined {
  return byWc.get(webContentsId)
}
