/** The spec for keyboard editing. */

import { describe, expect, it } from 'vitest'
import type { Project } from '../editor/types'
import { NUDGE_LARGE_MS, NUDGE_MS, applyKeyAction, keyToAction } from './keyboard'

/**
 *   0 ───── 5000 ──── 8000 ──── 12000
 *   [   a   ]         [    b    ]
 */
const project: Project = {
  version: 1,
  durationMs: 12_000,
  tracks: [
    {
      id: 't1',
      clips: [
        { id: 'b', sourceId: 's1', sourceIn: 0, sourceOut: 4000, start: 8000 },
        { id: 'a', sourceId: 's1', sourceIn: 1000, sourceOut: 6000, start: 0 },
      ],
    },
  ],
}

const ids = () => {
  let n = 0
  return () => `new-${++n}`
}

describe('keyToAction', () => {
  it('walks the selection with the arrow keys', () => {
    expect(keyToAction({ key: 'ArrowRight' })).toEqual({ type: 'select', direction: 1 })
    expect(keyToAction({ key: 'ArrowLeft' })).toEqual({ type: 'select', direction: -1 })
  })

  it('nudges with alt held', () => {
    expect(keyToAction({ key: 'ArrowRight', altKey: true })).toEqual({
      type: 'nudge',
      deltaMs: NUDGE_MS,
    })
  })

  it('nudges further with shift', () => {
    expect(keyToAction({ key: 'ArrowLeft', altKey: true, shiftKey: true })).toEqual({
      type: 'nudge',
      deltaMs: -NUDGE_LARGE_MS,
    })
  })

  it('maps the editing keys', () => {
    expect(keyToAction({ key: '[' })?.type).toBe('trim-in')
    expect(keyToAction({ key: ']' })?.type).toBe('trim-out')
    expect(keyToAction({ key: 's' })?.type).toBe('split')
    expect(keyToAction({ key: 'S' })?.type).toBe('split')
    expect(keyToAction({ key: 'Delete' })?.type).toBe('delete')
    expect(keyToAction({ key: 'Backspace' })?.type).toBe('delete')
  })

  it('ignores keys held with ctrl or cmd, which belong to undo and the browser', () => {
    expect(keyToAction({ key: 's', metaKey: true })).toBeNull()
    expect(keyToAction({ key: 'ArrowLeft', ctrlKey: true })).toBeNull()
    expect(keyToAction({ key: 'z', ctrlKey: true })).toBeNull()
  })

  it('ignores anything else', () => {
    expect(keyToAction({ key: 'q' })).toBeNull()
    expect(keyToAction({ key: 'Enter' })).toBeNull()
  })
})

describe('selection', () => {
  it('moves to the next clip in timeline order, not storage order', () => {
    const result = applyKeyAction({ type: 'select', direction: 1 }, project, 'a', 0)

    expect(result.selection).toBe('b')
  })

  it('moves backwards', () => {
    expect(applyKeyAction({ type: 'select', direction: -1 }, project, 'b', 0).selection).toBe('a')
  })

  it('stops at the ends rather than wrapping', () => {
    expect(applyKeyAction({ type: 'select', direction: -1 }, project, 'a', 0).selection).toBe('a')
    expect(applyKeyAction({ type: 'select', direction: 1 }, project, 'b', 0).selection).toBe('b')
  })

  it('steps in from the near end when nothing is selected', () => {
    expect(applyKeyAction({ type: 'select', direction: 1 }, project, null, 0).selection).toBe('a')
    expect(applyKeyAction({ type: 'select', direction: -1 }, project, null, 0).selection).toBe('b')
  })

  it('does nothing on an empty timeline', () => {
    const empty: Project = { version: 1, durationMs: 0, tracks: [{ id: 't1', clips: [] }] }

    expect(applyKeyAction({ type: 'select', direction: 1 }, empty, null, 0)).toEqual({
      commands: [],
    })
  })
})

