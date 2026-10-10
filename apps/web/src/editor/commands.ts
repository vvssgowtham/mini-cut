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

import { clipEnd, type Clip, type Ms, type Project, type Track } from './types'

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
export function apply(project: Project, op: Op): ApplyResult {
  switch (op.type) {
    case 'trim': {
      const track = findTrack(project, op.trackId)
      const index = findClipIndex(track, op.clipId)
      const clip = clipAt(track, index)

      // Only reject an empty or inverted window. Do NOT reject a window wider than the clip's
      // current one: a trim's inverse has to widen back to the original window, so that
      // restriction would break undo.
      if (op.sourceOut <= op.sourceIn) {
        throw new Error(`trim window [${op.sourceIn}, ${op.sourceOut}) is empty or inverted`)
      }

      const clips = [...track.clips]
      clips[index] = { ...clip, sourceIn: op.sourceIn, sourceOut: op.sourceOut }

      return {
        project: replaceTrack(project, { ...track, clips }),
        inverse: {
          type: 'trim',
          trackId: op.trackId,
          clipId: op.clipId,
          sourceIn: clip.sourceIn,
          sourceOut: clip.sourceOut,
        },
      }
    }

    case 'move': {
      const track = findTrack(project, op.trackId)
      const index = findClipIndex(track, op.clipId)
      const clip = clipAt(track, index)

      if (op.start < 0) {
        throw new Error(`move start ${op.start} is before the start of the timeline`)
      }

      const clips = [...track.clips]
      clips[index] = { ...clip, start: op.start }

      return {
        project: replaceTrack(project, { ...track, clips }),
        inverse: { type: 'move', trackId: op.trackId, clipId: op.clipId, start: clip.start },
      }
    }

    case 'delete': {
      const track = findTrack(project, op.trackId)
      const index = findClipIndex(track, op.clipId)
      const clip = clipAt(track, index)

      const clips = [...track.clips]
      clips.splice(index, 1)

      return {
        project: replaceTrack(project, { ...track, clips }),
        inverse: { type: 'insert', trackId: op.trackId, index, clip },
      }
    }

    case 'split': {
      const track = findTrack(project, op.trackId)
      const index = findClipIndex(track, op.clipId)
      const clip = clipAt(track, index)
      const end = clipEnd(clip)

      if (op.atMs <= clip.start || op.atMs >= end) {
        throw new Error(`split at ${op.atMs} is outside clip ${clip.id} [${clip.start}, ${end})`)
      }
      if (op.leftId === op.rightId) {
        throw new Error(`split needs two different ids, both are ${op.leftId}`)
      }
      if (track.clips.some((existing) => existing.id === op.leftId || existing.id === op.rightId)) {
        throw new Error(`split id ${op.leftId}/${op.rightId} is already taken on track ${track.id}`)
      }

      // The timeline offset equals the source offset, so both halves stay in the same media:
      // left gets source [sourceIn, sourceIn + offset), right keeps the rest, and they meet
      // exactly at `atMs`.
      const offset = op.atMs - clip.start
      const left: Clip = {
        id: op.leftId,
        sourceId: clip.sourceId,
        sourceIn: clip.sourceIn,
        sourceOut: clip.sourceIn + offset,
        start: clip.start,
      }
      const right: Clip = {
        id: op.rightId,
        sourceId: clip.sourceId,
        sourceIn: clip.sourceIn + offset,
        sourceOut: clip.sourceOut,
        start: op.atMs,
      }

      const clips = [...track.clips]
      clips.splice(index, 1, left, right)

      return {
        project: replaceTrack(project, { ...track, clips }),
        inverse: {
          type: 'merge',
          trackId: op.trackId,
          leftId: op.leftId,
          rightId: op.rightId,
          clip,
        },
      }
    }

    case 'insert': {
      const track = findTrack(project, op.trackId)

      if (!Number.isInteger(op.index) || op.index < 0 || op.index > track.clips.length) {
        throw new Error(
          `insert index ${op.index} is outside track ${track.id} (0..${track.clips.length})`,
        )
      }
      if (track.clips.some((existing) => existing.id === op.clip.id)) {
        throw new Error(`clip ${op.clip.id} already exists on track ${track.id}`)
      }

      const clips = [...track.clips]
      clips.splice(op.index, 0, op.clip)

      return {
        project: replaceTrack(project, { ...track, clips }),
        inverse: { type: 'delete', trackId: op.trackId, clipId: op.clip.id },
      }
    }

    case 'merge': {
      const track = findTrack(project, op.trackId)
      const leftIndex = findClipIndex(track, op.leftId)
      const rightIndex = findClipIndex(track, op.rightId)

      if (rightIndex !== leftIndex + 1) {
        throw new Error(`merge needs ${op.leftId} and ${op.rightId} to sit next to each other`)
      }

      // Read the left half before replacing it: its end is where the split happened, so it is
      // exactly what the inverse `split` op needs for `atMs`.
      const left = clipAt(track, leftIndex)
      const clips = [...track.clips]
      clips.splice(leftIndex, 2, op.clip)

      return {
        project: replaceTrack(project, { ...track, clips }),
        inverse: {
          type: 'split',
          trackId: op.trackId,
          clipId: op.clip.id,
          atMs: clipEnd(left),
          leftId: op.leftId,
          rightId: op.rightId,
        },
      }
    }

    default: {
      // If this line stops compiling, someone added an op without teaching `apply` about it.
      const _never: never = op
      throw new Error(`unhandled op: ${JSON.stringify(_never)}`)
    }
  }
}

// --- helpers. The tests call none of them; they exist to keep `apply` readable. ---

/** Find a track by id, or throw. */
export function findTrack(project: Project, trackId: string): Track {
  const track = project.tracks.find((candidate) => candidate.id === trackId)
  if (!track) throw new Error(`unknown track ${trackId}`)
  return track
}

/** Find a clip's index within a track, or throw. */
export function findClipIndex(track: Track, clipId: string): number {
  const index = track.clips.findIndex((clip) => clip.id === clipId)
  if (index === -1) throw new Error(`unknown clip ${clipId} on track ${track.id}`)
  return index
}

/**
 * The clip at `index`. `findClipIndex` already ruled out a missing clip; this check exists only
 * because `noUncheckedIndexedAccess` makes every array read look possibly empty, and an honest
 * throw beats an `as Clip` cast.
 */
function clipAt(track: Track, index: number): Clip {
  const clip = track.clips[index]
  if (!clip) throw new Error(`clip missing at index ${index} on track ${track.id}`)
  return clip
}

/** Return a new project with one track replaced. Every other track stays the same object. */
export function replaceTrack(project: Project, track: Track): Project {
  return {
    ...project,
    tracks: project.tracks.map((candidate) => (candidate.id === track.id ? track : candidate)),
  }
}
