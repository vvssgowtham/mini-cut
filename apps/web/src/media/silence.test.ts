/** The spec for silence detection. */

import { describe, expect, it } from 'vitest'
import { DEFAULT_MIN_SILENCE_MS, amplitudeToDb, findSilences, silencesWithinClip } from './silence'
import type { Waveform } from './waveform'

/** 20 peaks per second, matching PEAKS_PER_SECOND, so a bucket is 50 ms. */
function waveformOf(pattern: number[]): Waveform {
  return { peaks: Float32Array.from(pattern), durationMs: pattern.length * 50 }
}

/** `loud` for 1 s is 20 buckets; helpers keep the tests about behaviour, not arithmetic. */
const run = (value: number, seconds: number) => Array<number>(seconds * 20).fill(value)
const LOUD = 0.5
const QUIET = 0.0005 // about -66 dB, below the default threshold

describe('amplitudeToDb', () => {
  it('maps full scale to zero', () => {
    expect(amplitudeToDb(1)).toBe(0)
  })

  it('halving amplitude is about six decibels down', () => {
    expect(amplitudeToDb(0.5)).toBeCloseTo(-6.02, 1)
  })

  it('treats true zero as infinitely quiet, so it is below any threshold', () => {
    expect(amplitudeToDb(0)).toBe(Number.NEGATIVE_INFINITY)
  })
})

describe('findSilences', () => {
  it('finds nothing in continuous audio', () => {
    expect(findSilences(waveformOf(run(LOUD, 5)))).toEqual([])
  })

  it('finds a pause in the middle', () => {
    const waveform = waveformOf([...run(LOUD, 1), ...run(QUIET, 2), ...run(LOUD, 1)])

    expect(findSilences(waveform)).toEqual([{ startMs: 1000, endMs: 3000 }])
  })

  it('finds silence running to the very end', () => {
    const waveform = waveformOf([...run(LOUD, 1), ...run(QUIET, 2)])

    expect(findSilences(waveform)).toEqual([{ startMs: 1000, endMs: 3000 }])
  })

  it('finds silence at the start', () => {
    const waveform = waveformOf([...run(QUIET, 2), ...run(LOUD, 1)])

    expect(findSilences(waveform)).toEqual([{ startMs: 0, endMs: 2000 }])
  })

  it('finds several', () => {
    const waveform = waveformOf([
      ...run(LOUD, 1),
      ...run(QUIET, 1),
      ...run(LOUD, 1),
      ...run(QUIET, 1),
      ...run(LOUD, 1),
    ])

    expect(findSilences(waveform)).toHaveLength(2)
  })

  it('ignores gaps too short to be pauses', () => {
    // The spaces between words are silent; cutting them would shred speech into stutter.
    const brief = Array<number>(4).fill(QUIET) // 200 ms
    const waveform = waveformOf([...run(LOUD, 1), ...brief, ...run(LOUD, 1)])

    expect(findSilences(waveform)).toEqual([])
  })

  it('honours a shorter minimum when asked', () => {
    const brief = Array<number>(4).fill(QUIET)
    const waveform = waveformOf([...run(LOUD, 1), ...brief, ...run(LOUD, 1)])

    expect(findSilences(waveform, { minDurationMs: 100 })).toHaveLength(1)
  })

  it('treats the threshold in decibels, not raw amplitude', () => {
    // 0.01 is -40 dB: quiet by a linear eye, but above a -45 dB threshold.
    const waveform = waveformOf([...run(LOUD, 1), ...run(0.01, 2), ...run(LOUD, 1)])

    expect(findSilences(waveform)).toEqual([])
    expect(findSilences(waveform, { thresholdDb: -30 })).toHaveLength(1)
  })

  it('reports the whole source when it is silent throughout', () => {
    expect(findSilences(waveformOf(run(0, 3)))).toEqual([{ startMs: 0, endMs: 3000 }])
  })

  it('returns nothing for an empty waveform', () => {
    expect(findSilences({ peaks: new Float32Array(0), durationMs: 0 })).toEqual([])
  })

  it('returns ranges in source order', () => {
    const waveform = waveformOf([
      ...run(QUIET, 1),
      ...run(LOUD, 1),
      ...run(QUIET, 1),
      ...run(LOUD, 1),
      ...run(QUIET, 1),
    ])
    const found = findSilences(waveform)

    for (let i = 1; i < found.length; i++) {
      expect(found[i]!.startMs).toBeGreaterThanOrEqual(found[i - 1]!.endMs)
    }
  })

  it('uses a sensible default minimum', () => {
    expect(DEFAULT_MIN_SILENCE_MS).toBeGreaterThan(300)
  })
})

describe('silencesWithinClip', () => {
  /** Shows source 2000..8000, placed at 0 on the timeline. */
  const clip = { sourceIn: 2000, sourceOut: 8000, start: 0 }

  it('converts source time to timeline time', () => {
    const inside = [{ startMs: 3000, endMs: 4000 }]

    expect(silencesWithinClip(inside, clip)).toEqual([{ startMs: 1000, endMs: 2000 }])
  })

  it('drops silence the clip does not show', () => {
    // Before the in point and after the out point: not on the timeline at all.
    const outside = [
      { startMs: 0, endMs: 1000 },
      { startMs: 9000, endMs: 9500 },
    ]

    expect(silencesWithinClip(outside, clip)).toEqual([])
  })

  it('trims a range that straddles the in point', () => {
    const straddling = [{ startMs: 1000, endMs: 3000 }]

    expect(silencesWithinClip(straddling, clip)).toEqual([{ startMs: 0, endMs: 1000 }])
  })

  it('trims a range that straddles the out point', () => {
    const straddling = [{ startMs: 7000, endMs: 12_000 }]

    expect(silencesWithinClip(straddling, clip)).toEqual([{ startMs: 5000, endMs: 6000 }])
  })

  it('accounts for where the clip sits on the timeline', () => {
    const moved = { sourceIn: 2000, sourceOut: 8000, start: 10_000 }

    expect(silencesWithinClip([{ startMs: 3000, endMs: 4000 }], moved)).toEqual([
      { startMs: 11_000, endMs: 12_000 },
    ])
  })
})
