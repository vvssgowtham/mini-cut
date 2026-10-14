/**
 * Regression tests for the draw loop.
 *
 * These exist because of a bug that shipped past every other test: the unmount cleanup cancelled the
 * pending animation frame but left its id on the ref, so `scheduleDraw`'s "already scheduled" guard
 * early-returned forever afterwards. StrictMode mounts, unmounts and remounts in development, so the
 * timeline simply never drew — while the unit tests stayed green, because jsdom's `getContext`
 * returns null and the draw path was never entered at all.
 *
 * So: stub `getContext` and the frame loop, and assert that drawing actually happens — including
 * after a remount.
 */

import { StrictMode } from 'react'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CommandBus } from '../editor/history'
import { drawTimeline } from './draw'
import type { Project } from '../editor/types'
import { PlayheadStore } from '../media/playhead'
import { Timeline } from './Timeline'

// Spied on so the tests can read the scene the component asked for, which is the only way to see
// where the view is pointing.
vi.mock('./draw', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./draw')>()
  return { ...actual, drawTimeline: vi.fn(actual.drawTimeline) }
})

const project: Project = {
  version: 1,
  durationMs: 10_000,
  tracks: [
    {
      id: 't1',
      clips: [{ id: 'a', sourceId: 'clip.mp4', sourceIn: 0, sourceOut: 3000, start: 0 }],
    },
  ],
}

/**
 * Keyed by id, and cancel really removes the entry. That fidelity is the whole point: with a no-op
 * cancel, the frame queued before the StrictMode unmount still runs and hides the very bug these
 * tests exist to catch.
 */
let frames: Map<number, FrameRequestCallback>
let nextFrameId: number
let fillRectCalls: number

/** Runs the frames queued so far, the way the browser would on its next tick. */
function flushFrames() {
  const pending = [...frames.values()]
  frames.clear()
  for (const frame of pending) frame(0)
}

beforeEach(() => {
  // jsdom never lays anything out, so a canvas reports zero width and every width-dependent
  // behaviour — fitting, culling, hit-testing — correctly declines to do anything.
  Object.defineProperty(HTMLCanvasElement.prototype, 'clientWidth', {
    configurable: true,
    get: () => 800,
  })

  // jsdom implements no pointer capture at all. Needed by every test that presses on a clip, which
  // is every test of them now that the canvas has a width and hit-testing actually resolves.
  Object.assign(HTMLElement.prototype, {
    setPointerCapture: () => {},
    releasePointerCapture: () => {},
    hasPointerCapture: () => false,
  })

  frames = new Map()
  nextFrameId = 1
  fillRectCalls = 0

  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    const id = nextFrameId++
    frames.set(id, cb)
    return id
  })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => {
    frames.delete(id)
  })

  // jsdom has no 2D context, so the draw path would otherwise never run.
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    save: () => {},
    restore: () => {},
    setTransform: () => {},
    fillRect: () => {
      fillRectCalls += 1
    },
    strokeRect: () => {},
    fillText: () => {},
    beginPath: () => {},
    closePath: () => {},
    moveTo: () => {},
    lineTo: () => {},
    rect: () => {},
    roundRect: () => {},
    clip: () => {},
    fill: () => {},
    stroke: () => {},
    createLinearGradient: () => ({ addColorStop: () => {} }),
  } as unknown as CanvasRenderingContext2D)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function renderTimeline(strict: boolean) {
  const bus = new CommandBus(project)
  const playhead = new PlayheadStore()
  const ui = <Timeline bus={bus} playhead={playhead} selectedClipId={null} onSelect={() => {}} />

  const { unmount } = render(strict ? <StrictMode>{ui}</StrictMode> : ui)
  return { bus, playhead, unmount }
}

describe('draw loop', () => {
  it('draws on mount', () => {
    renderTimeline(false)
    flushFrames()

    expect(fillRectCalls).toBeGreaterThan(0)
  })

  it('still draws after StrictMode remounts it', () => {
    renderTimeline(true)
    flushFrames()

    expect(fillRectCalls).toBeGreaterThan(0)
  })

  it('keeps drawing on later changes after a StrictMode remount', () => {
    const { bus } = renderTimeline(true)
    flushFrames()
    fillRectCalls = 0

    // act() so React flushes the subscription re-render before the frame is run.
    act(() => bus.execute({ type: 'move', trackId: 't1', clipId: 'a', start: 500 }))
    flushFrames()

    expect(fillRectCalls).toBeGreaterThan(0)
  })

  it('redraws when the playhead moves', () => {
    const { playhead } = renderTimeline(false)
    flushFrames()
    fillRectCalls = 0

    playhead.set(1200)
    flushFrames()

    expect(fillRectCalls).toBeGreaterThan(0)
  })

  it('coalesces several changes in one tick into a single frame', () => {
    const { bus } = renderTimeline(false)
    flushFrames()

    act(() => {
      bus.execute({ type: 'move', trackId: 't1', clipId: 'a', start: 100 })
      bus.execute({ type: 'move', trackId: 't1', clipId: 'a', start: 200 })
      bus.execute({ type: 'move', trackId: 't1', clipId: 'a', start: 300 })
    })

    expect(frames.size).toBe(1)
  })
})

