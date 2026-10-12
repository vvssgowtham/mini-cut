/** The spec for timecode formatting. */

import { describe, expect, it } from 'vitest'
import { DISPLAY_FPS, formatDuration, formatTimecode } from './timecode'

describe('formatTimecode', () => {
  it('formats zero', () => {
    expect(formatTimecode(0)).toBe('00:00:00:00')
  })

  it('formats seconds, minutes and hours', () => {
    expect(formatTimecode(5000)).toBe('00:00:05:00')
    expect(formatTimecode(65_000)).toBe('00:01:05:00')
    expect(formatTimecode(3_725_000)).toBe('01:02:05:00')
  })

  it('derives the frame column from the remaining milliseconds', () => {
    // Half a second at 30 fps is frame 15.
    expect(formatTimecode(500)).toBe('00:00:00:15')
    expect(formatTimecode(12_466)).toBe('00:00:12:13')
  })

  it('never reports a frame at or past the rate', () => {
    for (let ms = 0; ms < 1000; ms += 7) {
      const frames = Number(formatTimecode(ms).split(':')[3])
      expect(frames).toBeLessThan(DISPLAY_FPS)
    }
  })

  it('accepts a different frame rate', () => {
    expect(formatTimecode(500, 24)).toBe('00:00:00:12')
  })

  it('pads every field to two digits, so the width never changes', () => {
    const widths = [0, 999, 61_000, 3_600_000].map((ms) => formatTimecode(ms).length)

    expect(new Set(widths).size).toBe(1)
  })

  it('clamps a negative position to zero', () => {
    expect(formatTimecode(-500)).toBe('00:00:00:00')
  })

  it('shows placeholders rather than NaN for a non-finite value', () => {
    expect(formatTimecode(Number.NaN)).toBe('--:--:--:--')
    expect(formatTimecode(Number.POSITIVE_INFINITY)).toBe('--:--:--:--')
  })
})

describe('formatDuration', () => {
  it('reads as minutes and seconds', () => {
    expect(formatDuration(0)).toBe('0:00')
    expect(formatDuration(65_000)).toBe('1:05')
    expect(formatDuration(600_000)).toBe('10:00')
  })

  it('does not roll minutes over at an hour, since a duration is not a clock', () => {
    expect(formatDuration(3_725_000)).toBe('62:05')
  })

  it('shows placeholders rather than NaN', () => {
    expect(formatDuration(Number.NaN)).toBe('--:--')
  })
})
