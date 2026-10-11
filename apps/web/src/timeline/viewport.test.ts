/** The spec for the viewport arithmetic. */

import { describe, expect, it } from 'vitest'
import {
  MAX_PX_PER_MS,
  MIN_PX_PER_MS,
  clampZoom,
  panBy,
  timeToX,
  visibleClips,
  visibleRange,
  xToTime,
  zoomAt,
  type Viewport,
} from './viewport'

/** 800 px showing 8 seconds, starting at 0. */
const base: Viewport = { offsetMs: 0, pxPerMs: 0.1, widthPx: 800 }

describe('timeToX and xToTime', () => {
  it('maps time to pixels relative to the left edge', () => {
    expect(timeToX(base, 0)).toBe(0)
    expect(timeToX(base, 1000)).toBe(100)
  })

  it('accounts for the scroll offset', () => {
    const scrolled: Viewport = { ...base, offsetMs: 2000 }

    expect(timeToX(scrolled, 2000)).toBe(0)
    expect(timeToX(scrolled, 3000)).toBe(100)
  })

  it('returns a negative x for time scrolled off the left', () => {
    expect(timeToX({ ...base, offsetMs: 2000 }, 1000)).toBe(-100)
  })

  it('round-trips through xToTime', () => {
    const scrolled: Viewport = { ...base, offsetMs: 1234, pxPerMs: 0.37 }

    expect(xToTime(scrolled, timeToX(scrolled, 5678))).toBeCloseTo(5678, 6)
    expect(timeToX(scrolled, xToTime(scrolled, 250))).toBeCloseTo(250, 6)
  })
})

describe('visibleRange', () => {
  it('spans the canvas width at the current zoom', () => {
    expect(visibleRange(base)).toEqual({ startMs: 0, endMs: 8000 })
  })

  it('moves with the offset', () => {
    expect(visibleRange({ ...base, offsetMs: 5000 })).toEqual({ startMs: 5000, endMs: 13000 })
  })

  it('shows a shorter span when zoomed in', () => {
    expect(visibleRange({ ...base, pxPerMs: 0.4 })).toEqual({ startMs: 0, endMs: 2000 })
  })
})

describe('clampZoom', () => {
  it('leaves a value inside the range alone', () => {
    expect(clampZoom(0.1)).toBe(0.1)
  })

  it('clamps past either limit', () => {
    expect(clampZoom(10)).toBe(MAX_PX_PER_MS)
    expect(clampZoom(0.000001)).toBe(MIN_PX_PER_MS)
  })
})

describe('zoomAt', () => {
  it('keeps the time under the anchor pixel fixed', () => {
    const anchorX = 300
    const before = xToTime(base, anchorX)
    const after = zoomAt(base, anchorX, 2)

    expect(xToTime(after, anchorX)).toBeCloseTo(before, 6)
  })

  it('keeps it fixed when zooming out too', () => {
    const anchorX = 650
    const scrolled: Viewport = { ...base, offsetMs: 4000 }
    const before = xToTime(scrolled, anchorX)
    const after = zoomAt(scrolled, anchorX, 0.5)

    expect(xToTime(after, anchorX)).toBeCloseTo(before, 6)
  })

  it('zooms in by the factor', () => {
    expect(zoomAt(base, 0, 2).pxPerMs).toBeCloseTo(0.2, 9)
  })

  it('respects the zoom limits', () => {
    expect(zoomAt(base, 100, 1e6).pxPerMs).toBe(MAX_PX_PER_MS)
    expect(zoomAt(base, 100, 1e-9).pxPerMs).toBe(MIN_PX_PER_MS)
  })

  it('does not mutate the viewport it is given', () => {
    const viewport: Viewport = { ...base }
    zoomAt(viewport, 100, 2)

    expect(viewport).toEqual(base)
  })
})

describe('panBy', () => {
  it('scrolls forward by the pixel delta', () => {
    expect(panBy(base, 100).offsetMs).toBe(1000)
  })

  it('scrolls backward', () => {
    expect(panBy({ ...base, offsetMs: 5000 }, -100).offsetMs).toBe(4000)
  })

  it('stops at the start of the timeline', () => {
    expect(panBy(base, -500).offsetMs).toBe(0)
    expect(panBy({ ...base, offsetMs: 100 }, -5000).offsetMs).toBe(0)
  })
})

describe('visibleClips', () => {
  const clips = [
    { id: 'c', start: 20000, durationMs: 1000 }, // far off to the right
    { id: 'a', start: 0, durationMs: 3000 },
    { id: 'b', start: 3000, durationMs: 2000 },
  ]

  it('drops clips outside the visible range', () => {
    expect(visibleClips(base, clips).map((c) => c.id)).toEqual(['a', 'b'])
  })

  it('returns them sorted by start, not in storage order', () => {
    const wide: Viewport = { ...base, pxPerMs: 0.01 } // 80 s visible
    expect(visibleClips(wide, clips).map((c) => c.id)).toEqual(['a', 'b', 'c'])
  })

  it('keeps a clip that only partly overlaps either edge', () => {
    const window: Viewport = { offsetMs: 2500, pxPerMs: 0.1, widthPx: 100 } // 2500..3500 ms

    expect(visibleClips(window, clips).map((c) => c.id)).toEqual(['a', 'b'])
  })

  it('excludes a clip that merely touches the edges', () => {
    const window: Viewport = { offsetMs: 3000, pxPerMs: 0.1, widthPx: 100 } // 3000..4000 ms

    // 'a' ends exactly at 3000 and the range is half-open, so it is out; 'b' starts at 3000, so it is in.
    expect(visibleClips(window, clips).map((c) => c.id)).toEqual(['b'])
  })

  it('does not reorder the array it is given', () => {
    const input = [...clips]
    visibleClips({ ...base, pxPerMs: 0.01 }, input)

    expect(input.map((c) => c.id)).toEqual(['c', 'a', 'b'])
  })
})
