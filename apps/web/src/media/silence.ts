/**
 * Finding the quiet stretches in a source.
 *
 * This is what lets the agent act on "remove the silent parts". It works from the same peaks the
 * waveform draws, so what gets removed is exactly what you can see is quiet.
 *
 * Two judgements make it usable rather than merely correct:
 *
 * - **A threshold in decibels, not raw amplitude.** Hearing is logarithmic: 0.05 and 0.1 sound far
 *   more alike than the numbers suggest, and a linear threshold either catches room tone or misses
 *   half of it. Decibels put the knob where the ear is.
 * - **A minimum duration.** The gaps between words are silent. Cutting every one of them shreds
 *   speech into stutter, so only a pause long enough to be a pause counts.
 */

import type { Ms } from '../editor/types'
import type { Waveform } from './waveform'

/** Quieter than this counts as silence. Around -45 dB sits below room tone but above true digital zero. */
export const DEFAULT_THRESHOLD_DB = -45

/** Shorter gaps are the spaces between words, not pauses worth cutting. */
export const DEFAULT_MIN_SILENCE_MS = 700

export type SilenceOptions = {
  thresholdDb?: number
  minDurationMs?: Ms
}

/** A quiet stretch, in source time. Half-open: `startMs` included, `endMs` excluded. */
export type SilenceRange = { startMs: Ms; endMs: Ms }

/** Amplitude 0..1 to decibels. Silence is -Infinity, which compares correctly against any threshold. */
export function amplitudeToDb(amplitude: number): number {
  if (amplitude <= 0) return Number.NEGATIVE_INFINITY
  return 20 * Math.log10(amplitude)
}

/**
 * Quiet stretches in `waveform`, longest-lived first in source order.
 *
 * Returns ranges in source time, so they can be compared directly against a clip's `sourceIn` and
 * `sourceOut`.
 */
export function findSilences(waveform: Waveform, options: SilenceOptions = {}): SilenceRange[] {
  const { thresholdDb = DEFAULT_THRESHOLD_DB, minDurationMs = DEFAULT_MIN_SILENCE_MS } = options
  const { peaks, durationMs } = waveform
  if (peaks.length === 0 || durationMs <= 0) return []

  const msPerBucket = durationMs / peaks.length
  const ranges: SilenceRange[] = []
  let runStart: number | null = null

  const closeRun = (endBucket: number) => {
    if (runStart === null) return
    const startMs = Math.round(runStart * msPerBucket)
    const endMs = Math.round(endBucket * msPerBucket)
    if (endMs - startMs >= minDurationMs) ranges.push({ startMs, endMs })
    runStart = null
  }

  for (let i = 0; i < peaks.length; i++) {
    const quiet = amplitudeToDb(peaks[i] ?? 0) < thresholdDb
    if (quiet) {
      if (runStart === null) runStart = i
    } else {
      closeRun(i)
    }
  }
  closeRun(peaks.length)

  return ranges
}

/**
 * Silence ranges trimmed to what a clip actually shows.
 *
 * A clip is a window into its source, so a silence beyond that window is not on the timeline and
 * must not be offered for removal. Ranges are returned in **timeline** time, which is what an edit
 * operates in.
 */
export function silencesWithinClip(
  silences: readonly SilenceRange[],
  clip: { sourceIn: Ms; sourceOut: Ms; start: Ms },
): SilenceRange[] {
  const offset = clip.start - clip.sourceIn

  return silences
    .map((range) => ({
      startMs: Math.max(range.startMs, clip.sourceIn),
      endMs: Math.min(range.endMs, clip.sourceOut),
    }))
    .filter((range) => range.endMs > range.startMs)
    .map((range) => ({ startMs: range.startMs + offset, endMs: range.endMs + offset }))
}
