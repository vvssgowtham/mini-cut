/**
 * What is under the pointer.
 *
 * Kept out of the component on purpose: this is the part of the interaction that has real edge cases
 * (overlapping clips, handles wider than the clip itself), and inside a component none of it could be
 * tested without a browser.
 */

import { clipEnd, type Clip, type Ms } from '../editor/types'
import { CLIP_HEIGHT_PX, CLIP_TOP_PX, RULER_HEIGHT_PX } from './draw'
import { timeToX, visibleClips, type Viewport } from './viewport'

/** Grab zone at each end of a clip, in CSS pixels. */
export const TRIM_HANDLE_PX = 8

export type HitKind = 'trim-start' | 'trim-end' | 'body'

export type Hit = { clipId: string; kind: HitKind }

/**
 * Hit-test a point in canvas CSS pixels.
 *
 * Clips later in draw order sit on top, so this searches back to front — the clip you can see is the
 * one you grab. On a clip narrower than two handles the start handle wins, because a trim that
 * collapses a clip from the left is recoverable with undo, while guessing the other way tends to
 * surprise people mid-drag.
 */
export function hitTest(
  viewport: Viewport,
  clips: readonly Clip[],
  x: number,
  y: number,
): Hit | null {
  if (y < CLIP_TOP_PX || y > CLIP_TOP_PX + CLIP_HEIGHT_PX) return null

  const drawn = visibleClips(viewport, clips)
  for (let i = drawn.length - 1; i >= 0; i--) {
    const clip = drawn[i]
    if (!clip) continue

    const startX = timeToX(viewport, clip.start)
    const endX = timeToX(viewport, clipEnd(clip))
    if (x < startX || x > endX) continue

    if (x - startX <= TRIM_HANDLE_PX) return { clipId: clip.id, kind: 'trim-start' }
    if (endX - x <= TRIM_HANDLE_PX) return { clipId: clip.id, kind: 'trim-end' }
    return { clipId: clip.id, kind: 'body' }
  }
  return null
}

/**
 * How close to the playhead counts as grabbing it.
 *
 * Wider than the 1px line it draws, because a 1px target cannot be hit with a mouse. The ruler is
 * also a scrub target, which is the convention in every editor and gives a band you can always
 * reach even when the playhead is off screen.
 */
export const PLAYHEAD_GRAB_PX = 7

/** Whether a point should start scrubbing rather than editing a clip. */
export function isScrubTarget(viewport: Viewport, playheadMs: Ms, x: number, y: number): boolean {
  if (y <= RULER_HEIGHT_PX) return true
  return Math.abs(timeToX(viewport, playheadMs) - x) <= PLAYHEAD_GRAB_PX
}
