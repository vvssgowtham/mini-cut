/**
 * Reading `apps/server/.env`.
 *
 * Done here rather than with node's `--env-file` flag, which has to survive being passed through
 * two layers of npm scripts and errors outright if the file is absent — and the file is absent in
 * CI, in tests, and on any host that supplies its configuration as real environment variables.
 *
 * Real environment variables always win. A deployed container sets them directly, and a stale local
 * file silently overriding production configuration is a bad way to spend an afternoon.
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Relative to this file, not the working directory: the server may be started from anywhere. */
const ENV_PATH = join(dirname(dirname(fileURLToPath(import.meta.url))), '.env')

/** `KEY=value` per line. Comments, blanks and surrounding quotes are ignored. */
export function parseEnvFile(contents: string): Record<string, string> {
  const values: Record<string, string> = {}

  for (const line of contents.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue

    const separator = trimmed.indexOf('=')
    if (separator <= 0) continue

    const key = trimmed.slice(0, separator).trim()
    const raw = trimmed.slice(separator + 1).trim()
    // A value may be quoted; the quotes are syntax, not part of the key.
    const unquoted = raw.replace(/^(['"])(.*)\1$/, '$2')
    if (unquoted) values[key] = unquoted
  }
  return values
}

/**
 * Load the file into `process.env`, leaving anything already set alone.
 *
 * Silent when there is no file: running without one is normal, not a problem to announce.
 */
export function loadEnvFile(path = ENV_PATH): void {
  let contents: string
  try {
    contents = readFileSync(path, 'utf8')
  } catch {
    return
  }

  for (const [key, value] of Object.entries(parseEnvFile(contents))) {
    if (process.env[key] === undefined) process.env[key] = value
  }
}
