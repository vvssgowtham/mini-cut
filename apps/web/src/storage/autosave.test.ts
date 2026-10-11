/**
 * The spec for autosave.
 *
 * Fake timers plus an injected `save`, so this runs in Node with no database and no real waiting.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CommandBus } from '../editor/history'
import type { Project } from '../editor/types'
import { startAutosave } from './autosave'

const project: Project = {
  version: 1,
  durationMs: 5000,
  tracks: [
    {
      id: 't1',
      clips: [
        { id: 'a', sourceId: 's1', sourceIn: 0, sourceOut: 3000, start: 0 },
        { id: 'b', sourceId: 's1', sourceIn: 0, sourceOut: 1000, start: 3000 },
      ],
    },
  ],
}

const move = (start: number) =>
  ({ type: 'move', trackId: 't1', clipId: 'a', start }) satisfies Parameters<
    CommandBus['execute']
  >[0]

let bus: CommandBus

beforeEach(() => {
  vi.useFakeTimers()
  bus = new CommandBus(project)
})

afterEach(() => {
  vi.useRealTimers()
})

/** A save that resolves immediately, recording what it was given. */
function recordingSave() {
  const saved: Project[] = []
  const save = vi.fn(async (p: Project) => {
    saved.push(p)
  })
  return { save, saved }
}

/** A save that only resolves when the test says so. */
function controllableSave() {
  const resolvers: (() => void)[] = []
  const save = vi.fn(() => new Promise<void>((resolve) => resolvers.push(resolve)))
  return { save, resolveNext: () => resolvers.shift()?.() }
}

describe('debouncing', () => {
  it('does not save until the quiet period has passed', () => {
    const { save } = recordingSave()
    startAutosave(bus, save, { debounceMs: 500 })

    bus.execute(move(100))
    vi.advanceTimersByTime(499)

    expect(save).not.toHaveBeenCalled()
  })

  it('saves once the quiet period passes', async () => {
    const { save } = recordingSave()
    startAutosave(bus, save, { debounceMs: 500 })

    bus.execute(move(100))
    await vi.advanceTimersByTimeAsync(500)

    expect(save).toHaveBeenCalledTimes(1)
  })

  it('coalesces a burst of changes into one save', async () => {
    const { save, saved } = recordingSave()
    startAutosave(bus, save, { debounceMs: 500 })

    for (const start of [100, 200, 300, 400]) {
      bus.execute(move(start))
      await vi.advanceTimersByTimeAsync(100)
    }
    await vi.advanceTimersByTimeAsync(500)

    expect(save).toHaveBeenCalledTimes(1)
    // And it saves the final state, not the first.
    expect(saved[0]?.tracks[0]?.clips[0]?.start).toBe(400)
  })

  it('does not save when nothing changed', async () => {
    const { save } = recordingSave()
    startAutosave(bus, save, { debounceMs: 500 })

    await vi.advanceTimersByTimeAsync(5000)

    expect(save).not.toHaveBeenCalled()
  })

  it('saves again after a later change', async () => {
    const { save } = recordingSave()
    startAutosave(bus, save, { debounceMs: 500 })

    bus.execute(move(100))
    await vi.advanceTimersByTimeAsync(500)
    bus.execute(move(200))
    await vi.advanceTimersByTimeAsync(500)

    expect(save).toHaveBeenCalledTimes(2)
  })

  it('saves after an undo too', async () => {
    const { save } = recordingSave()
    startAutosave(bus, save, { debounceMs: 500 })

    bus.execute(move(100))
    await vi.advanceTimersByTimeAsync(500)
    bus.undo()
    await vi.advanceTimersByTimeAsync(500)

    expect(save).toHaveBeenCalledTimes(2)
  })
})

describe('overlapping writes', () => {
  it('does not start a second save while one is in flight', async () => {
    const { save, resolveNext } = controllableSave()
    startAutosave(bus, save, { debounceMs: 500 })

    bus.execute(move(100))
    await vi.advanceTimersByTimeAsync(500)
    expect(save).toHaveBeenCalledTimes(1)

    bus.execute(move(200))
    await vi.advanceTimersByTimeAsync(500)

    // Still only the first: the second is owed, not running.
    expect(save).toHaveBeenCalledTimes(1)

    resolveNext()
    await vi.advanceTimersByTimeAsync(0)

    expect(save).toHaveBeenCalledTimes(2)
  })

  it('runs exactly one more save for several changes during a write', async () => {
    const { save, resolveNext } = controllableSave()
    startAutosave(bus, save, { debounceMs: 500 })

    bus.execute(move(100))
    await vi.advanceTimersByTimeAsync(500)

    bus.execute(move(200))
    bus.execute(move(300))
    bus.execute(move(400))
    await vi.advanceTimersByTimeAsync(500)

    resolveNext()
    await vi.advanceTimersByTimeAsync(0)
    resolveNext()
    await vi.advanceTimersByTimeAsync(0)

    expect(save).toHaveBeenCalledTimes(2)
  })
})

describe('errors', () => {
  it('reports a failed save without stopping', async () => {
    const onError = vi.fn()
    const save = vi
      .fn<(p: Project) => Promise<void>>()
      .mockRejectedValueOnce(new Error('quota exceeded'))
      .mockResolvedValue(undefined)

    startAutosave(bus, save, { debounceMs: 500, onError })

    bus.execute(move(100))
    await vi.advanceTimersByTimeAsync(500)

    expect(onError).toHaveBeenCalledTimes(1)

    bus.execute(move(200))
    await vi.advanceTimersByTimeAsync(500)

    expect(save).toHaveBeenCalledTimes(2)
  })
})

describe('flush and stop', () => {
  it('flush writes a pending change immediately', async () => {
    const { save } = recordingSave()
    const autosave = startAutosave(bus, save, { debounceMs: 5000 })

    bus.execute(move(100))
    await autosave.flush()

    expect(save).toHaveBeenCalledTimes(1)
  })

  it('flush does nothing when there is nothing pending', async () => {
    const { save } = recordingSave()
    const autosave = startAutosave(bus, save, { debounceMs: 500 })

    await autosave.flush()

    expect(save).not.toHaveBeenCalled()
  })

  it('stop cancels a pending save and stops listening', async () => {
    const { save } = recordingSave()
    const autosave = startAutosave(bus, save, { debounceMs: 500 })

    bus.execute(move(100))
    autosave.stop()
    await vi.advanceTimersByTimeAsync(5000)

    bus.execute(move(200))
    await vi.advanceTimersByTimeAsync(5000)

    expect(save).not.toHaveBeenCalled()
  })

  it('reports whether a save is pending', async () => {
    const { save } = recordingSave()
    const autosave = startAutosave(bus, save, { debounceMs: 500 })

    expect(autosave.isPending()).toBe(false)

    bus.execute(move(100))
    expect(autosave.isPending()).toBe(true)

    await vi.advanceTimersByTimeAsync(500)
    expect(autosave.isPending()).toBe(false)
  })
})
