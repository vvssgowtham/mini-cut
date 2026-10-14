/** The spec for hitTest. */

import { describe, expect, it } from 'vitest'
import type { Clip } from '../editor/types'
import { CLIP_HEIGHT_PX, CLIP_TOP_PX, RULER_HEIGHT_PX } from './draw'
import { PLAYHEAD_GRAB_PX, TRIM_HANDLE_PX, hitTest, isScrubTarget } from './hitTest'
import type { Viewport } from './viewport'

const viewport: Viewport = { offsetMs: 0, pxPerMs: 0.1, widthPx: 800 }

const clip = (id: string, start: number, durationMs: number): Clip => ({
  id,
  sourceId: 's1',
  sourceIn: 0,
  sourceOut: durationMs,
  start,
})

/** 'a' spans x 0..200, 'b' spans x 400..600. */
const clips = [clip('a', 0, 2000), clip('b', 4000, 2000)]

/** Vertically centred on the clip row. */
const midY = CLIP_TOP_PX + CLIP_HEIGHT_PX / 2

describe('vertical bounds', () => {
  it('misses above and below the clip row', () => {
    expect(hitTest(viewport, clips, 100, CLIP_TOP_PX - 1)).toBeNull()
    expect(hitTest(viewport, clips, 100, CLIP_TOP_PX + CLIP_HEIGHT_PX + 1)).toBeNull()
  })

  it('hits exactly on the row edges', () => {
    expect(hitTest(viewport, clips, 100, CLIP_TOP_PX)?.clipId).toBe('a')
    expect(hitTest(viewport, clips, 100, CLIP_TOP_PX + CLIP_HEIGHT_PX)?.clipId).toBe('a')
  })
})

describe('horizontal bounds', () => {
  it('misses in the gap between clips', () => {
    expect(hitTest(viewport, clips, 300, midY)).toBeNull()
  })

  it('misses past the last clip', () => {
    expect(hitTest(viewport, clips, 700, midY)).toBeNull()
  })

  it('finds the right clip', () => {
    expect(hitTest(viewport, clips, 100, midY)?.clipId).toBe('a')
    expect(hitTest(viewport, clips, 500, midY)?.clipId).toBe('b')
  })
})

describe('handles', () => {
  it('reports the body away from either end', () => {
    expect(hitTest(viewport, clips, 100, midY)).toEqual({ clipId: 'a', kind: 'body' })
  })

  it('reports the start handle at the left edge', () => {
    expect(hitTest(viewport, clips, 0, midY)).toEqual({ clipId: 'a', kind: 'trim-start' })
    expect(hitTest(viewport, clips, TRIM_HANDLE_PX, midY)?.kind).toBe('trim-start')
  })

  it('reports the end handle at the right edge', () => {
    expect(hitTest(viewport, clips, 200, midY)).toEqual({ clipId: 'a', kind: 'trim-end' })
    expect(hitTest(viewport, clips, 200 - TRIM_HANDLE_PX, midY)?.kind).toBe('trim-end')
  })

  it('switches to the body just inside the handle', () => {
    expect(hitTest(viewport, clips, TRIM_HANDLE_PX + 1, midY)?.kind).toBe('body')
  })

  it('prefers the start handle on a clip too narrow for both', () => {
    // 100 ms at 0.1 px/ms is 10 px wide, narrower than two 8 px handles.
    const narrow = [clip('n', 0, 100)]

    expect(hitTest(viewport, narrow, 5, midY)?.kind).toBe('trim-start')
  })
})

describe('overlap and scroll', () => {
  it('picks the clip drawn on top where two overlap', () => {
    // Both cover x 0..200; 'later' starts after 'earlier', so it is drawn second and sits on top.
    const overlapping = [clip('earlier', 0, 2000), clip('later', 500, 1500)]

    expect(hitTest(viewport, overlapping, 150, midY)?.clipId).toBe('later')
  })

  it('accounts for the scroll offset', () => {
    const scrolled: Viewport = { ...viewport, offsetMs: 4000 }

    expect(hitTest(scrolled, clips, 100, midY)?.clipId).toBe('b')
    expect(hitTest(scrolled, clips, 100, midY)?.kind).toBe('body')
  })

  it('ignores clips scrolled out of view', () => {
    const scrolled: Viewport = { ...viewport, offsetMs: 100_000 }

    expect(hitTest(scrolled, clips, 100, midY)).toBeNull()
  })
})

describe('isScrubTarget', () => {
  const playheadMs = 3000 // x = 300 at this viewport

  it('treats the ruler as a scrub band', () => {
    // Always reachable, even when the playhead itself is off screen.
    expect(isScrubTarget(viewport, playheadMs, 50, 0)).toBe(true)
    expect(isScrubTarget(viewport, playheadMs, 50, RULER_HEIGHT_PX)).toBe(true)
  })

  it('treats the playhead line as grabbable below the ruler', () => {
    expect(isScrubTarget(viewport, playheadMs, 300, midY)).toBe(true)
  })

  it('allows a margin either side, since a one pixel target cannot be hit', () => {
    expect(isScrubTarget(viewport, playheadMs, 300 - PLAYHEAD_GRAB_PX, midY)).toBe(true)
    expect(isScrubTarget(viewport, playheadMs, 300 + PLAYHEAD_GRAB_PX, midY)).toBe(true)
  })

  it('leaves the rest of the track to the clips', () => {
    expect(isScrubTarget(viewport, playheadMs, 300 + PLAYHEAD_GRAB_PX + 1, midY)).toBe(false)
    expect(isScrubTarget(viewport, playheadMs, 100, midY)).toBe(false)
  })

  it('follows the playhead as it moves', () => {
    expect(isScrubTarget(viewport, 5000, 500, midY)).toBe(true)
    expect(isScrubTarget(viewport, 5000, 300, midY)).toBe(false)
  })
})
