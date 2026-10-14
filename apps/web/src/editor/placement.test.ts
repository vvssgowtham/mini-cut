/** The spec for where a clip may sit. */

import { describe, expect, it } from 'vitest'
import { clampStart, findOverlaps, maxEndFor, placementBounds, resolveOverlaps } from './placement'
import type { Clip } from './types'

const clip = (id: string, start: number, durationMs: number): Clip => ({
  id,
  sourceId: 's1',
  sourceIn: 0,
  sourceOut: durationMs,
  start,
})

/**
 *   0 ──── 2000 ──── 5000 ──── 8000 ──── 9000
 *   [  a   ]  gap    [   b    ]  gap  [ c ]
 *
 * Stored out of start order on purpose: insertion order is not timeline order.
 */
const clips = [clip('b', 5000, 3000), clip('c', 9000, 1000), clip('a', 0, 2000)]

describe('placementBounds', () => {
  it('lets a middle clip slide between its neighbours', () => {
    // 'b' is 3000 long: it can start anywhere from a's end to 1000 ms before c starts.
    expect(placementBounds(clips, 'b')).toEqual({ minStart: 2000, maxStart: 6000 })
  })

  it('lets the first clip run back to the start of the timeline', () => {
    expect(placementBounds(clips, 'a').minStart).toBe(0)
  })

  it('leaves the last clip unbounded to the right', () => {
    expect(placementBounds(clips, 'c').maxStart).toBe(Number.POSITIVE_INFINITY)
  })

  it('leaves a lone clip free except for the start of the timeline', () => {
    expect(placementBounds([clip('only', 4000, 1000)], 'only')).toEqual({
      minStart: 0,
      maxStart: Number.POSITIVE_INFINITY,
    })
  })

  it('does not constrain a clip that is not there', () => {
    expect(placementBounds(clips, 'ghost').minStart).toBe(0)
  })
})

describe('clampStart', () => {
  it('leaves a legal position alone', () => {
    expect(clampStart(clips, 'b', 3000)).toBe(3000)
  })

  it('stops against the clip before rather than overlapping it', () => {
    expect(clampStart(clips, 'b', 0)).toBe(2000)
  })

  it('stops against the clip after rather than overlapping it', () => {
    expect(clampStart(clips, 'b', 99_999)).toBe(6000)
  })

  it('never goes before the start of the timeline', () => {
    expect(clampStart(clips, 'a', -5000)).toBe(0)
  })

  it('rounds, since a drag is pixel arithmetic', () => {
    expect(Number.isInteger(clampStart(clips, 'b', 3000.6))).toBe(true)
  })

  it('leaves a clip exactly touching its neighbour, which is legal', () => {
    // Touching is not overlapping: the ranges are half-open.
    expect(clampStart(clips, 'b', 2000)).toBe(2000)
  })
})

describe('findOverlaps', () => {
  it('finds nothing in a well-formed timeline', () => {
    expect(findOverlaps(clips)).toEqual([])
  })

  it('finds nothing when clips merely touch', () => {
    expect(findOverlaps([clip('a', 0, 2000), clip('b', 2000, 1000)])).toEqual([])
  })

  it('reports an overlapping pair', () => {
    const overlapping = [clip('a', 0, 2000), clip('b', 1500, 1000)]
    const found = findOverlaps(overlapping)

    expect(found).toHaveLength(1)
    expect(found[0]?.left.id).toBe('a')
    expect(found[0]?.right.id).toBe('b')
  })

  it('reports in timeline order regardless of storage order', () => {
    const overlapping = [clip('b', 1500, 1000), clip('a', 0, 2000)]

    expect(findOverlaps(overlapping)[0]?.left.id).toBe('a')
  })
})

describe('resolveOverlaps', () => {
  it('leaves a well-formed timeline untouched', () => {
    const tidy = [clip('a', 0, 2000), clip('b', 2000, 1000)]

    expect(resolveOverlaps(tidy)).toEqual(tidy)
  })

  it('pushes an overlapping clip right until it sits flush', () => {
    const overlapping = [clip('a', 0, 2000), clip('b', 1000, 1000)]

    expect(resolveOverlaps(overlapping).map((c) => [c.id, c.start])).toEqual([
      ['a', 0],
      ['b', 2000],
    ])
  })

  it('keeps every frame of footage rather than truncating', () => {
    const overlapping = [clip('a', 0, 2000), clip('b', 1000, 1000)]
    const resolved = resolveOverlaps(overlapping)

    for (const before of overlapping) {
      const after = resolved.find((c) => c.id === before.id)
      expect(after).toBeDefined()
      expect(after!.sourceOut - after!.sourceIn).toBe(before.sourceOut - before.sourceIn)
    }
  })

  it('cascades through a chain of overlaps', () => {
    const piled = [clip('a', 0, 2000), clip('b', 500, 2000), clip('c', 600, 1000)]

    expect(resolveOverlaps(piled).map((c) => c.start)).toEqual([0, 2000, 4000])
  })

  it('returns clips in timeline order', () => {
    const shuffled = [clip('b', 3000, 1000), clip('a', 0, 2000)]

    expect(resolveOverlaps(shuffled).map((c) => c.id)).toEqual(['a', 'b'])
  })

  it('handles an empty timeline', () => {
    expect(resolveOverlaps([])).toEqual([])
  })
})

describe('maxEndFor', () => {
  it('stops at the next clip', () => {
    expect(maxEndFor(clips, 'a')).toBe(5000)
  })

  it('is unbounded for the last clip', () => {
    expect(maxEndFor(clips, 'c')).toBe(Number.POSITIVE_INFINITY)
  })
})
