/**
 * Conversions between the browser's time (float seconds, from `HTMLMediaElement.currentTime`) and the
 * editor's time (integer milliseconds, see `editor/types.ts`).
 *
 * Convert once, at the edge. Everything inside the editor stays in `Ms`.
 *
 * The two directions are deliberately asymmetric:
 *
 * - `secondsToMs` is the real boundary — it is where untrusted float time enters the editor — so it is
 *   strict and throws on anything that is not a finite, non-negative number.
 * - `msToSeconds` sits in the playback and render path, where throwing would turn a sub-millisecond
 *   rounding artifact into a crash mid-seek. `Ms` is a plain alias (`editor/types.ts`), and nothing
 *   upstream enforces integrality — `apply()` in `editor/commands.ts` never rounds — so a drag that
 *   computes `px * msPerPx` can produce a fractional value. It therefore rounds rather than throws.
 *   It still throws on negative or non-finite input, which is a logic error, not a precision artifact.
 */

import type { Ms } from '../editor/types'

/**
 * Float seconds to integer milliseconds, rounded to the nearest millisecond.
 *
 * Throws on `NaN`, `Infinity` and negative values.
 */
export function secondsToMs(_seconds: number): Ms {
  throw new Error('not implemented: secondsToMs')
}

/**
 * Integer milliseconds to float seconds.
 *
 * A fractional `ms` is rounded to the nearest millisecond rather than rejected (see the note above).
 * Throws on `NaN`, `Infinity` and negative values.
 */
export function msToSeconds(_ms: Ms): number {
  throw new Error('not implemented: msToSeconds')
}
