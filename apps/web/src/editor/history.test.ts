/** The spec for CommandBus. */

import { describe, expect, it, vi } from 'vitest'
import type { Command, DeleteOp, MoveOp, TrimOp } from './commands'
import { CommandBus } from './history'
import type { Project } from './types'
import { clipIds, getClip, makeProject } from './fixtures'

const trimA: TrimOp = { type: 'trim', trackId: 't1', clipId: 'a', sourceIn: 1500, sourceOut: 3000 }
const moveB: MoveOp = { type: 'move', trackId: 't1', clipId: 'b', start: 5000 }
const deleteA: DeleteOp = { type: 'delete', trackId: 't1', clipId: 'a' }

describe('execute', () => {
  it('applies the command and exposes the new project', () => {
    const bus = new CommandBus(makeProject())
    bus.execute(trimA)

    expect(getClip(bus.project, 't1', 'a').sourceIn).toBe(1500)
  })

  it('leaves the project it was constructed with untouched', () => {
    const start = makeProject()
    const bus = new CommandBus(start)
    bus.execute(trimA)

    expect(start).toEqual(makeProject())
    expect(bus.project).not.toBe(start)
  })
})

describe('undo and redo', () => {
  it('undo restores the previous project exactly', () => {
    const start = makeProject()
    const bus = new CommandBus(start)

    bus.execute(trimA)
    bus.undo()

    expect(bus.project).toEqual(start)
  })

  it('redo reapplies what undo took back', () => {
    const bus = new CommandBus(makeProject())

    bus.execute(trimA)
    const afterTrim = bus.project
    bus.undo()
    bus.redo()

    expect(bus.project).toEqual(afterTrim)
  })

  it('undoes several edits in reverse order', () => {
    const start = makeProject()
    const bus = new CommandBus(start)

    bus.execute(trimA)
    bus.execute(moveB)
    bus.execute(deleteA)

    bus.undo()
    expect(clipIds(bus.project, 't1')).toEqual(['a', 'b'])

    bus.undo()
    expect(getClip(bus.project, 't1', 'b').start).toBe(2000)

    bus.undo()
    expect(bus.project).toEqual(start)
  })

  it('tracks whether undo and redo are available', () => {
    const bus = new CommandBus(makeProject())
    expect(bus.canUndo).toBe(false)
    expect(bus.canRedo).toBe(false)

    bus.execute(trimA)
    expect(bus.canUndo).toBe(true)
    expect(bus.canRedo).toBe(false)

    bus.undo()
    expect(bus.canUndo).toBe(false)
    expect(bus.canRedo).toBe(true)
  })

  it('does nothing when there is nothing to undo or redo', () => {
    const start = makeProject()
    const bus = new CommandBus(start)

    expect(() => bus.undo()).not.toThrow()
    expect(() => bus.redo()).not.toThrow()
    expect(bus.project).toEqual(start)
  })

  it('clears the redo stack when a new command is executed', () => {
    const bus = new CommandBus(makeProject())

    bus.execute(trimA)
    bus.undo()
    expect(bus.canRedo).toBe(true)

    bus.execute(moveB)

    expect(bus.canRedo).toBe(false)
    bus.redo()
    expect(getClip(bus.project, 't1', 'a').sourceIn).toBe(1000)
    expect(getClip(bus.project, 't1', 'b').start).toBe(5000)
  })
})

describe('executeGroup', () => {
  it('undoes the whole group in one step', () => {
    const start = makeProject()
    const bus = new CommandBus(start)

    bus.executeGroup([trimA, moveB, deleteA])
    expect(clipIds(bus.project, 't1')).toEqual(['b'])

    bus.undo()
    expect(bus.project).toEqual(start)
  })

  it('redoes the whole group in one step', () => {
    const bus = new CommandBus(makeProject())

    bus.executeGroup([trimA, moveB])
    const afterGroup = bus.project
    bus.undo()
    bus.redo()

    expect(bus.project).toEqual(afterGroup)
  })

  it('applies nothing when any command in the group fails', () => {
    const start = makeProject()
    const bus = new CommandBus(start)
    const bad: Command = { type: 'move', trackId: 't1', clipId: 'missing', start: 0 }

    expect(() => bus.executeGroup([trimA, bad])).toThrow()
    expect(bus.project).toEqual(start)
    expect(bus.canUndo).toBe(false)
  })

  it('records nothing for an empty group', () => {
    const bus = new CommandBus(makeProject())
    bus.executeGroup([])

    expect(bus.canUndo).toBe(false)
  })
})

describe('subscribe', () => {
  it('notifies listeners with the new project on every change', () => {
    const bus = new CommandBus(makeProject())
    const listener = vi.fn()
    bus.subscribe(listener)

    bus.execute(trimA)
    bus.undo()
    bus.redo()

    expect(listener).toHaveBeenCalledTimes(3)
    expect(listener).toHaveBeenLastCalledWith(bus.project)
  })

  it('stops notifying after unsubscribe', () => {
    const bus = new CommandBus(makeProject())
    const listener = vi.fn()
    const unsubscribe = bus.subscribe(listener)

    bus.execute(trimA)
    unsubscribe()
    bus.execute(moveB)

    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('does not notify when there is nothing to undo', () => {
    const bus = new CommandBus(makeProject())
    const listener = vi.fn()
    bus.subscribe(listener)

    bus.undo()

    expect(listener).not.toHaveBeenCalled()
  })
})

describe('replace', () => {
  const other: Project = {
    version: 1,
    durationMs: 9000,
    tracks: [
      { id: 't9', clips: [{ id: 'z', sourceId: 's2', sourceIn: 0, sourceOut: 900, start: 0 }] },
    ],
  }

  it('swaps in the new project', () => {
    const bus = new CommandBus(makeProject())
    bus.replace(other)

    expect(bus.project).toEqual(other)
  })

  it('throws away the history, since it describes a project that is no longer loaded', () => {
    const bus = new CommandBus(makeProject())
    bus.execute(trimA)
    bus.undo()
    expect(bus.canRedo).toBe(true)

    bus.replace(other)

    expect(bus.canUndo).toBe(false)
    expect(bus.canRedo).toBe(false)
  })

  it('notifies listeners', () => {
    const bus = new CommandBus(makeProject())
    const listener = vi.fn()
    bus.subscribe(listener)

    bus.replace(other)

    expect(listener).toHaveBeenCalledWith(other)
  })

  it('accepts edits against the new project afterwards', () => {
    const bus = new CommandBus(makeProject())
    bus.replace(other)
    bus.execute({ type: 'move', trackId: 't9', clipId: 'z', start: 500 })

    expect(getClip(bus.project, 't9', 'z').start).toBe(500)
    expect(bus.canUndo).toBe(true)
  })
})
