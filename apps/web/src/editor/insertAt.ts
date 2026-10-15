/**
 * Dropping new footage into the middle of a cut.
 *
 * Import used to append, always, which made a perfectly reasonable sequence impossible: split a
 * three-minute take at ten seconds, import the clip meant to go in the hole, and watch it land at
 * the far end of the timeline instead. The footage arrived; it just arrived somewhere else.
 *
 * An insert is a ripple: the new clip takes its place and everything from that point on slides
 * right by exactly its length, so nothing is overwritten and the relative spacing of the rest of
 * the cut survives. Where the playhead sits inside an existing clip, that clip is split first —
 * the insert goes between the halves rather than on top of one of them.
 *
 * Pure, and returning commands rather than a project, so the whole thing lands as one entry in the
 * undo history and one `Ctrl+Z` puts the timeline back exactly as it was.
 */

import type { Command } from './commands'
import { clipEnd, type Clip, type Ms, type Track } from './types'

/** The new footage, before it knows where it goes. */
export type IncomingClip = Pick<Clip, 'sourceId' | 'sourceIn' | 'sourceOut'>

/**
 * Commands that place `incoming` at `atMs`, and the clip they will produce.
 *
 * The caller needs the clip back to select it and to park the playhead, and cannot work it out
 * from the commands without re-deriving the placement rules.
 */
export function insertAtCommands(
  track: Track,
  incoming: IncomingClip,
  atMs: Ms,
  newId: () => string = () => crypto.randomUUID(),
): { commands: Command[]; clip: Clip } {
  const duration = incoming.sourceOut - incoming.sourceIn
  const ordered = [...track.clips].sort((a, b) => a.start - b.start)
  const end = ordered.reduce((furthest, clip) => Math.max(furthest, clipEnd(clip)), 0)
  const at = Math.max(0, Math.round(atMs))

  // Past the last clip there is nothing to ripple, and nothing to be gained by honouring the
  // playhead exactly: starting at `end` appends, while starting at `at` would leave a gap of
  // however far the playhead happens to have run on.
  if (at >= end) {
    const clip = { id: newId(), ...incoming, start: end }
    return {
      commands: [{ type: 'insert', trackId: track.id, index: track.clips.length, clip }],
      clip,
    }
  }

  const commands: Command[] = []

  // Strictly inside, so neither half comes out empty. A playhead resting on a boundary already has
  // its hole and needs no split.
  const covering = ordered.find((clip) => at > clip.start && at < clipEnd(clip))
  const shifting = ordered
    .filter((clip) => clip.start >= at)
    .map((clip) => ({ id: clip.id, start: clip.start }))

  if (covering) {
    const leftId = newId()
    const rightId = newId()
    commands.push({
      type: 'split',
      trackId: track.id,
      clipId: covering.id,
      atMs: at,
      leftId,
      rightId,
    })
    shifting.push({ id: rightId, start: at })
  }

  // Furthest first. Each move is checked against the clips as they stand, so shifting right in
  // reverse timeline order means a clip never lands on one that has not moved out of the way yet.
  for (const clip of shifting.sort((a, b) => b.start - a.start)) {
    commands.push({
      type: 'move',
      trackId: track.id,
      clipId: clip.id,
      start: clip.start + duration,
    })
  }

  const clip = { id: newId(), ...incoming, start: at }
  // The index is an array position, not a timeline one — order on screen comes from `start` — so
  // appending is correct however many clips the split added.
  commands.push({ type: 'insert', trackId: track.id, index: track.clips.length, clip })

  return { commands, clip }
}
