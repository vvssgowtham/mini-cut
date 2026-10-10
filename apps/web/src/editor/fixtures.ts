/** Test fixtures and small helpers shared by the editor tests. */

import type { Clip, Project, Track } from './types'

/**
 * Two clips on one track:
 *
 *   timeline:  0 ─────── 2000 ─────── 3000
 *              [   a   ][     b     ]
 *
 * `a` shows source 1000..3000, `b` shows source 5000..6000 of the same file, so the fixture also
 * covers "already trimmed" clips — the case where snapshot-based undo hides bugs.
 */
export function makeProject(): Project {
  return {
    version: 1,
    durationMs: 3000,
    tracks: [
      {
        id: 't1',
        clips: [
          { id: 'a', sourceId: 's1', sourceIn: 1000, sourceOut: 3000, start: 0 },
          { id: 'b', sourceId: 's1', sourceIn: 5000, sourceOut: 6000, start: 2000 },
        ],
      },
    ],
  }
}

export function getTrack(project: Project, trackId: string): Track {
  const track = project.tracks.find((t) => t.id === trackId)
  if (!track) throw new Error(`test fixture: no track ${trackId}`)
  return track
}

export function getClip(project: Project, trackId: string, clipId: string): Clip {
  const clip = getTrack(project, trackId).clips.find((c) => c.id === clipId)
  if (!clip) throw new Error(`test fixture: no clip ${clipId}`)
  return clip
}

export function clipIds(project: Project, trackId: string): string[] {
  return getTrack(project, trackId).clips.map((c) => c.id)
}

/** Freeze recursively, so a mutation anywhere in the project throws in strict mode. */
export function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const key of Object.keys(value)) {
      deepFreeze((value as Record<string, unknown>)[key])
    }
  }
  return value
}
