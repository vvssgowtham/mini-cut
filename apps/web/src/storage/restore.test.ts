/** The spec for parsing a stored project. */

import { describe, expect, it } from 'vitest'
import type { Project } from '../editor/types'
import { RestoreError, parseStoredProject, parseStoredProjectOr } from './restore'

const valid: Project = {
  version: 1,
  durationMs: 5000,
  tracks: [
    {
      id: 't1',
      clips: [{ id: 'a', sourceId: 's1', sourceIn: 0, sourceOut: 3000, start: 0 }],
    },
  ],
}

const empty: Project = { version: 1, durationMs: 0, tracks: [] }

/** Round-tripped through JSON, as IndexedDB structured-clones and a real save would. */
const stored = (project: unknown) => JSON.parse(JSON.stringify(project)) as unknown

describe('valid projects', () => {
  it('accepts a project and returns it', () => {
    expect(parseStoredProject(stored(valid))).toEqual(valid)
  })

  it('accepts a project with no tracks', () => {
    expect(parseStoredProject(stored(empty))).toEqual(empty)
  })

  it('accepts a track with no clips', () => {
    const project = { ...valid, tracks: [{ id: 't1', clips: [] }] }
    expect(parseStoredProject(stored(project))).toEqual(project)
  })
})

describe('malformed input', () => {
  const cases: [string, unknown][] = [
    ['null', null],
    ['undefined', undefined],
    ['a string', 'project'],
    ['an array', []],
    ['an empty object', {}],
    ['a missing version', { durationMs: 0, tracks: [] }],
    ['a missing tracks array', { version: 1, durationMs: 0 }],
    ['a negative duration', { version: 1, durationMs: -1, tracks: [] }],
    ['a fractional duration', { version: 1, durationMs: 1.5, tracks: [] }],
  ]

  for (const [label, input] of cases) {
    it(`rejects ${label}`, () => {
      expect(() => parseStoredProject(input)).toThrow(RestoreError)
    })
  }

  it('reports malformed input as such', () => {
    try {
      parseStoredProject({})
      expect.unreachable('should have thrown')
    } catch (error) {
      expect((error as RestoreError).reason).toBe('malformed')
    }
  })
})

describe('clip validation', () => {
  const withClip = (clip: unknown) => ({ ...valid, tracks: [{ id: 't1', clips: [clip] }] })

  it('rejects a clip whose window is inverted', () => {
    const clip = { id: 'a', sourceId: 's1', sourceIn: 3000, sourceOut: 1000, start: 0 }
    expect(() => parseStoredProject(withClip(clip))).toThrow(RestoreError)
  })

  it('rejects a zero-length clip', () => {
    const clip = { id: 'a', sourceId: 's1', sourceIn: 1000, sourceOut: 1000, start: 0 }
    expect(() => parseStoredProject(withClip(clip))).toThrow(RestoreError)
  })

  it('rejects a negative start', () => {
    const clip = { id: 'a', sourceId: 's1', sourceIn: 0, sourceOut: 1000, start: -1 }
    expect(() => parseStoredProject(withClip(clip))).toThrow(RestoreError)
  })

  it('rejects an empty id', () => {
    const clip = { id: '', sourceId: 's1', sourceIn: 0, sourceOut: 1000, start: 0 }
    expect(() => parseStoredProject(withClip(clip))).toThrow(RestoreError)
  })
})

describe('version handling', () => {
  it('reports a newer version separately from junk', () => {
    try {
      parseStoredProject({ ...valid, version: 2 })
      expect.unreachable('should have thrown')
    } catch (error) {
      expect((error as RestoreError).reason).toBe('too-new')
      expect((error as Error).message).toMatch(/newer version/)
    }
  })

  it('treats a version below the current one as malformed until a migration exists', () => {
    try {
      parseStoredProject({ ...valid, version: 0 })
      expect.unreachable('should have thrown')
    } catch (error) {
      expect((error as RestoreError).reason).toBe('malformed')
    }
  })
})

describe('parseStoredProjectOr', () => {
  it('returns the parsed project when it is valid', () => {
    expect(parseStoredProjectOr(stored(valid), empty)).toEqual(valid)
  })

  it('falls back when the value is junk', () => {
    expect(parseStoredProjectOr('nonsense', empty)).toEqual(empty)
  })

  it('still throws for a newer version, rather than silently replacing the work', () => {
    expect(() => parseStoredProjectOr({ ...valid, version: 99 }, empty)).toThrow(RestoreError)
  })
})