describe('needing a selection', () => {
  it('says so rather than failing silently', () => {
    const result = applyKeyAction({ type: 'split' }, project, null, 2000)

    expect(result.commands).toEqual([])
    expect(result.message).toMatch(/select a clip/i)
  })
})

describe('nudge', () => {
  it('moves the clip along the timeline', () => {
    const result = applyKeyAction({ type: 'nudge', deltaMs: 500 }, project, 'a', 0)

    expect(result.commands).toEqual([{ type: 'move', trackId: 't1', clipId: 'a', start: 500 }])
  })

  it('stops at the start of the timeline', () => {
    // 'b' starts at 8000, so a 20 s nudge left clamps rather than going negative.
    const result = applyKeyAction({ type: 'nudge', deltaMs: -20_000 }, project, 'b', 0)

    expect(result.commands).toEqual([{ type: 'move', trackId: 't1', clipId: 'b', start: 0 }])
  })

  it('emits nothing when the clip is already at the start', () => {
    expect(applyKeyAction({ type: 'nudge', deltaMs: -5000 }, project, 'a', 0).commands).toEqual([])
  })

  it('emits nothing when the clip is already there', () => {
    expect(applyKeyAction({ type: 'nudge', deltaMs: -100 }, project, 'a', 0).commands).toEqual([])
  })
})

describe('trim to playhead', () => {
  it('trims the in point and moves the clip with it', () => {
    // Clip 'a' runs 0..5000 showing source 1000..6000. Playhead at 2000 cuts 2 s off the front.
    const result = applyKeyAction({ type: 'trim-in' }, project, 'a', 2000)

    expect(result.commands).toEqual([
      { type: 'trim', trackId: 't1', clipId: 'a', sourceIn: 3000, sourceOut: 6000 },
      { type: 'move', trackId: 't1', clipId: 'a', start: 2000 },
    ])
  })

  it('trims the out point without moving the clip', () => {
    const result = applyKeyAction({ type: 'trim-out' }, project, 'a', 3000)

    expect(result.commands).toEqual([
      { type: 'trim', trackId: 't1', clipId: 'a', sourceIn: 1000, sourceOut: 4000 },
    ])
  })

  it('refuses a trim that would collapse the clip', () => {
    // Playhead at the clip's own start: trimming out to there leaves nothing.
    const result = applyKeyAction({ type: 'trim-out' }, project, 'a', 0)

    expect(result.commands).toEqual([])
    expect(result.message).toMatch(/outside the clip/i)
  })

  it('refuses a trim-in past the clip end', () => {
    const result = applyKeyAction({ type: 'trim-in' }, project, 'a', 9000)

    expect(result.commands).toEqual([])
    expect(result.message).toBeTruthy()
  })

  it('emits nothing when the playhead is already on the edge', () => {
    expect(applyKeyAction({ type: 'trim-in' }, project, 'a', 0).commands).toEqual([])
  })
})

describe('split', () => {
  it('splits at the playhead with two fresh ids', () => {
    const result = applyKeyAction({ type: 'split' }, project, 'a', 2500, ids())

    expect(result.commands).toEqual([
      {
        type: 'split',
        trackId: 't1',
        clipId: 'a',
        atMs: 2500,
        leftId: 'new-1',
        rightId: 'new-2',
      },
    ])
  })

  it('refuses a split on either edge or outside the clip', () => {
    for (const playhead of [0, 5000, 7000]) {
      const result = applyKeyAction({ type: 'split' }, project, 'a', playhead, ids())
      expect(result.commands).toEqual([])
      expect(result.message).toMatch(/inside the clip/i)
    }
  })
})

describe('delete', () => {
  it('removes the clip and clears the selection', () => {
    const result = applyKeyAction({ type: 'delete' }, project, 'b', 0)

    expect(result.commands).toEqual([{ type: 'delete', trackId: 't1', clipId: 'b' }])
    expect(result.selection).toBeNull()
  })
})
