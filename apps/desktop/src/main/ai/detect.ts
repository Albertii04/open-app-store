import { existsSync, accessSync, constants } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { execFileSync } from 'node:child_process'

function isExec(p: string): boolean {
  try {
    accessSync(p, constants.X_OK)
    return true
  } catch {
    return false
  }
}

// Cache the npm global prefix so candidateDirs() doesn't shell out on every AI turn.
let _npmGlobalPrefix: string | undefined

/** Directories an installed agent CLI is commonly found in (macOS/Linux). */
export function candidateDirs(): string[] {
  const dirs = [
    '/opt/homebrew/bin',
    '/usr/local/bin',
    join(homedir(), '.local/bin'),
    join(homedir(), '.codex/bin'),
    join(homedir(), '.opencode/bin'),
  ]
  for (const d of (process.env.PATH ?? '').split(':')) if (d) dirs.push(d)
  if (_npmGlobalPrefix === undefined) {
    try {
      _npmGlobalPrefix = execFileSync('npm', ['prefix', '-g'], { encoding: 'utf8' }).trim()
    } catch {
      _npmGlobalPrefix = '' // npm not present
    }
  }
  if (_npmGlobalPrefix) dirs.push(join(_npmGlobalPrefix, 'bin'))
  return [...new Set(dirs)]
}

/**
 * Resolve a provider binary. `override` (user-set absolute path) wins if it
 * exists + is executable; otherwise scan `dirs` (defaults to candidateDirs()).
 */
export function detectBinary(
  binaryNames: string[],
  override?: string,
  dirs: string[] = candidateDirs(),
): string | null {
  if (override && existsSync(override) && isExec(override)) return override
  for (const dir of dirs) {
    for (const name of binaryNames) {
      const p = join(dir, name)
      if (existsSync(p) && isExec(p)) return p
    }
  }
  return null
}
