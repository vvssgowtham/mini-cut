/**
 * Whether a clip edit is possible right now, and the command to do it.
 *
 * A button that is enabled and then fails is worse than one that is disabled, so the toolbar needs
 * to know in advance — and the reason, so the control can say why rather than just look broken.
 *
 * Pure, so the rules live in one place and are tested once instead of being re-derived by every
 * caller that wants to grey out a button.
 */

import type { Command } from './commands'
import { clipEnd, type Clip, type Ms, type Project } from './types'

export type Availability =
  { available: true; command: Command } | { available: false; reason: string }

function locate(
  project: Project,
  clipId: string | null,
): { clip: Clip; trackId: string; index: number; clips: Clip[] } | null {
  if (!clipId) return null
  for (const track of project.tracks) {
    const index = track.clips.findIndex((candidate) => candidate.id === clipId)
    if (index !== -1) {
      return { clip: track.clips[index]!, trackId: track.id, index, clips: track.clips }
    }
  }
  return null
}

/**
 * Split the selected clip at the playhead.
 *
 * The playhead has to be strictly inside the clip: splitting on an edge would produce a zero-length
 * half, which is not a clip.
 */
export function splitAvailability(
  project: Project,
  selectedClipId: string | null,
  playheadMs: Ms,
  newId: () => string = () => crypto.randomUUID(),
): Availability {
  const found = locate(project, selectedClipId)
  if (!found) return { available: false, reason: 'Select a clip to split.' }

  const atMs = Math.round(playheadMs)
  if (atMs <= found.clip.start || atMs >= clipEnd(found.clip)) {
    return { available: false, reason: 'Move the playhead inside the clip to split it.' }
  }

  return {
    available: true,
    command: {
      type: 'split',
      trackId: found.trackId,
      clipId: found.clip.id,
      atMs,
      leftId: newId(),
      rightId: newId(),
    },
  }
}

/**
 * Join the selected clip with the one after it on the timeline.
 *
 * "After" means by start position, not by array index. `track.clips` keeps insertion order, so the
 * two diverge as soon as anything is moved — and looking up the array neighbour then offered the
 * wrong clip, or refused outright while the next clip sat plainly adjacent on screen.
 *
 * Only joins genuinely continuous clips: same media, no cut taken out between them, and touching on
 * the timeline. Joining across a cut would quietly reinstate footage the user removed.
 */
export function joinAvailability(
  project: Project,
  selectedClipId: string | null,
  newId: () => string = () => crypto.randomUUID(),
): Availability {
  const found = locate(project, selectedClipId)
  if (!found) return { available: false, reason: 'Select a clip to join.' }

  const { clip: left } = found
  const leftEnd = clipEnd(left)
  // The nearest clip starting at or after this one ends.
  const right = found.clips
    .filter((candidate) => candidate.id !== left.id && candidate.start >= leftEnd)
    .sort((a, b) => a.start - b.start)[0]

  if (!right) return { available: false, reason: 'Nothing after this clip to join it to.' }
  if (left.sourceId !== right.sourceId) {
    return { available: false, reason: 'These clips come from different media.' }
  }
  if (left.sourceOut !== right.sourceIn) {
    return { available: false, reason: 'A cut was made between these clips.' }
  }
  if (clipEnd(left) !== right.start) {
    return { available: false, reason: 'There is a gap between these clips.' }
  }

  return {
    available: true,
    command: {
      type: 'join',
      trackId: found.trackId,
      leftId: left.id,
      rightId: right.id,
      mergedId: newId(),
    },
  }
}

/**
 * Several commands at once, with a note of what they would do.
 *
 * Closing a gap moves every clip after it, so unlike split or join it cannot be one command — and
 * the caller needs to know how much is about to move before offering it.
 */
export type RippleAvailability =
  { available: true; commands: Command[]; closedMs: Ms } | { available: false; reason: string }

/**
 * Pull the selected clip back against the one before it, bringing everything after it along.
 *
 * This is the piece that was missing. Join only ever reunited two halves of a split, so two
 * separate imports that did not quite meet could be nudged together by eye and no other way.
 * Later clips move by the same amount, so the spacing between them is preserved — the gap closes,
 * the rest of the cut does not rearrange itself.
 */
export function closeGapAvailability(
  project: Project,
  selectedClipId: string | null,
): RippleAvailability {
  const found = locate(project, selectedClipId)
  if (!found) return { available: false, reason: 'Select a clip to close the gap before it.' }

  const { clip: selected, trackId, clips } = found

  // By timeline position rather than array order, since clips are stored in insertion order.
  const previousEnd = clips
    .filter((candidate) => candidate.id !== selected.id && clipEnd(candidate) <= selected.start)
    .reduce((furthest, candidate) => Math.max(furthest, clipEnd(candidate)), 0)

  const closedMs = selected.start - previousEnd
  if (closedMs <= 0) return { available: false, reason: 'There is no gap before this clip.' }

  // Earliest first: each move is checked against the clips already moved, and shifting left in
  // timeline order means a clip never lands on one that has not moved yet.
  const commands = clips
    .filter((candidate) => candidate.start >= selected.start)
    .sort((a, b) => a.start - b.start)
    .map((clip): Command => ({
      type: 'move',
      trackId,
      clipId: clip.id,
      start: clip.start - closedMs,
    }))

  return { available: true, commands, closedMs }
}
