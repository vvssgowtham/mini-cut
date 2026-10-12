/** The spec for mapping timeline time onto clips. */

import { describe, expect, it } from 'vitest'
import type { Clip } from '../editor/types'
import {
  clipAt,
  inPlaybackOrder,
  nextClipAfter,
  playbackPositionAt,
  sourceTimeFor,
  timelineEnd,
  timelineTimeFor,
} from './timelineMap'

/**
 *   0 ───── 3000 ──── 5000 ──── 7000
 *   [   a   ]  gap    [    b    ]
 *
 * 'a' shows holiday.mp4 from 1000; 'b' shows a different file from 0. Deliberately not in start
 * order, since storage keeps insertion order.
 */
const a: Clip = { id: 'a', sourceId: 'holiday.mp4', sourceIn: 1000, sourceOut: 4000, start: 0 }
const b: Clip = { id: 'b', sourceId: 'beach.mov', sourceIn: 0, sourceOut: 2000, start: 5000 }
const clips = [b, a]

describe('inPlaybackOrder', () => {
  it('sorts by timeline position, not storage order', () => {
    expect(inPlaybackOrder(clips).map((c) => c.id)).toEqual(['a', 'b'])
  })

  it('does not reorder the array it is given', () => {
    const input = [...clips]
    inPlaybackOrder(input)

    expect(input.map((c) => c.id)).toEqual(['b', 'a'])
  })
})

describe('clipAt', () => {
  it('finds the clip covering a position', () => {
    expect(clipAt(clips, 0)?.id).toBe('a')
    expect(clipAt(clips, 2999)?.id).toBe('a')
    expect(clipAt(clips, 5000)?.id).toBe('b')
  })

  it('returns nothing in a gap or past the end', () => {
    expect(clipAt(clips, 4000)).toBeNull()
    expect(clipAt(clips, 99_000)).toBeNull()
  })

  it('hands over cleanly where two clips meet', () => {
    const touching = [
      { ...a, start: 0 },
      { ...b, start: 3000 },
    ]

    // Half-open: 'a' ends at 3000 and 'b' starts there, so only one claims it.
    expect(clipAt(touching, 2999)?.id).toBe('a')
    expect(clipAt(touching, 3000)?.id).toBe('b')
  })

  it('returns nothing for an empty timeline', () => {
    expect(clipAt([], 0)).toBeNull()
  })
})

describe('source and timeline conversion', () => {
  it('maps a timeline position into the source window', () => {
    // 'a' starts at 0 showing source from 1000, so 500 on the timeline is 1500 in the file.
    expect(sourceTimeFor(a, 500)).toBe(1500)
    expect(sourceTimeFor(b, 6000)).toBe(1000)
  })

  it('maps back again', () => {
    expect(timelineTimeFor(a, 1500)).toBe(500)
    expect(timelineTimeFor(b, 1000)).toBe(6000)
  })

  it('round-trips', () => {
    for (const ms of [0, 1, 1234, 2999]) {
      expect(timelineTimeFor(a, sourceTimeFor(a, ms))).toBe(ms)
    }
  })
})

describe('nextClipAfter', () => {
  it('finds the clip that plays next', () => {
    expect(nextClipAfter(clips, a)?.id).toBe('b')
  })

  it('returns nothing after the last clip', () => {
    expect(nextClipAfter(clips, b)).toBeNull()
  })

  it('goes by timeline position, so a clip moved earlier plays earlier', () => {
    const moved = [a, { ...b, start: 100_000 }]

    expect(nextClipAfter(moved, a)?.id).toBe('b')
    expect(nextClipAfter([{ ...b, start: 100_000 }], a)?.id).toBe('b')
  })
})

describe('playbackPositionAt', () => {
  it('resolves a position inside a clip', () => {
    expect(playbackPositionAt(clips, 500)).toEqual({ clip: a, sourceMs: 1500, timelineMs: 500 })
  })

  it('skips forward out of a gap rather than waiting it out', () => {
    // The gap is not part of the cut, and export closes it too.
    expect(playbackPositionAt(clips, 4000)).toEqual({
      clip: b,
      sourceMs: 0,
      timelineMs: 5000,
    })
  })

  it('returns nothing past the end of the last clip', () => {
    expect(playbackPositionAt(clips, 50_000)).toBeNull()
  })

  it('returns nothing for an empty timeline', () => {
    expect(playbackPositionAt([], 0)).toBeNull()
  })

  it('starts at the first clip when the timeline begins with a gap', () => {
    const late = [{ ...a, start: 2000 }]

    expect(playbackPositionAt(late, 0)).toMatchObject({ timelineMs: 2000, sourceMs: 1000 })
  })
})

describe('timelineEnd', () => {
  it('is where the last clip finishes', () => {
    expect(timelineEnd(clips)).toBe(7000)
  })

  it('is zero for an empty timeline', () => {
    expect(timelineEnd([])).toBe(0)
  })
})