describe('following the playhead', () => {
  /** The viewport handed to the most recent draw. */
  function lastViewport() {
    const calls = vi.mocked(drawTimeline).mock.calls
    return calls[calls.length - 1]?.[1].viewport
  }

  it('scrolls to keep the playhead in view when it moves off screen', () => {
    const { playhead } = renderTimeline(false)
    flushFrames()
    const before = lastViewport()?.offsetMs ?? 0

    // Far beyond the visible span at the default zoom.
    act(() => playhead.set(600_000))
    flushFrames()

    const after = lastViewport()?.offsetMs ?? 0
    expect(after).toBeGreaterThan(before)
  })

  it('leaves the view alone while the playhead stays in view', () => {
    const { playhead } = renderTimeline(false)
    flushFrames()
    const before = lastViewport()?.offsetMs

    act(() => playhead.set(500))
    flushFrames()

    expect(lastViewport()?.offsetMs).toBe(before)
  })
})

describe('keyboard shortcuts without focusing the canvas', () => {
  /**
   * These were bound to the canvas, so they did nothing until it was clicked — and stopped working
   * again the moment focus moved to a button. Nothing on screen said so.
   */
  it('scrubs with the arrow keys while focus is on the body', () => {
    const { playhead } = renderTimeline(false)
    flushFrames()

    act(() => {
      fireEvent.keyDown(document.body, { key: 'ArrowRight' })
    })

    expect(playhead.ms).toBeGreaterThan(0)
  })

  it('still works when focus is on a button elsewhere on the page', () => {
    const button = document.createElement('button')
    document.body.appendChild(button)
    const { playhead } = renderTimeline(false)
    flushFrames()
    button.focus()

    act(() => {
      fireEvent.keyDown(button, { key: 'ArrowRight' })
    })

    expect(playhead.ms).toBeGreaterThan(0)
    button.remove()
  })

  it('jumps to the end with the End key', () => {
    const { playhead } = renderTimeline(false)
    flushFrames()

    act(() => {
      fireEvent.keyDown(document.body, { key: 'End' })
    })

    // The fixture's only clip runs 0..3000.
    expect(playhead.ms).toBe(3000)
  })

  it('leaves keys alone while someone is typing in a field', () => {
    const input = document.createElement('input')
    document.body.appendChild(input)
    const { playhead } = renderTimeline(false)
    flushFrames()

    act(() => {
      fireEvent.keyDown(input, { key: 'ArrowRight' })
    })

    expect(playhead.ms).toBe(0)
    input.remove()
  })

  it('stops listening once unmounted', () => {
    const { playhead, unmount } = renderTimeline(false)
    flushFrames()
    unmount()

    fireEvent.keyDown(document.body, { key: 'ArrowRight' })

    expect(playhead.ms).toBe(0)
  })
})

describe('wheel', () => {
  /** Dispatched natively, because React's synthetic wheel events are passive. */
  function wheel(target: Element, init: WheelEventInit) {
    const event = new WheelEvent('wheel', { bubbles: true, cancelable: true, ...init })
    target.dispatchEvent(event)
    return event
  }

  function canvas() {
    const element = document.querySelector('canvas')
    if (!element) throw new Error('no canvas rendered')
    return element
  }

  it('stops the page scrolling while the timeline pans', () => {
    // Without this the page moves at the same time, which reads as the editor shaking.
    renderTimeline(false)
    flushFrames()

    expect(wheel(canvas(), { deltaY: 120 }).defaultPrevented).toBe(true)
  })

  it('stops the browser zooming when ctrl is held', () => {
    renderTimeline(false)
    flushFrames()

    expect(wheel(canvas(), { deltaY: -120, ctrlKey: true }).defaultPrevented).toBe(true)
  })

  it('pans the view', () => {
    const calls = () => vi.mocked(drawTimeline).mock.calls
    renderTimeline(false)
    flushFrames()
    const before = calls()[calls().length - 1]?.[1].viewport.offsetMs ?? 0

    wheel(canvas(), { deltaY: 300 })
    flushFrames()

    expect(calls()[calls().length - 1]?.[1].viewport.offsetMs).toBeGreaterThan(before)
  })

  it('zooms rather than pans when ctrl is held', () => {
    const calls = () => vi.mocked(drawTimeline).mock.calls
    renderTimeline(false)
    flushFrames()
    const before = calls()[calls().length - 1]?.[1].viewport.pxPerMs ?? 0

    wheel(canvas(), { deltaY: -200, ctrlKey: true })
    flushFrames()

    expect(calls()[calls().length - 1]?.[1].viewport.pxPerMs).toBeGreaterThan(before)
  })

  it('stops listening once unmounted', () => {
    const { unmount } = renderTimeline(false)
    flushFrames()
    unmount()

    expect(wheel(document.body, { deltaY: 120 }).defaultPrevented).toBe(false)
  })
})

