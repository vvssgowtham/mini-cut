/** The spec for the viewport arithmetic. */

import { describe, expect, it } from 'vitest'
import {
  MAX_PX_PER_MS,
  MIN_PX_PER_MS,
  clampOffset,
  clampZoom,
  fitToContent,
  normalizeWheelDelta,
  scrollToReveal,
  zoomByCentre,
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
  const clip = (id: string, start: number, durationMs: number) => ({
    id,
    sourceId: 's1',
    sourceIn: 0,
    sourceOut: durationMs,
    start,
  })

  // Deliberately not in start order: storage keeps insertion order, drawing needs them sorted.
  const clips = [clip('c', 20000, 1000), clip('a', 0, 3000), clip('b', 3000, 2000)]

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

describe('clampOffset', () => {
  it('leaves a view over the content alone', () => {
    expect(clampOffset({ ...base, offsetMs: 2000 }, 60_000).offsetMs).toBe(2000)
  })

  it('never scrolls before the start', () => {
    expect(clampOffset({ ...base, offsetMs: -5000 }, 60_000).offsetMs).toBe(0)
  })

  it('stops short of scrolling the content entirely off screen', () => {
    // 800 px at 0.1 px/ms shows 8 s; half a screen of slack past a 20 s cut.
    expect(clampOffset({ ...base, offsetMs: 999_999 }, 20_000).offsetMs).toBe(16_000)
  })

  it('pins to the start when the whole cut fits on screen', () => {
    expect(clampOffset({ ...base, offsetMs: 5000 }, 2000).offsetMs).toBe(0)
  })
})

describe('scrollToReveal', () => {
  it('leaves a position that is already comfortably in view', () => {
    const viewport: Viewport = { ...base }
    expect(scrollToReveal(viewport, 4000)).toBe(viewport)
  })

  it('scrolls back when the position is off the left', () => {
    const scrolled = scrollToReveal({ ...base, offsetMs: 10_000 }, 9000)

    expect(timeToX(scrolled, 9000)).toBeCloseTo(80, 6)
  })

  it('scrolls forward when the position is off the right', () => {
    const scrolled = scrollToReveal(base, 20_000)

    expect(timeToX(scrolled, 20_000)).toBeCloseTo(800 - 80, 6)
  })

  it('scrolls when the position is inside the margin, not only when fully off screen', () => {
    // 100 ms sits at x = 10, inside the 80 px margin.
    const scrolled = scrollToReveal({ ...base, offsetMs: 0 }, 100)

    expect(scrolled.offsetMs).toBe(0) // already as far left as it can go
    expect(timeToX(scrolled, 100)).toBe(10)
  })

  it('never scrolls before the start to satisfy the margin', () => {
    expect(scrollToReveal(base, 0).offsetMs).toBe(0)
  })
})

describe('normalizeWheelDelta', () => {
  it('passes pixel deltas through', () => {
    expect(normalizeWheelDelta(120, 0, 800)).toBe(120)
  })

  it('converts line deltas, so a mouse wheel is not a crawl', () => {
    expect(normalizeWheelDelta(3, 1, 800)).toBe(48)
  })

  it('converts page deltas, so a page device does not leap', () => {
    expect(normalizeWheelDelta(1, 2, 800)).toBe(800)
  })

  it('keeps the direction', () => {
    expect(normalizeWheelDelta(-3, 1, 800)).toBeLessThan(0)
  })
})

describe('fitToContent', () => {
  it('shows the whole cut at once', () => {
    const fitted = fitToContent(base, 60_000)
    const { startMs, endMs } = visibleRange(fitted)

    expect(startMs).toBeLessThanOrEqual(0)
    expect(endMs).toBeGreaterThanOrEqual(60_000)
  })

  it('zooms out for a long project and in for a short one', () => {
    expect(fitToContent(base, 600_000).pxPerMs).toBeLessThan(fitToContent(base, 10_000).pxPerMs)
  })

  it('starts at time zero and leaves a margin after the last clip', () => {
    // Nothing exists before zero, so the margin belongs on the right only.
    const fitted = fitToContent(base, 60_000)

    expect(timeToX(fitted, 0)).toBe(0)
    expect(timeToX(fitted, 60_000)).toBeLessThan(fitted.widthPx)
  })

  it('respects the zoom limits rather than going arbitrarily small', () => {
    expect(fitToContent(base, 10 ** 12).pxPerMs).toBeGreaterThanOrEqual(MIN_PX_PER_MS)
  })

  it('does nothing useful but stays valid for an empty timeline', () => {
    expect(fitToContent(base, 0).offsetMs).toBe(0)
  })

  it('survives a canvas narrower than its own padding', () => {
    const narrow: Viewport = { ...base, widthPx: 10 }

    expect(() => fitToContent(narrow, 60_000)).not.toThrow()
  })
})

describe('zoomByCentre', () => {
  it('keeps the middle of the view in the middle', () => {
    const middle = xToTime(base, base.widthPx / 2)
    const zoomed = zoomByCentre(base, 2)

    expect(xToTime(zoomed, zoomed.widthPx / 2)).toBeCloseTo(middle, 6)
  })

  it('zooms in and out', () => {
    expect(zoomByCentre(base, 2).pxPerMs).toBeGreaterThan(base.pxPerMs)
    expect(zoomByCentre(base, 0.5).pxPerMs).toBeLessThan(base.pxPerMs)
  })
})
