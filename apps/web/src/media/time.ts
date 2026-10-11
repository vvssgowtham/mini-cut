/**
 * Conversions between the browser's time (float seconds, from `HTMLMediaElement.currentTime`) and the
 * editor's time (integer milliseconds, see `editor/types.ts`).
 *
 * Convert once, at the edge. Everything inside the editor stays in `Ms`.
 */

import type { Ms } from '../editor/types'

/** Float seconds to integer milliseconds, rounded to the nearest millisecond. */
export function secondsToMs(_seconds: number): Ms {
  throw new Error('not implemented: secondsToMs')
}

/** Integer milliseconds to float seconds. */
export function msToSeconds(_ms: Ms): number {
  throw new Error('not implemented: msToSeconds')
}
