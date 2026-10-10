/**
 * Commands: every change to a Project is one of these objects.
 *
 * Two ideas make this file work:
 *
 * 1. **Inverse data, not snapshots.** `apply` returns the new project AND an `Op` that undoes it.
 *    A trim's inverse is another trim (back to the old in/out), so memory stays flat however long
 *    the session runs. Snapshotting the whole project per edit would grow without bound.
 *
 * 2. **The op set is closed under inversion.** delete inverts to insert, split inverts to merge,
 *    and those invert back. So undo is just "apply the inverse" — one code path, not two.
 *    `Command` is what the UI and the M7 agent may emit; `Op` adds the two internal ones.
 *
 * Every op is a plain JSON-serializable object, so M7 can have the LLM emit the same shapes.
 */

import type { Clip, Ms, Project, Track } from './types'

export type TrimOp = {
  type: 'trim'
  trackId: string
  clipId: string
  sourceIn: Ms
  sourceOut: Ms
}

export type MoveOp = {
  type: 'move'
  trackId: string
  clipId: string
  start: Ms
}

export type DeleteOp = {
  type: 'delete'
  trackId: string
  clipId: string
}

/**
 * Split one clip into two at an absolute timeline position.
 * Caller supplies both new ids so the op stays pure and testable (no hidden id generation).
 */
export type SplitOp = {
  type: 'split'
  trackId: string
  clipId: string
  /** Absolute timeline position. Must be strictly inside the clip. */
  atMs: Ms
  leftId: string
  rightId: string
}

/** Internal: the inverse of a delete. Puts a clip back at the exact index it was removed from. */
export type InsertOp = {
  type: 'insert'
  trackId: string
  index: number
  clip: Clip
}

/** Internal: the inverse of a split. Replaces the two halves with the original clip. */
export type MergeOp = {
  type: 'merge'
  trackId: string
  leftId: string
  rightId: string
  clip: Clip
}

/** What the UI and the AI agent are allowed to emit. */
export type Command = TrimOp | MoveOp | DeleteOp | SplitOp

/** Everything `apply` understands, including the two inverse-only ops. */
export type Op = Command | InsertOp | MergeOp

export type ApplyResult = {
  project: Project
  /** Apply this to get back exactly where you started. */
  inverse: Op
}

/**
 * Apply one op and return the new project plus its inverse.
 *
 * Rules you must hold to:
 * - Never mutate `project` or anything inside it. Copy the track and clip you touch; reuse the rest
 *   by reference (cheap, and lets M3 skip redrawing untouched tracks later).
 * - Throw on anything invalid (unknown track or clip, a split outside the clip, a trim that would
 *   make a clip zero-length or run past the source). Throwing beats silently producing a broken
 *   project: M7 relies on a bad op being rejected.
 * - `apply(project, apply(project, op).inverse)` must deep-equal `project`.
 *
 * Suggested shape: a `switch (op.type)` with a `default` that does an exhaustiveness check
 * (`const _never: never = op`), so adding an op later fails to compile until you handle it.
 */
export function apply(_project: Project, _op: Op): ApplyResult {
  throw new Error('not implemented: apply')
}

// --- helpers you will probably want. Implement or delete them; the tests do not call them. ---

/** Find a track by id, or throw. */
export function findTrack(_project: Project, _trackId: string): Track {
  throw new Error('not implemented: findTrack')
}

/** Find a clip's index within a track, or throw. */
export function findClipIndex(_track: Track, _clipId: string): number {
  throw new Error('not implemented: findClipIndex')
}

/** Return a new project with one track replaced. */
export function replaceTrack(_project: Project, _track: Track): Project {
  throw new Error('not implemented: replaceTrack')
}
