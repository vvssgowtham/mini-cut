/**
 * Where a clip is allowed to sit.
 *
 * A single track cannot show two clips at once, so overlapping them has no meaning — and until now
 * nothing stopped it. Dragging a clip onto its neighbour produced a timeline that looked fine, drew
 * fine, and then refused to export with "export cannot tell which should win". The editor let you
 * build a state it would not accept.
 *
 * Prevention beats detection here: a drag that cannot overlap never creates the problem, and the
 * clip stops against its neighbour the way it does in every other editor.
 */

import { clipEnd, type Clip, type Ms } from './types'

/**
 * The furthest a clip may move in each direction without overlapping a neighbour.
 *
 * Neighbours are the clips that would sit either side once this one is removed, found by timeline
 * position rather than array order — `track.clips` keeps insertion order, so the two differ as soon
 * as anything has been moved.
 */
export function placementBounds(
  clips: readonly Clip[],
  clipId: string,
): { minStart: Ms; maxStart: Ms } {
  const moving = clips.find((clip) => clip.id === clipId)
  if (!moving) return { minStart: 0, maxStart: Number.POSITIVE_INFINITY }

  const duration = clipEnd(moving) - moving.start
  const others = clips.filter((clip) => clip.id !== clipId).sort((a, b) => a.start - b.start)

  // The neighbour before is the last one ending at or before this clip starts; after it, the first
  // one starting at or after this clip ends. Judged from where the clip is now, which is what makes
  // a drag feel like it slides between its neighbours rather than jumping past them.
  const before = others.filter((clip) => clipEnd(clip) <= moving.start).pop()
  const after = others.find((clip) => clip.start >= clipEnd(moving))

  return {
    minStart: before ? clipEnd(before) : 0,
    maxStart: after
      ? Math.max(before ? clipEnd(before) : 0, after.start - duration)
      : Number.POSITIVE_INFINITY,
  }
}

/** A desired start position, pulled back to the nearest legal one. */
export function clampStart(clips: readonly Clip[], clipId: string, desiredStart: Ms): Ms {
  const { minStart, maxStart } = placementBounds(clips, clipId)
  return Math.round(Math.min(maxStart, Math.max(minStart, Math.max(0, desiredStart))))
}

/** Pairs of clips that overlap, for reporting a project that is already in that state. */
export function findOverlaps(clips: readonly Clip[]): { left: Clip; right: Clip }[] {
  const ordered = [...clips].sort((a, b) => a.start - b.start)
  const overlaps: { left: Clip; right: Clip }[] = []

  for (let i = 1; i < ordered.length; i++) {
    const left = ordered[i - 1]
    const right = ordered[i]
    if (left && right && right.start < clipEnd(left)) overlaps.push({ left, right })
  }
  return overlaps
}

/**
 * The furthest a clip's end may extend before it would run into the clip after it.
 *
 * Dragging the right-hand trim handle grows a clip, so it needs the same guard as moving one.
 */
export function maxEndFor(clips: readonly Clip[], clipId: string): Ms {
  const moving = clips.find((clip) => clip.id === clipId)
  if (!moving) return Number.POSITIVE_INFINITY

  const after = clips
    .filter((clip) => clip.id !== clipId && clip.start >= clipEnd(moving))
    .sort((a, b) => a.start - b.start)[0]

  return after ? after.start : Number.POSITIVE_INFINITY
}

/**
 * Push overlapping clips apart so none sits on top of another.
 *
 * For healing a project saved before overlap was prevented. Later clips move right to sit flush
 * with the one before, which keeps every frame of footage — truncating would silently discard
 * something the user recorded, and that is a worse way to be wrong.
 */
export function resolveOverlaps(clips: readonly Clip[]): Clip[] {
  const ordered = [...clips].sort((a, b) => a.start - b.start)
  const resolved: Clip[] = []
  let earliestFree = 0

  for (const clip of ordered) {
    const start = Math.max(clip.start, earliestFree)
    resolved.push(start === clip.start ? clip : { ...clip, start })
    earliestFree = start + (clip.sourceOut - clip.sourceIn)
  }
  return resolved
}
