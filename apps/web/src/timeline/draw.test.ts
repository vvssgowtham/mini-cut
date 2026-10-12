/**
 * The spec for drawTimeline.
 *
 * Driven by a recording stub rather than a real canvas, so these run in Node with no jsdom canvas
 * shim. What is asserted is the drawing calls: what gets drawn, where, in what order.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import type { Clip } from '../editor/types'
import { CLIP_HEIGHT_PX, CLIP_TOP_PX, defaultTheme, drawTimeline } from './draw'
import type { TimelineScene } from './draw'
import type { Viewport } from './viewport'

type Call = { method: string; args: unknown[]; fillStyle: unknown }

function recordingContext() {
  const calls: Call[] = []
  const ctx = {
    calls,
    fillStyle: '' as unknown,
    strokeStyle: '' as unknown,
    lineWidth: 1,
    font: '',
    textBaseline: '',
    save: () => record('save'),
    restore: () => record('restore'),
    setTransform: (...a: unknown[]) => record('setTransform', a),
    fillRect: (...a: unknown[]) => record('fillRect', a),
    strokeRect: (...a: unknown[]) => record('strokeRect', a),
    fillText: (...a: unknown[]) => record('fillText', a),
    beginPath: () => record('beginPath'),
    closePath: () => record('closePath'),
    moveTo: (...a: unknown[]) => record('moveTo', a),
    lineTo: (...a: unknown[]) => record('lineTo', a),
    rect: (...a: unknown[]) => record('rect', a),
    roundRect: (...a: unknown[]) => record('roundRect', a),
    clip: () => record('clip'),
    fill: () => record('fill'),
    stroke: () => record('stroke'),
    createLinearGradient: () => ({ addColorStop: () => {} }),
  }
  function record(method: string, args: unknown[] = []) {
    calls.push({ method, args, fillStyle: ctx.fillStyle })
  }
  return ctx
}

type RecordingContext = ReturnType<typeof recordingContext>

const viewport: Viewport = { offsetMs: 0, pxPerMs: 0.1, widthPx: 800 }

const clip = (id: string, start: number, durationMs: number, sourceId = 'holiday.mp4'): Clip => ({
  id,
  sourceId,
  sourceIn: 0,
  sourceOut: durationMs,
  start,
})

let baseScene: TimelineScene

beforeEach(() => {
  baseScene = {
    viewport,
    clips: [clip('a', 0, 3000)],
    playheadMs: 0,
    heightPx: 110,
    devicePixelRatio: 1,
  }
})

function draw(scene: Partial<TimelineScene> = {}): RecordingContext {
  const ctx = recordingContext()
  drawTimeline(ctx as unknown as CanvasRenderingContext2D, { ...baseScene, ...scene })
  return ctx
}

const methods = (ctx: RecordingContext) => ctx.calls.map((c) => c.method)
const clipBoxes = (ctx: RecordingContext) =>
  ctx.calls.filter((c) => c.method === 'roundRect').map((c) => c.args)
const texts = (ctx: RecordingContext) =>
  ctx.calls.filter((c) => c.method === 'fillText').map((c) => String(c.args[0]))

describe('frame setup', () => {
  it('saves and restores, leaving no state on the context', () => {
    const ctx = draw()

    expect(methods(ctx)[0]).toBe('save')
    expect(methods(ctx).at(-1)).toBe('restore')
  })

  it('applies the device pixel ratio as an absolute transform', () => {
    // setTransform rather than scale: scale would compound every frame.
    expect(draw({ devicePixelRatio: 2 }).calls[1]?.args).toEqual([2, 0, 0, 2, 0, 0])
  })

  it('clears the whole canvas first', () => {
    const ctx = draw()
    const first = ctx.calls.find((c) => c.method === 'fillRect')

    expect(first?.args).toEqual([0, 0, 800, 110])
  })
})

describe('ruler', () => {
  it('labels ticks with timecode', () => {
    const ctx = draw()

    expect(texts(ctx).some((t) => /^\d\d:\d\d:\d\d:\d\d$/.test(t))).toBe(true)
  })

  it('anchors labels to absolute time when scrolled', () => {
    const ctx = draw({ viewport: { ...viewport, offsetMs: 12_000 }, clips: [] })

    expect(texts(ctx)).toContain('00:00:12:00')
  })

  it('shows fewer labels when zoomed out', () => {
    const zoomedIn = draw({ clips: [], viewport: { ...viewport, pxPerMs: 0.2 } })
    const zoomedOut = draw({ clips: [], viewport: { ...viewport, pxPerMs: 0.004 } })
    const spanIn = 800 / 0.2
    const spanOut = 800 / 0.004

    // Far more time is visible, but not proportionally more labels.
    expect(spanOut / spanIn).toBeGreaterThan(10)
    expect(texts(zoomedOut).length).toBeLessThanOrEqual(texts(zoomedIn).length * 2)
  })
})

describe('clips', () => {
  it('draws a clip at its time position and width', () => {
    const ctx = draw({ clips: [clip('a', 1000, 2000)] })

    expect(clipBoxes(ctx)[0]?.slice(0, 4)).toEqual([100, CLIP_TOP_PX, 200, CLIP_HEIGHT_PX])
  })

  it('offsets by the scroll position', () => {
    const ctx = draw({
      viewport: { ...viewport, offsetMs: 500 },
      clips: [clip('a', 1000, 2000)],
    })

    expect(clipBoxes(ctx)[0]?.[0]).toBe(50)
  })

  it('draws only the clips in view', () => {
    const ctx = draw({ clips: [clip('a', 0, 3000), clip('far', 500_000, 1000)] })

    expect(clipBoxes(ctx)).toHaveLength(1)
  })

  it('draws clips in time order regardless of storage order', () => {
    const ctx = draw({ clips: [clip('b', 4000, 1000), clip('a', 0, 1000)] })

    expect(clipBoxes(ctx).map((args) => args[0])).toEqual([0, 400])
  })

  it('labels a clip with its source and duration', () => {
    const ctx = draw({ clips: [clip('a', 0, 3000, 'beach.mov')] })

    expect(texts(ctx)).toContain('beach.mov')
    expect(texts(ctx)).toContain('00:00:03:00')
  })

  it('omits the label on a clip too narrow to read it', () => {
    // 200 ms at 0.1 px/ms is 20 px wide.
    const ctx = draw({ clips: [clip('a', 0, 200, 'beach.mov')] })

    expect(texts(ctx)).not.toContain('beach.mov')
  })

  it('clips the label to the clip box so it cannot spill onto a neighbour', () => {
    const ctx = draw({ clips: [clip('a', 0, 3000)] })

    expect(methods(ctx)).toContain('clip')
  })

  it('draws nothing but chrome for an empty project', () => {
    expect(clipBoxes(draw({ clips: [] }))).toHaveLength(0)
  })
})

describe('selection and hover', () => {
  it('marks the selected clip with the accent stroke', () => {
    const ctx = draw({ selectedClipId: 'a' })

    expect(ctx.strokeStyle).toBe(defaultTheme.clipSelectedStroke)
  })

  it('leaves an unselected clip with the plain stroke', () => {
    const ctx = draw({ selectedClipId: null })

    expect(ctx.strokeStyle).toBe(defaultTheme.clipStroke)
  })

  it('shows trim handles only on the hovered or selected clip', () => {
    const plain = draw().calls.filter((c) => c.method === 'fillRect').length
    const hovered = draw({ hoveredClipId: 'a' }).calls.filter((c) => c.method === 'fillRect').length

    expect(hovered).toBe(plain + 2)
  })
})

describe('playhead', () => {
  it('draws a line and a head at the playhead', () => {
    const ctx = draw({ playheadMs: 2000, clips: [] })
    const line = ctx.calls.filter((c) => c.method === 'fillRect').at(-1)

    expect(line?.args).toEqual([200, 0, 1, 110])
    expect(methods(ctx)).toContain('closePath')
  })

  it('draws over the clips rather than behind them', () => {
    const ctx = draw({ playheadMs: 500 })
    const lastClip = methods(ctx).lastIndexOf('roundRect')
    const head = methods(ctx).lastIndexOf('closePath')

    expect(head).toBeGreaterThan(lastClip)
  })

  it('is skipped when scrolled out of view', () => {
    const ctx = draw({ clips: [], playheadMs: 500_000 })

    expect(methods(ctx)).not.toContain('closePath')
  })
})
