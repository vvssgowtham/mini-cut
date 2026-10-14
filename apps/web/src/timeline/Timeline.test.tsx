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
import { act, cleanup, render } from '@testing-library/react'
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

  render(strict ? <StrictMode>{ui}</StrictMode> : ui)
  return { bus, playhead }
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
