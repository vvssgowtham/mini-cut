/** The spec for waveform reduction. */

import { describe, expect, it } from 'vitest'
import { bucketAt, bucketCountFor, downsampleToPeaks, peaksForWindow } from './waveform'

describe('downsampleToPeaks', () => {
  it('reduces samples to the requested number of buckets', () => {
    expect(downsampleToPeaks(Float32Array.from(Array(1000).fill(0.5)), 10)).toHaveLength(10)
  })

  it('keeps the loudest sample in each bucket, not the average', () => {
    // An average would smooth this to a flat ribbon showing nothing.
    const samples = Float32Array.from([0, 0, 0, 1, 0, 0, 0, 0])

    expect(Array.from(downsampleToPeaks(samples, 2))).toEqual([1, 0])
  })

  it('reads magnitude, since a sample swings either side of zero', () => {
    // toBeCloseTo, not toEqual: 0.8 has no exact Float32 representation.
    expect(downsampleToPeaks(Float32Array.from([-0.8, 0.2]), 1)[0]).toBeCloseTo(0.8, 5)
  })

  it('handles more buckets than samples without dropping any', () => {
    const peaks = downsampleToPeaks(Float32Array.from([0.4, 0.9]), 4)

    expect(peaks).toHaveLength(4)
    expect(Math.max(...peaks)).toBeCloseTo(0.9, 5)
  })

  it('returns silence for no samples', () => {
    expect(Array.from(downsampleToPeaks(new Float32Array(0), 3))).toEqual([0, 0, 0])
  })

  it('returns nothing for no buckets', () => {
    expect(downsampleToPeaks(Float32Array.from([1]), 0)).toHaveLength(0)
  })
})

describe('bucketCountFor', () => {
  it('scales with duration', () => {
    expect(bucketCountFor(1000)).toBe(20)
    expect(bucketCountFor(10_000)).toBe(200)
  })

  it('never returns zero, so a very short clip still has one peak', () => {
    expect(bucketCountFor(1)).toBe(1)
    expect(bucketCountFor(0)).toBe(1)
  })
})

describe('bucketAt', () => {
  const waveform = { peaks: new Float32Array(10), durationMs: 1000 }

  it('maps a position to its bucket', () => {
    expect(bucketAt(waveform, 0)).toBe(0)
    expect(bucketAt(waveform, 550)).toBe(5)
  })

  it('clamps rather than running off either end', () => {
    expect(bucketAt(waveform, -100)).toBe(0)
    expect(bucketAt(waveform, 99_999)).toBe(9)
  })
})

describe('peaksForWindow', () => {
  const waveform = {
    peaks: Float32Array.from([0, 0.2, 0.4, 0.6, 0.8, 1, 0.8, 0.6, 0.4, 0.2]),
    durationMs: 1000,
  }

  it('returns one value per column', () => {
    expect(peaksForWindow(waveform, 0, 1000, 5)).toHaveLength(5)
  })

  it('takes the loudest peak a column spans, not a single sample of it', () => {
    // Zoomed right out, one column covers everything; sampling one point could report silence.
    expect(Array.from(peaksForWindow(waveform, 0, 1000, 1))).toEqual([1])
  })

  it('reads only the requested window', () => {
    // The first fifth is the quietest part of this waveform.
    const quiet = peaksForWindow(waveform, 0, 200, 1)[0] ?? 1

    expect(quiet).toBeLessThan(0.5)
  })

  it('returns nothing for no columns or an empty waveform', () => {
    expect(peaksForWindow(waveform, 0, 1000, 0)).toHaveLength(0)
    expect(peaksForWindow({ peaks: new Float32Array(0), durationMs: 0 }, 0, 1, 4)).toHaveLength(0)
  })
})
