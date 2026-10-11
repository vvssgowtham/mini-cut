/**
 * Turning whatever IndexedDB hands back into a Project, or failing clearly.
 *
 * Everything here is untrusted: the row may have been written by an older build, by a newer build if
 * the user has two tabs on different deploys, or left half-written by a crash. The one outcome that
 * must never happen is a malformed project reaching the timeline, where a bad clip draws as a
 * zero-width smear that cannot be selected or deleted.
 */

import { CURRENT_PROJECT_VERSION, projectSchema, versionProbeSchema } from '@mini-cut/shared'
import type { StoredProject } from '@mini-cut/shared'
import type { Project } from '../editor/types'

/**
 * Compile-time check that the runtime schema and the editor's type have not drifted apart. If someone
 * adds a field to `Project` without adding it to `projectSchema`, this stops compiling.
 */
const _schemaMatchesType: Project = {} as StoredProject
void _schemaMatchesType

export type RestoreFailure =
  /** Not a project at all: wrong shape, bad values, or not an object. */
  | 'malformed'
  /** Written by a newer build. The data may be fine; this build just cannot read it. */
  | 'too-new'

export class RestoreError extends Error {
  readonly reason: RestoreFailure

  constructor(reason: RestoreFailure, message: string) {
    super(message)
    this.name = 'RestoreError'
    this.reason = reason
  }
}

/**
 * Parse a stored value into a Project.
 *
 * A newer version is reported separately from junk, because the two deserve different handling: junk
 * should be discarded and the user given an empty project, whereas a newer save should be left alone
 * so the user can reopen it in the tab that wrote it instead of having their work quietly replaced.
 */
export function parseStoredProject(raw: unknown): Project {
  const probe = versionProbeSchema.safeParse(raw)
  if (probe.success && probe.data.version > CURRENT_PROJECT_VERSION) {
    throw new RestoreError(
      'too-new',
      `saved by a newer version of Mini Cut (${probe.data.version}, this build reads ${CURRENT_PROJECT_VERSION})`,
    )
  }

  const parsed = projectSchema.safeParse(raw)
  if (!parsed.success) {
    throw new RestoreError('malformed', parsed.error.issues[0]?.message ?? 'not a valid project')
  }
  return parsed.data
}

/** Parse, or fall back to `fallback` when the stored value is junk. A newer save still throws. */
export function parseStoredProjectOr(raw: unknown, fallback: Project): Project {
  try {
    return parseStoredProject(raw)
  } catch (error) {
    if (error instanceof RestoreError && error.reason === 'malformed') return fallback
    throw error
  }
}
