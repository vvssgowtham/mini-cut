/** The spec for turning an agent plan into editor commands. */

import { describe, expect, it } from 'vitest'
import { CommandBus } from '../editor/history'
import type { Project } from '../editor/types'
import { PlanRejectedError, applyPlan, planToCommands } from './applyPlan'

const project: Project = {
  version: 1,
  durationMs: 15_000,
  tracks: [
    {
      id: 't1',
      clips: [
        { id: 'a', sourceId: 's1', sourceIn: 0, sourceOut: 10_000, start: 0 },
        { id: 'b', sourceId: 's1', sourceIn: 0, sourceOut: 5000, start: 10_000 },
      ],
    },
  ],
}

const plan = (operations: unknown[]) => ({ summary: 'A change.', operations })

describe('conversion', () => {
  it('resolves the clip id to its track, which the agent never sees', () => {
    const commands = planToCommands(
      plan([{ type: 'trim', clipId: 'a', sourceIn: 1000, sourceOut: 10_000 }]),
      project,
    )

    expect(commands[0]).toEqual({
      type: 'trim',
      trackId: 't1',
      clipId: 'a',
      sourceIn: 1000,
      sourceOut: 10_000,
    })
  })

  it('finds a clip on a second track', () => {
    const twoTracks: Project = {
      ...project,
      tracks: [
        { id: 't1', clips: [] },
        { id: 't2', clips: project.tracks[0]!.clips },
      ],
    }

    expect(planToCommands(plan([{ type: 'delete', clipId: 'b' }]), twoTracks)[0]).toMatchObject({
      trackId: 't2',
    })
  })

  it('generates both ids for a split, rather than taking them from the model', () => {
    const command = planToCommands(plan([{ type: 'split', clipId: 'a', atMs: 5000 }]), project)[0]

    expect(command).toMatchObject({ type: 'split', atMs: 5000 })
    const split = command as { leftId: string; rightId: string }
    expect(split.leftId).not.toBe(split.rightId)
    expect(split.leftId.length).toBeGreaterThan(0)
  })

  it('converts several operations in order', () => {
    const commands = planToCommands(
      plan([
        { type: 'move', clipId: 'b', start: 12_000 },
        { type: 'delete', clipId: 'a' },
      ]),
      project,
    )

    expect(commands.map((c) => c.type)).toEqual(['move', 'delete'])
  })
})

describe('rejection', () => {
  it('rejects a plan that is not a plan', () => {
    expect(() => planToCommands('nonsense', project)).toThrow(PlanRejectedError)
    expect(() => planToCommands(null, project)).toThrow(PlanRejectedError)
  })

  it('rejects an unknown operation type', () => {
    expect(() => planToCommands(plan([{ type: 'explode', clipId: 'a' }]), project)).toThrow(
      PlanRejectedError,
    )
  })

  it('rejects a clip that does not exist', () => {
    expect(() => planToCommands(plan([{ type: 'delete', clipId: 'ghost' }]), project)).toThrow(
      /ghost/,
    )
  })

  it('rejects a trim that would empty the clip', () => {
    expect(() =>
      planToCommands(
        plan([{ type: 'trim', clipId: 'a', sourceIn: 5000, sourceOut: 5000 }]),
        project,
      ),
    ).toThrow(PlanRejectedError)
  })

  it('rejects a split outside the clip, even though the server checked too', () => {
    // Checked again on this side: the response crossed a network to get here.
    expect(() =>
      planToCommands(plan([{ type: 'split', clipId: 'a', atMs: 99_000 }]), project),
    ).toThrow(/outside/)
  })

  it('rejects a negative time', () => {
    expect(() => planToCommands(plan([{ type: 'move', clipId: 'a', start: -1 }]), project)).toThrow(
      PlanRejectedError,
    )
  })
})

describe('applying', () => {
  it('applies the whole plan', () => {
    const bus = new CommandBus(project)

    applyPlan(bus, {
      summary: 'Trim and move.',
      operations: [
        { type: 'trim', clipId: 'a', sourceIn: 2000, sourceOut: 10_000 },
        { type: 'move', clipId: 'b', start: 20_000 },
      ],
    })

    const clips = bus.project.tracks[0]!.clips
    expect(clips.find((c) => c.id === 'a')?.sourceIn).toBe(2000)
    expect(clips.find((c) => c.id === 'b')?.start).toBe(20_000)
  })

  it('undoes the whole plan in one step', () => {
    const bus = new CommandBus(project)

    applyPlan(bus, {
      summary: 'Remove both.',
      operations: [
        { type: 'delete', clipId: 'a' },
        { type: 'delete', clipId: 'b' },
      ],
    })
    expect(bus.project.tracks[0]!.clips).toHaveLength(0)

    bus.undo()

    expect(bus.project).toEqual(project)
    expect(bus.canUndo).toBe(false)
  })

  it('leaves the project untouched when any operation in the plan is bad', () => {
    const bus = new CommandBus(project)

    expect(() =>
      applyPlan(bus, {
        summary: 'Partly wrong.',
        operations: [
          { type: 'delete', clipId: 'a' },
          { type: 'delete', clipId: 'ghost' },
        ],
      }),
    ).toThrow(PlanRejectedError)

    expect(bus.project).toEqual(project)
    expect(bus.canUndo).toBe(false)
  })
})
