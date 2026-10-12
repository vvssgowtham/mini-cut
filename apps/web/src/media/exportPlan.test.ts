/** The spec for the export plan. */

import { describe, expect, it } from 'vitest'
import type { Clip, Project } from '../editor/types'
import {
  ExportPlanError,
  KEYFRAME_TOLERANCE_MS,
  concatArgs,
  concatListFile,
  planExport,
  segmentArgs,
  segmentFileName,
} from './exportPlan'

const clip = (
  id: string,
  start: number,
  sourceIn: number,
  sourceOut: number,
  sourceId = 's1',
): Clip => ({ id, sourceId, sourceIn, sourceOut, start })

const project = (clips: Clip[]): Project => ({
  version: 1,
  durationMs: 60_000,
  tracks: [{ id: 't1', clips }],
})

describe('segments', () => {
  it('rejects an empty timeline', () => {
    expect(() => planExport(project([]))).toThrow(ExportPlanError)
  })

  it('produces one segment per clip', () => {
    const plan = planExport(project([clip('a', 0, 0, 1000), clip('b', 1000, 2000, 3000)]))

    expect(plan.segments.map((s) => s.clipId)).toEqual(['a', 'b'])
  })

  it('orders segments by timeline position, not storage order', () => {
    const plan = planExport(project([clip('b', 5000, 0, 1000), clip('a', 0, 0, 1000)]))

    expect(plan.segments.map((s) => s.clipId)).toEqual(['a', 'b'])
  })

  it('carries the source window, not the timeline position', () => {
    const plan = planExport(project([clip('a', 9000, 2000, 3500)]))

    expect(plan.segments[0]).toMatchObject({ sourceIn: 2000, sourceOut: 3500, durationMs: 1500 })
  })

  it('collects clips from every track', () => {
    const multi: Project = {
      version: 1,
      durationMs: 10_000,
      tracks: [
        { id: 't1', clips: [clip('a', 0, 0, 1000)] },
        { id: 't2', clips: [clip('b', 2000, 0, 1000)] },
      ],
    }

    expect(planExport(multi).segments.map((s) => s.clipId)).toEqual(['a', 'b'])
  })
})

describe('gaps and overlaps', () => {
  it('closes gaps, so the export is as long as the clips', () => {
    // A 4 s gap between two 1 s clips: the result is 2 s, not 6 s.
    const plan = planExport(project([clip('a', 0, 0, 1000), clip('b', 5000, 0, 1000)]))

    expect(plan.totalMs).toBe(2000)
  })

  it('rejects overlapping clips rather than guessing', () => {
    // 'a' runs 0..2000 on the timeline, 'b' starts at 1500.
    const overlapping = project([clip('a', 0, 0, 2000), clip('b', 1500, 0, 1000)])

    expect(() => planExport(overlapping)).toThrow(ExportPlanError)
    expect(() => planExport(overlapping)).toThrow(/overlap/)
  })

  it('allows clips that meet exactly', () => {
    const touching = project([clip('a', 0, 0, 2000), clip('b', 2000, 0, 1000)])

    expect(planExport(touching).segments).toHaveLength(2)
  })
})

describe('copy versus re-encode', () => {
  const keyframesBySource = { s1: [0, 2000, 4000] }

  it('copies a cut that starts on a keyframe', () => {
    const plan = planExport(project([clip('a', 0, 2000, 3000)]), { keyframesBySource })

    expect(plan.segments[0]?.mode).toBe('copy')
    expect(plan.streamCopyOnly).toBe(true)
  })

  it('re-encodes a cut that starts mid-GOP', () => {
    const plan = planExport(project([clip('a', 0, 2500, 3000)]), { keyframesBySource })

    expect(plan.segments[0]?.mode).toBe('reencode')
    expect(plan.streamCopyOnly).toBe(false)
  })

  it('treats a cut within tolerance as on the keyframe', () => {
    const plan = planExport(project([clip('a', 0, 2000 + KEYFRAME_TOLERANCE_MS, 3000)]), {
      keyframesBySource,
    })

    expect(plan.segments[0]?.mode).toBe('copy')
  })

  it('re-encodes just outside the tolerance', () => {
    const plan = planExport(project([clip('a', 0, 2000 + KEYFRAME_TOLERANCE_MS + 1, 3000)]), {
      keyframesBySource,
    })

    expect(plan.segments[0]?.mode).toBe('reencode')
  })

  it('re-encodes when the source has no keyframe data', () => {
    const plan = planExport(project([clip('a', 0, 0, 1000, 'unprobed')]), { keyframesBySource })

    expect(plan.segments[0]?.mode).toBe('reencode')
  })

  it('re-encodes everything when no keyframes are supplied at all', () => {
    const plan = planExport(project([clip('a', 0, 0, 1000)]))

    expect(plan.streamCopyOnly).toBe(false)
  })

  it('mixes modes within one export', () => {
    const plan = planExport(project([clip('a', 0, 2000, 3000), clip('b', 3000, 2500, 3500)]), {
      keyframesBySource,
    })

    expect(plan.segments.map((s) => s.mode)).toEqual(['copy', 'reencode'])
    expect(plan.streamCopyOnly).toBe(false)
  })
})

describe('ffmpeg arguments', () => {
  it('seeks before the input when copying, for a fast keyframe seek', () => {
    const plan = planExport(project([clip('a', 0, 2000, 3000)]), {
      keyframesBySource: { s1: [2000] },
    })
    const args = segmentArgs(plan.segments[0]!, 0)

    expect(args.indexOf('-ss')).toBeLessThan(args.indexOf('-i'))
    expect(args).toContain('copy')
  })

  it('seeks after the input when re-encoding, for a frame-accurate cut', () => {
    const plan = planExport(project([clip('a', 0, 2500, 3000)]))
    const args = segmentArgs(plan.segments[0]!, 0)

    expect(args.indexOf('-ss')).toBeGreaterThan(args.indexOf('-i'))
    expect(args).toContain('libx264')
  })

  it('passes the window as seconds and a duration', () => {
    const plan = planExport(project([clip('a', 0, 2000, 3500)]), {
      keyframesBySource: { s1: [2000] },
    })
    const args = segmentArgs(plan.segments[0]!, 0)

    expect(args[args.indexOf('-ss') + 1]).toBe('2')
    expect(args[args.indexOf('-t') + 1]).toBe('1.5')
  })

  it('names segments so they sort in order', () => {
    expect(segmentFileName(0)).toBe('segment-0000.mp4')
    expect([segmentFileName(10), segmentFileName(2)].sort()).toEqual([
      segmentFileName(2),
      segmentFileName(10),
    ])
  })

  it('writes one concat list line per segment, in order', () => {
    expect(concatListFile(2)).toBe("file 'segment-0000.mp4'\nfile 'segment-0001.mp4'\n")
  })

  it('joins without re-encoding, to avoid a second generation of loss', () => {
    const args = concatArgs('list.txt', 'out.mp4')

    expect(args).toEqual(['-f', 'concat', '-safe', '0', '-i', 'list.txt', '-c', 'copy', 'out.mp4'])
  })
})
