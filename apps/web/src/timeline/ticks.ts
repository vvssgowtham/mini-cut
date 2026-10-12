/**
 * Choosing the ruler's tick interval for the current zoom.
 *
 * A ruler is only useful if its labels are readable and land on round numbers. Dividing the visible
 * span into N equal parts gives intervals like "every 237 ms", which nobody can read against. So the
 * interval is picked from a fixed ladder of intervals people actually think in.
 *
 * The ladder is not decimal, because time is not: it runs 1, 2, 5, 10, 15, 30 within each unit, so it
 * steps through seconds to quarter-minutes to minutes the way a clock does. A decimal ladder would
 * offer 100-second ticks, which is meaningless on a timeline.
 */

import type { Ms } from '../editor/types'

const SECOND = 1000
const MINUTE = 60 * SECOND
const HOUR = 60 * MINUTE

export const TICK_LADDER_MS: readonly Ms[] = [
  100,
  250,
  500,
  SECOND,
  2 * SECOND,
  5 * SECOND,
  10 * SECOND,
  15 * SECOND,
  30 * SECOND,
  MINUTE,
  2 * MINUTE,
  5 * MINUTE,
  10 * MINUTE,
  15 * MINUTE,
  30 * MINUTE,
  HOUR,
]

/**
 * The smallest interval on the ladder whose ticks are at least `minSpacingPx` apart.
 *
 * Falls back to the largest interval when even that is too tight — at a far enough zoom-out nothing
 * on the ladder fits, and a crowded ruler beats no ruler.
 */
export function chooseTickIntervalMs(pxPerMs: number, minSpacingPx: number): Ms {
  const last = TICK_LADDER_MS[TICK_LADDER_MS.length - 1] ?? HOUR
  if (!(pxPerMs > 0)) return last

  return TICK_LADDER_MS.find((interval) => interval * pxPerMs >= minSpacingPx) ?? last
}

/**
 * Tick positions covering the visible range, in ascending order.
 *
 * Starts at the first multiple of `intervalMs` at or before the left edge, so ticks stay anchored to
 * absolute time as you scroll rather than sliding with the viewport.
 */
export function tickPositions(startMs: Ms, endMs: Ms, intervalMs: Ms): Ms[] {
  if (!(intervalMs > 0) || !Number.isFinite(startMs) || !Number.isFinite(endMs)) return []
  if (endMs < startMs) return []

  const first = Math.floor(startMs / intervalMs) * intervalMs
  const positions: Ms[] = []
  for (let ms = first; ms <= endMs; ms += intervalMs) {
    if (ms >= 0) positions.push(ms)
  }
  return positions
}

/**
 * Whether a tick should carry a label.
 *
 * Every tick labelled is noise at a tight zoom, so minor ticks stay bare and every `labelEvery`-th
 * one is labelled. Keyed to absolute time rather than index, so a label does not jump between ticks
 * as the view scrolls.
 */
export function isMajorTick(ms: Ms, intervalMs: Ms, labelEvery: number): boolean {
  if (labelEvery <= 1) return true
  return Math.round(ms / intervalMs) % labelEvery === 0
}
