/**
 * Editing the timeline from the keyboard.
 *
 * Until this existed every edit needed a pointer drag, so the editor's core function was unusable
 * without a mouse. That is a failure, not a missing convenience.
 *
 * The mapping and the resulting commands are pure functions rather than handlers inside the
 * component, for the same reason `hitTest` is: this is where the decisions live — which clip is
 * next, whether a trim would collapse a clip, whether the playhead is even inside the selection —
 * and none of it would be testable buried in an event listener.
 *
 * Bindings follow the conventions of editors people already know: arrows to walk the timeline,
 * `S` to split at the playhead, and bracket keys to trim an edge to the playhead.
 */

import type { Command } from '../editor/commands'
import { clipEnd, type Clip, type Ms, type Project } from '../editor/types'

/** A nudge is a visible step rather than a single frame; shift makes it a second. */
export const NUDGE_MS = 100
export const NUDGE_LARGE_MS = 1000

export type KeyAction =
  | { type: 'select'; direction: -1 | 1 }
  | { type: 'nudge'; deltaMs: Ms }
  /** Trim the selected clip's start or end to the playhead, the standard editing gesture. */
  | { type: 'trim-in' }
  | { type: 'trim-out' }
  | { type: 'split' }
  | { type: 'delete' }

export type KeyEventLike = {
  key: string
  shiftKey?: boolean
  altKey?: boolean
  ctrlKey?: boolean
  metaKey?: boolean
}

/**
 * Map a key press to an intent, or null when the key is not ours.
 *
 * Anything with ctrl or cmd held is left alone: those belong to undo, redo and the browser, and
 * quietly stealing them is how a web app breaks a user's muscle memory.
 */
export function keyToAction(event: KeyEventLike): KeyAction | null {
  if (event.ctrlKey || event.metaKey) return null

  const nudge = event.shiftKey ? NUDGE_LARGE_MS : NUDGE_MS

  switch (event.key) {
    case 'ArrowLeft':
      return event.altKey ? { type: 'nudge', deltaMs: -nudge } : { type: 'select', direction: -1 }
    case 'ArrowRight':
      return event.altKey ? { type: 'nudge', deltaMs: nudge } : { type: 'select', direction: 1 }
    case '[':
      return { type: 'trim-in' }
    case ']':
      return { type: 'trim-out' }
    case 's':
    case 'S':
      return { type: 'split' }
    case 'Delete':
    case 'Backspace':
      return { type: 'delete' }
    default:
      return null
  }
}

export type KeyResult = {
  commands: Command[]
  /** The selection after this action; `undefined` leaves it alone. */
  selection?: string | null
  /** Why nothing happened, for the status line. Silent failure is worse than a sentence. */
  message?: string
}

const NOTHING: KeyResult = { commands: [] }

/** Clips in timeline order, which is the order the keyboard walks them in. */
function orderedClips(project: Project): { clip: Clip; trackId: string }[] {
  return project.tracks
    .flatMap((track) => track.clips.map((clip) => ({ clip, trackId: track.id })))
    .sort((a, b) => a.clip.start - b.clip.start)
}

/**
 * Turn an intent into commands against the current project.
 *
 * Returns a message rather than throwing when an action does not apply: a key press that cannot do
 * anything is normal use, not an error.
 */
export function applyKeyAction(
  action: KeyAction,
  project: Project,
  selectedClipId: string | null,
  playheadMs: Ms,
  newId: () => string = () => crypto.randomUUID(),
): KeyResult {
  const ordered = orderedClips(project)
  if (ordered.length === 0) return NOTHING

  if (action.type === 'select') {
    const index = ordered.findIndex((entry) => entry.clip.id === selectedClipId)
    // Nothing selected yet: step in from the end you are moving away from.
    if (index === -1) {
      const first = action.direction === 1 ? ordered[0] : ordered[ordered.length - 1]
      return { commands: [], selection: first?.clip.id ?? null }
    }
    const next = Math.min(ordered.length - 1, Math.max(0, index + action.direction))
    return { commands: [], selection: ordered[next]?.clip.id ?? null }
  }

  const entry = ordered.find((candidate) => candidate.clip.id === selectedClipId)
  if (!entry) return { commands: [], message: 'Select a clip first.' }
  const { clip, trackId } = entry

  switch (action.type) {
    case 'nudge': {
      const start = Math.max(0, clip.start + action.deltaMs)
      if (start === clip.start) return NOTHING
      return { commands: [{ type: 'move', trackId, clipId: clip.id, start }] }
    }

    case 'trim-in': {
      // Trimming the in point to the playhead shortens from the left, so the clip's start on the
      // timeline moves with it — otherwise the footage would slide under a fixed frame.
      const deltaMs = Math.round(playheadMs - clip.start)
      const sourceIn = clip.sourceIn + deltaMs
      if (deltaMs === 0) return NOTHING
      if (sourceIn < 0 || sourceIn >= clip.sourceOut) {
        return { commands: [], message: 'Playhead is outside the clip.' }
      }
      return {
        commands: [
          { type: 'trim', trackId, clipId: clip.id, sourceIn, sourceOut: clip.sourceOut },
          { type: 'move', trackId, clipId: clip.id, start: Math.round(playheadMs) },
        ],
      }
    }

    case 'trim-out': {
      const sourceOut = clip.sourceIn + Math.round(playheadMs - clip.start)
      if (sourceOut <= clip.sourceIn) {
        return { commands: [], message: 'Playhead is outside the clip.' }
      }
      if (sourceOut === clip.sourceOut) return NOTHING
      return {
        commands: [{ type: 'trim', trackId, clipId: clip.id, sourceIn: clip.sourceIn, sourceOut }],
      }
    }

    case 'split': {
      const atMs = Math.round(playheadMs)
      if (atMs <= clip.start || atMs >= clipEnd(clip)) {
        return { commands: [], message: 'Move the playhead inside the clip to split it.' }
      }
      return {
        commands: [
          { type: 'split', trackId, clipId: clip.id, atMs, leftId: newId(), rightId: newId() },
        ],
      }
    }

    case 'delete':
      return { commands: [{ type: 'delete', trackId, clipId: clip.id }], selection: null }
  }
}
