/**
 * The spec for `apply`. These tests define the behaviour — make them pass.
 *
 * Read them before you write any code; they answer most "what should happen if..." questions.
 */

import { describe, expect, it } from 'vitest'
import { apply } from './commands'
import type { DeleteOp, InsertOp, JoinOp, MergeOp, MoveOp, Op, SplitOp, TrimOp } from './commands'
import { clipIds, deepFreeze, getClip, makeProject } from './fixtures'
import { clipEnd } from './types'

const trimA: TrimOp = { type: 'trim', trackId: 't1', clipId: 'a', sourceIn: 1500, sourceOut: 3000 }
const moveB: MoveOp = { type: 'move', trackId: 't1', clipId: 'b', start: 5000 }
const deleteA: DeleteOp = { type: 'delete', trackId: 't1', clipId: 'a' }
const splitA: SplitOp = {
  type: 'split',
  trackId: 't1',
  clipId: 'a',
  atMs: 1000,
  leftId: 'a1',
  rightId: 'a2',
}

describe('trim', () => {
  it('changes the source window and leaves start alone', () => {
    const { project } = apply(makeProject(), trimA)
    const a = getClip(project, 't1', 'a')

    expect(a.sourceIn).toBe(1500)
    expect(a.sourceOut).toBe(3000)
    expect(a.start).toBe(0)
    expect(clipEnd(a)).toBe(1500)
  })

  it('inverts back to the original window', () => {
    const inverse = apply(makeProject(), trimA).inverse

    expect(inverse).toEqual({
      type: 'trim',
      trackId: 't1',
      clipId: 'a',
      sourceIn: 1000,
      sourceOut: 3000,
    })
  })

  it('rejects a window that is empty or inverted', () => {
    const empty: TrimOp = { ...trimA, sourceIn: 2000, sourceOut: 2000 }
    const inverted: TrimOp = { ...trimA, sourceIn: 2500, sourceOut: 2000 }

    expect(() => apply(makeProject(), empty)).toThrow()
    expect(() => apply(makeProject(), inverted)).toThrow()
  })
})

describe('move', () => {
  it('changes start only', () => {
    const { project } = apply(makeProject(), moveB)
    const b = getClip(project, 't1', 'b')

    expect(b.start).toBe(5000)
    expect(b.sourceIn).toBe(5000)
    expect(b.sourceOut).toBe(6000)
  })

  it('inverts back to the original start', () => {
    expect(apply(makeProject(), moveB).inverse).toEqual({
      type: 'move',
      trackId: 't1',
      clipId: 'b',
      start: 2000,
    })
  })

  it('rejects a negative start', () => {
    expect(() => apply(makeProject(), { ...moveB, start: -1 })).toThrow()
  })
})

describe('delete', () => {
  it('removes the clip', () => {
    const { project } = apply(makeProject(), deleteA)

    expect(clipIds(project, 't1')).toEqual(['b'])
  })

  it('inverts to an insert that remembers the index', () => {
    const inverse = apply(makeProject(), deleteA).inverse as InsertOp

    expect(inverse.type).toBe('insert')
    expect(inverse.index).toBe(0)
    expect(inverse.clip).toEqual(getClip(makeProject(), 't1', 'a'))
  })

  it('restores the clip at its original index, not at the end', () => {
    const start = makeProject()
    const { project: deleted, inverse } = apply(start, deleteA)
    const { project: restored } = apply(deleted, inverse)

    expect(clipIds(restored, 't1')).toEqual(['a', 'b'])
    expect(restored).toEqual(start)
  })
})

describe('split', () => {
  it('replaces the clip with two halves that meet at the split point', () => {
    const { project } = apply(makeProject(), splitA)

    expect(clipIds(project, 't1')).toEqual(['a1', 'a2', 'b'])

    const left = getClip(project, 't1', 'a1')
    const right = getClip(project, 't1', 'a2')

    expect(left).toEqual({ id: 'a1', sourceId: 's1', sourceIn: 1000, sourceOut: 2000, start: 0 })
    expect(right).toEqual({
      id: 'a2',
      sourceId: 's1',
      sourceIn: 2000,
      sourceOut: 3000,
      start: 1000,
    })
    expect(clipEnd(left)).toBe(right.start)
  })

  it('inverts to a merge that restores the original clip and index', () => {
    const start = makeProject()
    const { project: split, inverse } = apply(start, splitA)
    const merge = inverse as MergeOp

    expect(merge.type).toBe('merge')
    expect(merge.clip).toEqual(getClip(start, 't1', 'a'))

    const { project: merged } = apply(split, merge)
    expect(merged).toEqual(start)
  })

  it('rejects a split at or outside the clip edges', () => {
    const base = makeProject()

    expect(() => apply(base, { ...splitA, atMs: 0 })).toThrow()
    expect(() => apply(base, { ...splitA, atMs: 2000 })).toThrow()
    expect(() => apply(base, { ...splitA, atMs: 2500 })).toThrow()
  })

  it('rejects ids that collide with an existing clip', () => {
    expect(() => apply(makeProject(), { ...splitA, leftId: 'b' })).toThrow()
  })
})

