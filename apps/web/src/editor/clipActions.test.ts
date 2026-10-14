/** The spec for whether a clip edit is possible. */

import { describe, expect, it } from 'vitest'
import { closeGapAvailability, joinAvailability, splitAvailability } from './clipActions'
import { CommandBus } from './history'
import type { Project } from './types'

const ids = () => {
  let n = 0
  return () => `new-${++n}`
}

/**
 *   0 ──── 2000 ──── 5000 ──── 8000
 *   [  a1  ][   a2  ]  gap  [  b  ]
 *
 * a1 and a2 are two halves of one source, continuous across the seam. `b` is other media.
 */
const project: Project = {
  version: 1,
  durationMs: 8000,
  tracks: [
    {
      id: 't1',
      clips: [
        { id: 'a1', sourceId: 's1', sourceIn: 0, sourceOut: 2000, start: 0 },
        { id: 'a2', sourceId: 's1', sourceIn: 2000, sourceOut: 5000, start: 2000 },
        { id: 'b', sourceId: 's2', sourceIn: 0, sourceOut: 3000, start: 8000 },
      ],
    },
  ],
}

describe('split', () => {
  it('offers a split when the playhead is inside the clip', () => {
    const result = splitAvailability(project, 'a1', 1000, ids())

    expect(result).toEqual({
      available: true,
      command: {
        type: 'split',
        trackId: 't1',
        clipId: 'a1',
        atMs: 1000,
        leftId: 'new-1',
        rightId: 'new-2',
      },
    })
  })

  it('needs a selection', () => {
    const result = splitAvailability(project, null, 1000)

    expect(result).toMatchObject({ available: false })
    expect(result).toHaveProperty('reason', expect.stringMatching(/select a clip/i))
  })

  it('refuses on either edge, where a half would be empty', () => {
    for (const playhead of [0, 2000]) {
      expect(splitAvailability(project, 'a1', playhead)).toMatchObject({ available: false })
    }
  })

  it('refuses when the playhead is elsewhere on the timeline', () => {
    const result = splitAvailability(project, 'a1', 7000)

    expect(result).toHaveProperty('reason', expect.stringMatching(/inside the clip/i))
  })

  it('rounds a fractional playhead rather than refusing it', () => {
    expect(splitAvailability(project, 'a1', 1000.4, ids())).toMatchObject({
      available: true,
      command: { atMs: 1000 },
    })
  })
})

describe('join', () => {
  it('offers a join for two continuous halves', () => {
    expect(joinAvailability(project, 'a1', ids())).toEqual({
      available: true,
      command: { type: 'join', trackId: 't1', leftId: 'a1', rightId: 'a2', mergedId: 'new-1' },
    })
  })

  it('needs a selection', () => {
    expect(joinAvailability(project, null)).toMatchObject({ available: false })
  })

  it('refuses on the last clip, with nothing after it', () => {
    const result = joinAvailability(project, 'b')

    expect(result).toHaveProperty('reason', expect.stringMatching(/nothing after/i))
  })

  it('refuses across different media', () => {
    const result = joinAvailability(project, 'a2')

    expect(result).toHaveProperty('reason', expect.stringMatching(/different media/i))
  })

  it('refuses when a cut was taken out between the clips', () => {
    const cut: Project = {
      ...project,
      tracks: [
        {
          id: 't1',
          clips: [
            { id: 'a1', sourceId: 's1', sourceIn: 0, sourceOut: 2000, start: 0 },
            // Starts later in the source: the footage between 2000 and 3000 was removed.
            { id: 'a2', sourceId: 's1', sourceIn: 3000, sourceOut: 5000, start: 2000 },
          ],
        },
      ],
    }

    expect(joinAvailability(cut, 'a1')).toHaveProperty(
      'reason',
      expect.stringMatching(/a cut was made/i),
    )
  })

  it('refuses when there is a gap on the timeline', () => {
    const gap: Project = {
      ...project,
      tracks: [
        {
          id: 't1',
          clips: [
            { id: 'a1', sourceId: 's1', sourceIn: 0, sourceOut: 2000, start: 0 },
            { id: 'a2', sourceId: 's1', sourceIn: 2000, sourceOut: 5000, start: 3000 },
          ],
        },
      ],
    }

    expect(joinAvailability(gap, 'a1')).toHaveProperty(
      'reason',
      expect.stringMatching(/gap between/i),
    )
  })

  it('gives a reason whenever it refuses, never a bare false', () => {
    const refusals = [
      joinAvailability(project, null),
      joinAvailability(project, 'b'),
      joinAvailability(project, 'a2'),
    ]

    for (const refusal of refusals) {
      expect(refusal.available).toBe(false)
      if (!refusal.available) expect(refusal.reason.length).toBeGreaterThan(0)
    }
  })
})

describe('join across storage order', () => {
  /**
   * Clips stored out of timeline order, which is the normal state once anything has been moved:
   * `track.clips` keeps insertion order, not start order.
   *
   *   timeline:  0 ──── 2000 ──── 5000
   *              [  x  ][    y    ]
   *   storage:   [y, x]
   */
  const shuffled: Project = {
    version: 1,
    durationMs: 5000,
    tracks: [
      {
        id: 't1',
        clips: [
          { id: 'y', sourceId: 's1', sourceIn: 2000, sourceOut: 5000, start: 2000 },
          { id: 'x', sourceId: 's1', sourceIn: 0, sourceOut: 2000, start: 0 },
        ],
      },
    ],
  }

  it('offers the clip that is next on the timeline, not next in the array', () => {
    expect(joinAvailability(shuffled, 'x', ids())).toEqual({
      available: true,
      command: { type: 'join', trackId: 't1', leftId: 'x', rightId: 'y', mergedId: 'new-1' },
    })
  })

  it('still refuses on the clip that is genuinely last on the timeline', () => {
    expect(joinAvailability(shuffled, 'y')).toHaveProperty(
      'reason',
      expect.stringMatching(/nothing after/i),
    )
  })
})

