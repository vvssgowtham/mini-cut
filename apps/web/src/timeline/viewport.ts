/**
 * The viewport: which slice of the timeline is on screen, and how to map between time and pixels.
 *
 * This is the pure core of the timeline. Everything here is plain arithmetic with no canvas and no
 * DOM, which is why it is the part that can be unit tested — the drawing and the pointer handling
 * around it cannot be, so keeping the arithmetic out here is what makes the feature testable at all.
 *
 * Two coordinate systems:
 * - **Time**, in `Ms`, from the project model.
 * - **Pixels**, measured from the left edge of the canvas. CSS pixels, not device pixels; the
 *   `devicePixelRatio` scaling belongs in the draw code, not here.
 */

import type { Ms } from '../editor/types'

export type Viewport = {
  /** Time at the left edge of the canvas. */
  offsetMs: Ms
  /** Zoom. Larger means more pixels per millisecond, so a shorter span is visible. */
  pxPerMs: number
  /** Canvas width in CSS pixels. */
  widthPx: number
}

/** Zoom limits: ~1 pixel per 10 seconds out, ~1 pixel per millisecond in. */
export const MIN_PX_PER_MS = 0.0001
export const MAX_PX_PER_MS = 1

export function clampZoom(pxPerMs: number): number {
  return Math.min(MAX_PX_PER_MS, Math.max(MIN_PX_PER_MS, pxPerMs))
}

export function timeToX(viewport: Viewport, ms: Ms): number {
  return (ms - viewport.offsetMs) * viewport.pxPerMs
}

export function xToTime(viewport: Viewport, x: number): Ms {
  return viewport.offsetMs + x / viewport.pxPerMs
}

/** Time span currently visible, as a half-open range. */
export function visibleRange(viewport: Viewport): { startMs: Ms; endMs: Ms } {
  return {
    startMs: viewport.offsetMs,
    endMs: viewport.offsetMs + viewport.widthPx / viewport.pxPerMs,
  }
}

/**
 * Zoom around a fixed pixel position — the pointer, usually — so the time under the cursor stays put.
 *
 * Without this, zooming drifts: the user points at the moment they care about, zooms, and it slides
 * off screen.
 */
export function zoomAt(viewport: Viewport, anchorX: number, factor: number): Viewport {
  const anchorMs = xToTime(viewport, anchorX)
  const pxPerMs = clampZoom(viewport.pxPerMs * factor)
  return { ...viewport, pxPerMs, offsetMs: anchorMs - anchorX / pxPerMs }
}

/** Scroll by a pixel delta, never past the start of the timeline. */
export function panBy(viewport: Viewport, deltaPx: number): Viewport {
  return { ...viewport, offsetMs: Math.max(0, viewport.offsetMs + deltaPx / viewport.pxPerMs) }
}

/**
 * Clips overlapping the visible range, in draw order.
 *
 * Drawing every clip is what makes a long timeline stutter, so the draw code asks for this instead.
 * Clips are stored in insertion order (see `editor/types.ts`), so this sorts by `start` for drawing —
 * on a copy, never in place.
 */
export function visibleClips<T extends { start: Ms; durationMs: Ms }>(
  viewport: Viewport,
  clips: readonly T[],
): T[] {
  const { startMs, endMs } = visibleRange(viewport)
  return clips
    .filter((clip) => clip.start < endMs && clip.start + clip.durationMs > startMs)
    .sort((a, b) => a.start - b.start)
}
