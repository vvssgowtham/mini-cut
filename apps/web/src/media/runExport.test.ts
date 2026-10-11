/** The spec for running an export, driven by a fake ffmpeg. */

import { describe, expect, it, vi } from 'vitest'
import type { Project } from '../editor/types'
import { planExport } from './exportPlan'
import { runExport, type ExportProgress, type FfmpegLike } from './runExport'

const project = (clipCount: number): Project => ({
  version: 1,
  durationMs: 60_000,
  tracks: [
    {
      id: 't1',
      clips: Array.from({ length: clipCount }, (_, i) => ({
        id: `c${i}`,
        sourceId: 's1',
        sourceIn: 0,
        sourceOut: 1000,
        start: i * 1000,
      })),
    },
  ],
})

/** Records every call in order, so the sequencing can be asserted. */
function fakeFfmpeg(overrides: Partial<FfmpegLike> = {}) {
  const calls: string[] = []
  const ffmpeg: FfmpegLike = {
    exec: vi.fn(async (args: string[]) => {
      calls.push(`exec ${args[args.length - 1]}`)
    }),
    writeFile: vi.fn(async (name: string) => {
      calls.push(`write ${name}`)
    }),
    readFile: vi.fn(async (name: string) => {
      calls.push(`read ${name}`)
      return new Uint8Array([1, 2, 3])
    }),
    deleteFile: vi.fn(async (name: string) => {
      calls.push(`delete ${name}`)
    }),
    ...overrides,
  }
  return { ffmpeg, calls }
}

describe('sequencing', () => {
  it('encodes every segment, then joins, then reads the result', async () => {
    const { ffmpeg, calls } = fakeFfmpeg()

    await runExport(ffmpeg, planExport(project(2)))

    expect(calls.slice(0, 5)).toEqual([
      'exec segment-0000.mp4',
      'exec segment-0001.mp4',
      'write concat-list.txt',
      'exec export.mp4',
      'read export.mp4',
    ])
  })

  it('returns the finished file', async () => {
    const { ffmpeg } = fakeFfmpeg()

    const output = await runExport(ffmpeg, planExport(project(1)))

    expect(output).toEqual(new Uint8Array([1, 2, 3]))
  })

  it('handles a single-clip export', async () => {
    const { ffmpeg, calls } = fakeFfmpeg()

    await runExport(ffmpeg, planExport(project(1)))

    expect(calls.filter((c) => c.startsWith('exec segment'))).toHaveLength(1)
  })
})

describe('cleanup', () => {
  it('removes every temporary file it wrote', async () => {
    const { ffmpeg, calls } = fakeFfmpeg()

    await runExport(ffmpeg, planExport(project(2)))

    expect(calls.filter((c) => c.startsWith('delete'))).toEqual([
      'delete segment-0000.mp4',
      'delete segment-0001.mp4',
      'delete concat-list.txt',
      'delete export.mp4',
    ])
  })

  it('cleans up the segments it had already written when a later one fails', async () => {
    let execCount = 0
    const { ffmpeg, calls } = fakeFfmpeg({
      exec: vi.fn(async () => {
        execCount += 1
        if (execCount === 2) throw new Error('encode failed')
      }),
    })

    await expect(runExport(ffmpeg, planExport(project(3)))).rejects.toThrow('encode failed')
    expect(calls).toContain('delete segment-0000.mp4')
  })

  it('does not let a cleanup failure mask the real error', async () => {
    const { ffmpeg } = fakeFfmpeg({
      exec: vi.fn(async () => {
        throw new Error('encode failed')
      }),
      deleteFile: vi.fn(async () => {
        throw new Error('delete failed')
      }),
    })

    await expect(runExport(ffmpeg, planExport(project(1)))).rejects.toThrow('encode failed')
  })
})

describe('cancellation', () => {
  it('rejects before doing any work when already aborted', async () => {
    const { ffmpeg } = fakeFfmpeg()
    const controller = new AbortController()
    controller.abort()

    await expect(
      runExport(ffmpeg, planExport(project(2)), { signal: controller.signal }),
    ).rejects.toThrow()
    expect(ffmpeg.exec).not.toHaveBeenCalled()
  })

  it('stops starting new segments once aborted mid-run', async () => {
    const controller = new AbortController()
    const { ffmpeg } = fakeFfmpeg({
      exec: vi.fn(async () => {
        controller.abort()
      }),
    })

    await expect(
      runExport(ffmpeg, planExport(project(5)), { signal: controller.signal }),
    ).rejects.toThrow()
    // The one that was already running finished; nothing further started.
    expect(ffmpeg.exec).toHaveBeenCalledTimes(1)
  })

  it('still cleans up what it wrote before the abort', async () => {
    const controller = new AbortController()
    const { ffmpeg, calls } = fakeFfmpeg({
      exec: vi.fn(async () => {
        controller.abort()
      }),
    })

    await expect(
      runExport(ffmpeg, planExport(project(3)), { signal: controller.signal }),
    ).rejects.toThrow()
    expect(calls).toContain('delete segment-0000.mp4')
  })
})

describe('progress', () => {
  it('starts at zero and ends at one', async () => {
    const seen: ExportProgress[] = []
    const { ffmpeg } = fakeFfmpeg()

    await runExport(ffmpeg, planExport(project(3)), { onProgress: (p) => seen.push(p) })

    expect(seen[0]?.ratio).toBe(0)
    expect(seen[seen.length - 1]?.ratio).toBe(1)
  })

  it('never goes backwards', async () => {
    const seen: number[] = []
    const { ffmpeg } = fakeFfmpeg()

    await runExport(ffmpeg, planExport(project(4)), { onProgress: (p) => seen.push(p.ratio) })

    for (let i = 1; i < seen.length; i++) {
      expect(seen[i]!).toBeGreaterThanOrEqual(seen[i - 1]!)
    }
  })

  it('reports which segment it is on', async () => {
    const seen: ExportProgress[] = []
    const { ffmpeg } = fakeFfmpeg()

    await runExport(ffmpeg, planExport(project(2)), { onProgress: (p) => seen.push(p) })

    expect(seen.filter((p) => p.phase === 'segment').map((p) => p.segmentIndex)).toEqual([0, 1, 2])
    expect(seen.every((p) => p.segmentCount === 2)).toBe(true)
  })

  it('leaves room for the join rather than sitting at 100% during it', async () => {
    const seen: ExportProgress[] = []
    const { ffmpeg } = fakeFfmpeg()

    await runExport(ffmpeg, planExport(project(2)), { onProgress: (p) => seen.push(p) })

    const lastSegment = seen.filter((p) => p.phase === 'segment').at(-1)
    expect(lastSegment?.ratio).toBeLessThan(1)
  })
})
