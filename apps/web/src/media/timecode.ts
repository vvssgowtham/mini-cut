/**
 * Timecode: the editor's native way of naming a moment.
 *
 * `HH:MM:SS:FF` — the last pair is frames, not hundredths, which is what distinguishes timecode from
 * an ordinary duration. An editor reads a cut point in frames because that is the smallest unit they
 * can actually cut on.
 *
 * The project stores milliseconds (see `editor/types.ts`), so frames are derived at display time from
 * an assumed rate. That is a deliberate limit: variable-frame-rate phone video has no single rate, so
 * the frame column is a readable approximation rather than a guarantee — the millisecond value
 * underneath it is the truth.
 */

import type { Ms } from '../editor/types'

/** Assumed display rate. Most phone and web video is 30, and nothing cuts on the frame column yet. */
export const DISPLAY_FPS = 30

const pad = (value: number) => String(value).padStart(2, '0')

/**
 * Format milliseconds as `HH:MM:SS:FF`.
 *
 * Negative input clamps to zero, and a non-finite value gives `--:--:--:--` rather than `NaN:NaN`,
 * because this sits in the header where a running number must never flash nonsense.
 */
export function formatTimecode(ms: Ms, fps: number = DISPLAY_FPS): string {
  if (!Number.isFinite(ms)) return '--:--:--:--'

  const total = Math.max(0, Math.round(ms))
  const hours = Math.floor(total / 3_600_000)
  const minutes = Math.floor(total / 60_000) % 60
  const seconds = Math.floor(total / 1000) % 60
  const frames = Math.floor(((total % 1000) / 1000) * fps)

  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}:${pad(frames)}`
}

/**
 * A duration in plain words, for places where exactness matters less than reading it at a glance —
 * "1:23" rather than "00:01:23:00".
 */
export function formatDuration(ms: Ms): string {
  if (!Number.isFinite(ms)) return '--:--'

  const total = Math.max(0, Math.round(ms))
  const minutes = Math.floor(total / 60_000)
  const seconds = Math.floor(total / 1000) % 60

  return `${minutes}:${pad(seconds)}`
}