describe('closeGapAvailability', () => {
  /**
   *   0 ──── 2000   gap   5000 ──── 8000   gap   9000 ── 10000
   *   [  a  ]             [    b    ]            [  c  ]
   */
  const gapped: Project = {
    version: 1,
    durationMs: 10_000,
    tracks: [
      {
        id: 't1',
        clips: [
          { id: 'b', sourceId: 's1', sourceIn: 0, sourceOut: 3000, start: 5000 },
          { id: 'c', sourceId: 's2', sourceIn: 0, sourceOut: 1000, start: 9000 },
          { id: 'a', sourceId: 's1', sourceIn: 0, sourceOut: 2000, start: 0 },
        ],
      },
    ],
  }

  it('pulls the clip back against the one before it', () => {
    const result = closeGapAvailability(gapped, 'b')

    expect(result).toMatchObject({ available: true, closedMs: 3000 })
    if (!result.available) throw new Error('expected a closure')
    expect(result.commands[0]).toEqual({
      type: 'move',
      trackId: 't1',
      clipId: 'b',
      start: 2000,
    })
  })

  it('brings everything after it along, preserving their spacing', () => {
    const result = closeGapAvailability(gapped, 'b')
    if (!result.available) throw new Error('expected a closure')

    // 'c' sat 1000ms after 'b' ended and still does.
    expect(result.commands.map((c) => c.type === 'move' && c.start)).toEqual([2000, 6000])
  })

  it('moves clips earliest first, so none lands on one that has not moved yet', () => {
    const result = closeGapAvailability(gapped, 'b')
    if (!result.available) throw new Error('expected a closure')

    const starts = result.commands.map((c) => (c.type === 'move' ? c.start : 0))
    expect([...starts].sort((x, y) => x - y)).toEqual(starts)
  })

  it('closes a gap at the very start of the timeline', () => {
    const late: Project = {
      version: 1,
      durationMs: 5000,
      tracks: [
        {
          id: 't1',
          clips: [{ id: 'only', sourceId: 's1', sourceIn: 0, sourceOut: 2000, start: 3000 }],
        },
      ],
    }

    expect(closeGapAvailability(late, 'only')).toMatchObject({ available: true, closedMs: 3000 })
  })

  it('works across different media, which is what Join could never do', () => {
    expect(closeGapAvailability(gapped, 'c')).toMatchObject({ available: true })
  })

  it('refuses when the clip already touches the one before it', () => {
    expect(closeGapAvailability(gapped, 'a')).toHaveProperty(
      'reason',
      expect.stringMatching(/no gap before/i),
    )
  })

  it('needs a selection', () => {
    expect(closeGapAvailability(gapped, null)).toMatchObject({ available: false })
  })
})

describe('closing a gap through the bus', () => {
  const gapped: Project = {
    version: 1,
    durationMs: 10_000,
    tracks: [
      {
        id: 't1',
        clips: [
          { id: 'a', sourceId: 's1', sourceIn: 0, sourceOut: 2000, start: 0 },
          { id: 'b', sourceId: 's1', sourceIn: 0, sourceOut: 3000, start: 5000 },
          { id: 'c', sourceId: 's2', sourceIn: 0, sourceOut: 1000, start: 9000 },
        ],
      },
    ],
  }

  function startsAfter(bus: CommandBus) {
    return [...(bus.project.tracks[0]?.clips ?? [])]
      .sort((x, y) => x.start - y.start)
      .map((clip) => clip.start)
  }

  it('applies without tripping the no-overlap rule', () => {
    // Every move is checked against the clips already moved, so the order has to be right.
    const bus = new CommandBus(gapped)
    const result = closeGapAvailability(gapped, 'b')
    if (!result.available) throw new Error('expected a closure')

    expect(() => bus.executeGroup(result.commands)).not.toThrow()
    expect(startsAfter(bus)).toEqual([0, 2000, 6000])
  })

  it('undoes as a single step', () => {
    const bus = new CommandBus(gapped)
    const result = closeGapAvailability(gapped, 'b')
    if (!result.available) throw new Error('expected a closure')

    bus.executeGroup(result.commands)
    bus.undo()

    expect(bus.project).toEqual(gapped)
    expect(bus.canUndo).toBe(false)
  })

  it('joins two separate imports end to end, which Rejoin cannot do', () => {
    // 'c' comes from different media, so Rejoin refuses it outright.
    expect(joinAvailability(gapped, 'b')).toMatchObject({ available: false })

    const bus = new CommandBus(gapped)
    const result = closeGapAvailability(bus.project, 'c')
    if (!result.available) throw new Error('expected a closure')
    bus.executeGroup(result.commands)

    const clips = bus.project.tracks[0]!.clips
    const b = clips.find((clip) => clip.id === 'b')!
    const c = clips.find((clip) => clip.id === 'c')!
    expect(c.start).toBe(b.start + (b.sourceOut - b.sourceIn))
  })
})
