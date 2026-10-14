/**
 * Reducing audio to something a timeline can draw.
 *
 * A minute of audio is around 2.6 million samples per channel. Drawing those directly would mean
 * millions of operations for a few hundred pixels of waveform, so the audio is reduced once to a
 * fixed number of buckets and the timeline samples that instead.
 *
 * Each bucket keeps the **peak** amplitude rather than the average. An average smooths a waveform
 * into a flat ribbon that shows nothing; the peak preserves transients, which is what makes a
 * waveform legible as speech, beats or silence at a glance.
 */

import type { Ms } from '../editor/types'

/** Peaks for one source, normalised 0..1, evenly spaced across its whole duration. */
export type Waveform = {
  peaks: Float32Array
  durationMs: Ms
}

/** About 20 buckets per second: fine enough to see a syllable, coarse enough to stay small. */
export const PEAKS_PER_SECOND = 20

export function bucketCountFor(durationMs: Ms): number {
  return Math.max(1, Math.round((durationMs / 1000) * PEAKS_PER_SECOND))
}

/**
 * Reduce raw samples to `bucketCount` peaks.
 *
 * Reads the absolute value, because an audio sample swings either side of zero and the loudness is
 * the distance from it, not the sign.
 */
export function downsampleToPeaks(samples: Float32Array, bucketCount: number): Float32Array {
  if (bucketCount <= 0) return new Float32Array(0)

  const peaks = new Float32Array(bucketCount)
  if (samples.length === 0) return peaks

  const perBucket = samples.length / bucketCount
  for (let bucket = 0; bucket < bucketCount; bucket++) {
    const start = Math.floor(bucket * perBucket)
    const end = Math.min(samples.length, Math.max(start + 1, Math.floor((bucket + 1) * perBucket)))

    let peak = 0
    for (let i = start; i < end; i++) {
      const magnitude = Math.abs(samples[i] ?? 0)
      if (magnitude > peak) peak = magnitude
    }
    peaks[bucket] = peak
  }
  return peaks
}

/** Which bucket a position in the source falls in. */
export function bucketAt(waveform: Waveform, sourceMs: Ms): number {
  if (waveform.durationMs <= 0) return 0
  const ratio = sourceMs / waveform.durationMs
  const index = Math.floor(ratio * waveform.peaks.length)
  return Math.min(waveform.peaks.length - 1, Math.max(0, index))
}

/**
 * Peaks across a source window, resampled to `columns` — one per pixel column the clip occupies.
 *
 * Takes the loudest peak in each column's span rather than the nearest one. At a zoomed-out view a
 * single column can cover seconds of audio, and sampling one point would make a loud passage look
 * silent purely because the sample landed in a pause.
 */
export function peaksForWindow(
  waveform: Waveform,
  fromMs: Ms,
  toMs: Ms,
  columns: number,
): Float32Array {
  if (columns <= 0 || waveform.peaks.length === 0) return new Float32Array(0)

  const out = new Float32Array(columns)
  const span = Math.max(1, toMs - fromMs)

  for (let column = 0; column < columns; column++) {
    const startMs = fromMs + (span * column) / columns
    const endMs = fromMs + (span * (column + 1)) / columns
    const start = bucketAt(waveform, startMs)
    const end = Math.max(start, bucketAt(waveform, endMs))

    let peak = 0
    for (let i = start; i <= end; i++) {
      const value = waveform.peaks[i] ?? 0
      if (value > peak) peak = value
    }
    out[column] = peak
  }
  return out
}
