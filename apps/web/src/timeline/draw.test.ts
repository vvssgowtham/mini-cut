/**
 * The spec for drawTimeline.
 *
 * Driven by a recording stub rather than a real canvas, so these run in Node with no `jsdom` canvas
 * shim. What is asserted is the sequence of drawing calls: what gets drawn, where, and how often.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import type { Clip } from '../editor/types'
import { CLIP_HEIGHT_PX, CLIP_TOP_PX, defaultTheme, drawTimeline } from './draw'
import type { TimelineScene } from './draw'
import type { Viewport } from './viewport'

type Call = { method: string; args: unknown[] }

/** Records every call and fillStyle assignment, in order. */
function recordingContext() {
  const calls: Call[] = []
  const record =
    (method: string) =>
    (...args: unknown[]) => {
      calls.push({ method, args })
    }

  const ctx = {
    calls,
    fillStyle: '',
    strokeStyle: '',
    save: record('save'),
    restore: record('restore'),
    setTransform: record('setTransform'),
    fillRect: record('fillRect'),
    strokeRect: record('strokeRect'),
  }
  return ctx
}

type RecordingContext = ReturnType<typeof recordingContext>

function draw(scene: Partial<TimelineScene> = {}): RecordingContext {
  const ctx = recordingContext()
  drawTimeline(ctx as unknown as CanvasRenderingContext2D, { ...baseScene, ...scene })
  return ctx
}

const clip = (id: string, start: number, durationMs: number): Clip => ({
  id,
  sourceId: 's1',
  sourceIn: 0,
  sourceOut: durationMs,
  start,
})

const viewport: Viewport = { offsetMs: 0, pxPerMs: 0.1, widthPx: 800 }

let baseScene: TimelineScene

beforeEach(() => {
  baseScene = {
    viewport,
    clips: [clip('a', 0, 3000)],
    playheadMs: 0,
    heightPx: 80,
    devicePixelRatio: 1,
  }
})

/**
 * The clip rectangles only. Background and playhead are `fillRect` calls too, so they are told apart
 * by their y position rather than by call order.
 */
function clipRects(ctx: RecordingContext): unknown[][] {
  return ctx.calls
    .filter((c) => c.method === 'fillRect' && c.args[1] === CLIP_TOP_PX)
    .map((c) => c.args)
}

describe('frame setup', () => {
  it('saves and restores, so it leaves no state on the context', () => {
    const ctx = draw()

    expect(ctx.calls[0]?.method).toBe('save')
    expect(ctx.calls[ctx.calls.length - 1]?.method).toBe('restore')
  })

  it('clears the whole canvas before drawing', () => {
    const ctx = draw()
    const background = ctx.calls.find((c) => c.method === 'fillRect')

    expect(background?.args).toEqual([0, 0, 800, 80])
  })

  it('applies the device pixel ratio as an absolute transform', () => {
    const ctx = draw({ devicePixelRatio: 2 })
    const transform = ctx.calls.find((c) => c.method === 'setTransform')

    // setTransform rather than scale: scale would compound every frame.
    expect(transform?.args).toEqual([2, 0, 0, 2, 0, 0])
  })
})

describe('clips', () => {
  it('draws a clip at its time position and width', () => {
    const ctx = draw({ clips: [clip('a', 1000, 2000)] })

    // start 1000 ms at 0.1 px/ms -> x 100; 2000 ms long -> 200 px wide.
    expect(clipRects(ctx)[0]).toEqual([100, CLIP_TOP_PX, 200, CLIP_HEIGHT_PX])
  })

  it('offsets by the scroll position', () => {
    const ctx = draw({
      viewport: { ...viewport, offsetMs: 500 },
      clips: [clip('a', 1000, 2000)],
    })

    expect(clipRects(ctx)[0]?.[0]).toBe(50)
  })

  it('draws only the clips in view', () => {
    const ctx = draw({
      clips: [clip('a', 0, 3000), clip('far', 500_000, 1000)],
    })

    expect(clipRects(ctx)).toHaveLength(1)
  })

  it('draws clips in time order regardless of storage order', () => {
    const ctx = draw({ clips: [clip('b', 4000, 1000), clip('a', 0, 1000)] })
    const xs = clipRects(ctx).map((args) => args[0])

    expect(xs).toEqual([0, 400])
  })

  it('outlines each clip as well as filling it', () => {
    const ctx = draw({ clips: [clip('a', 0, 1000), clip('b', 2000, 1000)] })

    expect(ctx.calls.filter((c) => c.method === 'strokeRect')).toHaveLength(2)
  })

  it('draws nothing but the background for an empty project', () => {
    const ctx = draw({ clips: [] })

    expect(clipRects(ctx)).toHaveLength(0)
    expect(ctx.calls.filter((c) => c.method === 'strokeRect')).toHaveLength(0)
  })
})

describe('playhead', () => {
  it('draws a one pixel line at the playhead', () => {
    const ctx = draw({ playheadMs: 2000 })
    const line = ctx.calls.filter((c) => c.method === 'fillRect').at(-1)

    expect(line?.args).toEqual([200, 0, 1, 80])
  })

  it('is skipped when scrolled out of view', () => {
    const ctx = draw({ clips: [], playheadMs: 500_000 })

    expect(ctx.calls.filter((c) => c.method === 'fillRect')).toHaveLength(1) // background only
  })

  it('is drawn at the left edge when it sits exactly there', () => {
    const ctx = draw({ clips: [], viewport: { ...viewport, offsetMs: 1000 }, playheadMs: 1000 })
    const line = ctx.calls.filter((c) => c.method === 'fillRect').at(-1)

    expect(line?.args).toEqual([0, 0, 1, 80])
  })
})

describe('theme', () => {
  it('uses the default theme colours', () => {
    const ctx = draw()

    // Last assignment wins on the stub; the playhead is drawn last.
    expect(ctx.fillStyle).toBe(defaultTheme.playhead)
  })

  it('accepts an override', () => {
    const theme = { ...defaultTheme, playhead: '#00ff00' }
    const ctx = draw({ theme })

    expect(ctx.fillStyle).toBe('#00ff00')
  })
})