describe('dragging', () => {
  function canvasElement() {
    const element = document.querySelector('canvas')
    if (!element) throw new Error('no canvas rendered')
    return element
  }

  /** Counts layout reads, which is the cost that made dragging heavy. */
  function countRectReads(element: Element) {
    let reads = 0
    const real = element.getBoundingClientRect.bind(element)
    vi.spyOn(element, 'getBoundingClientRect').mockImplementation(() => {
      reads += 1
      return real()
    })
    return () => reads
  }

  function pointer(element: Element, type: string, init: PointerEventInit = {}) {
    // jsdom has no PointerEvent, and MouseEvent carries everything these handlers read.
    const event = new MouseEvent(type, { bubbles: true, cancelable: true, ...init })
    Object.defineProperty(event, 'pointerId', { value: 1 })
    element.dispatchEvent(event)
    return event
  }

  it('reads layout once for a whole drag, not once per move', () => {
    renderTimeline(false)
    flushFrames()
    const canvas = canvasElement()
    const reads = countRectReads(canvas)

    pointer(canvas, 'pointerdown', { clientX: 10, clientY: 50 })
    for (let x = 11; x < 60; x++) pointer(canvas, 'pointermove', { clientX: x, clientY: 50 })
    pointer(canvas, 'pointerup', { clientX: 60, clientY: 50 })

    // Fifty moves; measuring the element on each is what forced layout at pointer frequency.
    expect(reads()).toBeLessThanOrEqual(2)
  })

  it('stops the browser selecting page text when a drag starts', () => {
    renderTimeline(false)
    flushFrames()
    const canvas = canvasElement()

    expect(pointer(canvas, 'pointerdown', { clientX: 10, clientY: 50 }).defaultPrevented).toBe(true)
  })
})

describe('framing the cut', () => {
  function lastScene() {
    const calls = vi.mocked(drawTimeline).mock.calls
    return calls[calls.length - 1]?.[1]
  }

  /** Longer than the default zoom can show, which is the case that was broken. */
  const longProject: Project = {
    version: 1,
    durationMs: 90_000,
    tracks: [
      {
        id: 't1',
        clips: [
          { id: 'a', sourceId: 'one.mp4', sourceIn: 0, sourceOut: 40_000, start: 0 },
          { id: 'b', sourceId: 'one.mp4', sourceIn: 0, sourceOut: 38_000, start: 40_000 },
        ],
      },
    ],
  }

  it('fits a cut longer than the default zoom can show', () => {
    // At 800px and 0.1 px/ms the default view is eight seconds. A 78 second cut opened with most
    // of itself off screen and nothing on screen to say so.
    const bus = new CommandBus(longProject)
    render(
      <Timeline
        bus={bus}
        playhead={new PlayheadStore()}
        selectedClipId={null}
        onSelect={() => {}}
      />,
    )
    flushFrames()

    const scene = lastScene()
    const visibleMs = (scene?.viewport.widthPx ?? 0) / (scene?.viewport.pxPerMs ?? 1)

    expect(scene?.viewport.offsetMs).toBe(0)
    expect(visibleMs).toBeGreaterThanOrEqual(78_000)
  })

  it('hands the parent controls for fit and zoom', () => {
    let controls: { fit: () => void; zoomIn: () => void; zoomOut: () => void } | null = null
    const bus = new CommandBus(project)
    const playhead = new PlayheadStore()
    render(
      <Timeline
        bus={bus}
        playhead={playhead}
        selectedClipId={null}
        onSelect={() => {}}
        onViewControls={(received) => {
          controls = received
        }}
      />,
    )
    flushFrames()

    expect(controls).not.toBeNull()

    const before = lastScene()?.viewport.pxPerMs ?? 0
    act(() => controls!.zoomIn())
    flushFrames()

    expect(lastScene()?.viewport.pxPerMs).toBeGreaterThan(before)
  })

  it('does not refit after an edit, which would move the view mid-cut', () => {
    const { bus } = renderTimeline(false)
    flushFrames()
    act(() => {
      bus.execute({ type: 'move', trackId: 't1', clipId: 'a', start: 60_000 })
    })
    flushFrames()

    // Still framed for the original cut rather than silently rezoomed around the moved clip.
    expect(lastScene()?.viewport.pxPerMs).toBe(lastScene()?.viewport.pxPerMs)
    expect(lastScene()?.viewport.offsetMs).toBe(0)
  })
})
