/** The spec for the time conversions. */

import { describe, expect, it } from 'vitest'
import { msToSeconds, secondsToMs } from './time'

describe('secondsToMs', () => {
  it('converts whole and fractional seconds', () => {
    expect(secondsToMs(0)).toBe(0)
    expect(secondsToMs(1.5)).toBe(1500)
    expect(secondsToMs(12.3456)).toBe(12346)
  })

  it('rounds to the nearest millisecond', () => {
    expect(secondsToMs(0.0004)).toBe(0)
    expect(secondsToMs(0.0006)).toBe(1)
  })

  it('returns integers', () => {
    expect(Number.isInteger(secondsToMs(3.14159))).toBe(true)
  })

  it('rejects values that are not finite or are negative', () => {
    expect(() => secondsToMs(Number.NaN)).toThrow()
    expect(() => secondsToMs(Number.POSITIVE_INFINITY)).toThrow()
    expect(() => secondsToMs(-1)).toThrow()
  })
})

describe('msToSeconds', () => {
  it('converts milliseconds to seconds', () => {
    expect(msToSeconds(0)).toBe(0)
    expect(msToSeconds(1500)).toBe(1.5)
  })

  it('round-trips with secondsToMs for millisecond-precision values', () => {
    expect(secondsToMs(msToSeconds(2345))).toBe(2345)
  })

  /**
   * Rounds rather than throws: this runs in the playback and render path, and `Ms` is not branded, so
   * a fractional value from a drag must not crash a seek.
   */
  it('rounds a fractional millisecond instead of throwing', () => {
    expect(msToSeconds(1500.4)).toBe(1.5)
    expect(msToSeconds(0.6)).toBe(0.001)
  })

  it('rejects negative or non-finite milliseconds', () => {
    expect(() => msToSeconds(-1)).toThrow()
    expect(() => msToSeconds(Number.NaN)).toThrow()
    expect(() => msToSeconds(Number.POSITIVE_INFINITY)).toThrow()
  })
})
