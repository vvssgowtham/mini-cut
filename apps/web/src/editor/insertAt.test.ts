/** The spec for inserting imported footage into the middle of a cut. */

import { describe, expect, it } from 'vitest'
import { apply } from './commands'
import { insertAtCommands } from './insertAt'
import { clipEnd, type Clip, type Project, type Track } from './types'

const incoming = { sourceId: 'new.mp4', sourceIn: 0, sourceOut: 2000 }

/** Ids in order, so a test can say which clip a command is talking about. */
function ids(): () => string {
  let n = 0
  return () => `n${++n}`
}

function trackOf(...clips: Clip[]): Track {
  return { id: 't', clips }
}

function projectOf(track: Track): Project {
  return { version: 1, durationMs: 0, tracks: [track] }
}

/** Runs the commands the way the bus would, and hands back the clips in timeline order. */
function timelineAfter(track: Track, atMs: number): Clip[] {
  const { commands } = insertAtCommands(track, incoming, atMs, ids())
  let project = projectOf(track)
  for (const command of commands) project = apply(project, command).project

  return [...(project.tracks[0]?.clips ?? [])].sort((a, b) => a.start - b.start)
}

const first: Clip = { id: 'a', sourceId: 'one.mp4', sourceIn: 0, sourceOut: 3000, start: 0 }
const second: Clip = { id: 'b', sourceId: 'one.mp4', sourceIn: 3000, sourceOut: 5000, start: 3000 }

describe('insertAtCommands', () => {
  it('appends when the playhead is past the end', () => {
    const after = timelineAfter(trackOf(first), 99_000)

    expect(after.map((clip) => [clip.sourceId, clip.start])).toEqual([
      ['one.mp4', 0],
      ['new.mp4', 3000],
    ])
  })

  it('appends onto an empty timeline', () => {
    const after = timelineAfter(trackOf(), 0)

    expect(after.map((clip) => [clip.sourceId, clip.start])).toEqual([['new.mp4', 0]])
  })

  it('lands on a cut and pushes what follows right', () => {
    // The case that sent the import to the far end: split at 3s, import, expect it in the hole.
    const after = timelineAfter(trackOf(first, second), 3000)

    expect(after.map((clip) => [clip.sourceId, clip.start])).toEqual([
      ['one.mp4', 0],
      ['new.mp4', 3000],
      ['one.mp4', 5000],
    ])
  })

  it('splits the clip the playhead sits inside', () => {
    const after = timelineAfter(trackOf(first), 1000)

    expect(after.map((clip) => [clip.sourceId, clip.start, clip.sourceIn, clip.sourceOut])).toEqual(
      [
        ['one.mp4', 0, 0, 1000],
        ['new.mp4', 1000, 0, 2000],
        // The rest of the take resumes where it was interrupted, 3s later on the timeline.
        ['one.mp4', 3000, 1000, 3000],
      ],
    )
  })

  it('inserts before everything when the playhead is at the very start', () => {
    const after = timelineAfter(trackOf(first), 0)

    expect(after.map((clip) => [clip.sourceId, clip.start])).toEqual([
      ['new.mp4', 0],
      ['one.mp4', 2000],
    ])
  })

  it('keeps the gaps between later clips the width they were', () => {
    const far: Clip = { ...second, start: 10_000 }
    const after = timelineAfter(trackOf(first, far), 3000)

    // The gap was 7s and stays 7s: the cut slides, it does not rearrange itself.
    expect(after.map((clip) => clip.start)).toEqual([0, 3000, 12_000])
    expect(after[2]!.start - clipEnd(after[1]!)).toBe(7000)
  })

  it('never leaves two clips on top of each other', () => {
    for (const at of [0, 1, 1500, 3000, 4999, 5000]) {
      const after = timelineAfter(trackOf(first, second), at)

      for (let i = 1; i < after.length; i++) {
        expect(after[i]!.start).toBeGreaterThanOrEqual(clipEnd(after[i - 1]!))
      }
    }
  })

  it('reports the clip it will create, so the caller can select it', () => {
    const { clip } = insertAtCommands(trackOf(first, second), incoming, 3000, ids())

    expect(clip).toMatchObject({ sourceId: 'new.mp4', start: 3000 })
  })

  it('does not touch the track it is given', () => {
    const track = trackOf(first, second)
    insertAtCommands(track, incoming, 1000, ids())

    expect(track.clips).toEqual([first, second])
  })
})
