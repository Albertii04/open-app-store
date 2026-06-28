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
  try {
    const prefix = execFileSync('npm', ['prefix', '-g'], { encoding: 'utf8' }).trim()
    if (prefix) dirs.push(join(prefix, 'bin'))
  } catch {
    /* npm not present — ignore */
  }
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