describe('validation', () => {
  it('throws on an unknown track or clip', () => {
    expect(() => apply(makeProject(), { ...trimA, trackId: 'nope' })).toThrow()
    expect(() => apply(makeProject(), { ...trimA, clipId: 'nope' })).toThrow()
  })
})

describe('purity', () => {
  it('does not mutate the project it is given', () => {
    const ops: Op[] = [trimA, moveB, deleteA, splitA]

    for (const op of ops) {
      const frozen = deepFreeze(makeProject())
      expect(() => apply(frozen, op)).not.toThrow()
      expect(frozen).toEqual(makeProject())
    }
  })

  it('reuses untouched objects instead of copying everything', () => {
    const start = makeProject()
    const { project } = apply(start, trimA)

    // 'b' was not touched, so it should be the very same object.
    expect(getClip(project, 't1', 'b')).toBe(getClip(start, 't1', 'b'))
  })
})

describe('inverse round trip', () => {
  it('returns to the exact starting project for every op', () => {
    const ops: Op[] = [trimA, moveB, deleteA, splitA]

    for (const op of ops) {
      const start = makeProject()
      const { project: after, inverse } = apply(start, op)
      const { project: back } = apply(after, inverse)

      expect(back).toEqual(start)
    }
  })

  it('unwinds a sequence of edits in reverse order', () => {
    const start = makeProject()
    const sequence: Op[] = [trimA, moveB, splitA, { type: 'delete', trackId: 't1', clipId: 'b' }]

    let project = start
    const inverses: Op[] = []
    for (const op of sequence) {
      const result = apply(project, op)
      project = result.project
      inverses.unshift(result.inverse)
    }

    for (const inverse of inverses) {
      project = apply(project, inverse).project
    }

    expect(project).toEqual(start)
  })
})

describe('join', () => {
  /** Split 'a' at 1000 first, so there are two genuinely contiguous halves to join back. */
  function splitProject() {
    return apply(makeProject(), splitA).project
  }

  const joinA: JoinOp = {
    type: 'join',
    trackId: 't1',
    leftId: 'a1',
    rightId: 'a2',
    mergedId: 'whole',
  }

  it('replaces the two halves with one clip spanning both', () => {
    const { project } = apply(splitProject(), joinA)

    expect(clipIds(project, 't1')).toEqual(['whole', 'b'])
    expect(getClip(project, 't1', 'whole')).toEqual({
      id: 'whole',
      sourceId: 's1',
      sourceIn: 1000,
      sourceOut: 3000,
      start: 0,
    })
  })

  it('is the exact inverse of a split', () => {
    const start = makeProject()
    const split = apply(start, splitA).project
    const { project: joined, inverse } = apply(split, joinA)

    expect(apply(joined, inverse).project).toEqual(split)
  })

  it('refuses clips that are not next to each other', () => {
    expect(() => apply(splitProject(), { ...joinA, leftId: 'a1', rightId: 'b' })).toThrow(
      /next to each other/,
    )
  })

  it('refuses clips from different media', () => {
    const base = splitProject()
    const track = base.tracks[0]!
    const mixed = {
      ...base,
      tracks: [
        {
          ...track,
          clips: track.clips.map((c) => (c.id === 'a2' ? { ...c, sourceId: 'other' } : c)),
        },
      ],
    }

    expect(() => apply(mixed, joinA)).toThrow(/different media/)
  })

  it('refuses halves with a cut taken out between them', () => {
    // Trim the right half's start forward: the footage between the two no longer joins up.
    const trimmed = apply(splitProject(), {
      type: 'trim',
      trackId: 't1',
      clipId: 'a2',
      sourceIn: 2500,
      sourceOut: 3000,
    }).project

    expect(() => apply(trimmed, joinA)).toThrow(/a cut was made/)
  })

  it('refuses halves with a gap on the timeline', () => {
    const moved = apply(splitProject(), {
      type: 'move',
      trackId: 't1',
      clipId: 'a2',
      start: 1500,
    }).project

    expect(() => apply(moved, joinA)).toThrow(/gap between them/)
  })

  it('refuses an id that is already taken', () => {
    expect(() => apply(splitProject(), { ...joinA, mergedId: 'b' })).toThrow(/already taken/)
  })

  it('does not mutate the project it is given', () => {
    const frozen = deepFreeze(splitProject())

    expect(() => apply(frozen, joinA)).not.toThrow()
    expect(clipIds(frozen, 't1')).toEqual(['a1', 'a2', 'b'])
  })
})
