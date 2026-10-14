/**
 * Turning a timeline into a list of ffmpeg operations.
 *
 * Kept separate from the worker that runs ffmpeg.wasm, because this is where the decisions are and
 * the worker is just plumbing. Two of those decisions are worth stating up front:
 *
 * **Gaps are closed.** A gap between two clips does not become black video; the later clip simply
 * follows the earlier one. That is what a cut-based editor does — "remove the silent parts" means the
 * silence is gone, not replaced by silence — and it is the behaviour M7's agent will rely on. The
 * exported file is therefore as long as the clips, not as long as the timeline.
 *
 * **Copy where possible, re-encode where necessary.** Stream copy is many times faster and lossless,
 * but a copied cut can only start at a keyframe: the decoder needs one to begin from. Cutting
 * mid-GOP by copying produces a smeared or frozen opening, so a clip whose `sourceIn` does not land
 * on a keyframe has to be re-encoded.
 */

import { clipEnd, type Clip, type Ms, type Project } from '../editor/types'
import { msToSeconds } from './time'

/** How far from a keyframe still counts as on it. One frame at 30fps is ~33 ms. */
export const KEYFRAME_TOLERANCE_MS = 40

export type ExportMode = 'copy' | 'reencode'

export type ExportSegment = {
  clipId: string
  sourceId: string
  sourceIn: Ms
  sourceOut: Ms
  durationMs: Ms
  mode: ExportMode
}

export type ExportPlan = {
  segments: ExportSegment[]
  /** Length of the exported file, which is the sum of the clips — gaps are closed. */
  totalMs: Ms
  /** True when nothing needs re-encoding, so the whole export is the fast path. */
  streamCopyOnly: boolean
}

export type PlanOptions = {
  /**
   * Keyframe positions per source, in milliseconds, from `ffprobe`. A source with no entry is
   * treated as unknown and re-encoded: guessing would risk a broken cut, and re-encoding is only slow.
   */
  keyframesBySource?: Readonly<Record<string, readonly Ms[]>>
  toleranceMs?: Ms
}

export class ExportPlanError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ExportPlanError'
  }
}

function isOnKeyframe(keyframes: readonly Ms[] | undefined, ms: Ms, toleranceMs: Ms): boolean {
  if (!keyframes) return false
  return keyframes.some((keyframe) => Math.abs(keyframe - ms) <= toleranceMs)
}

/**
 * Build the plan, or throw `ExportPlanError` if the timeline cannot be exported as-is.
 *
 * Overlapping clips are rejected rather than resolved: an overlap on one track has no single correct
 * reading — it could mean a crossfade, a replacement, or a mistake — and silently picking one would
 * export something the user did not see on the timeline.
 */
export function planExport(project: Project, options: PlanOptions = {}): ExportPlan {
  const { keyframesBySource, toleranceMs = KEYFRAME_TOLERANCE_MS } = options

  const clips: Clip[] = project.tracks.flatMap((track) => track.clips)
  if (clips.length === 0) throw new ExportPlanError('nothing to export: the timeline is empty')

  const ordered = [...clips].sort((a, b) => a.start - b.start)

  for (let i = 1; i < ordered.length; i++) {
    const previous = ordered[i - 1]
    const current = ordered[i]
    if (previous && current && current.start < clipEnd(previous)) {
      const overlapMs = clipEnd(previous) - current.start
      throw new ExportPlanError(
        `Two clips overlap by ${Math.round(overlapMs)}ms on the timeline, and export cannot tell ` +
          `which should be shown. Drag the later clip clear of the earlier one, or delete one of ` +
          `them, then export again.`,
      )
    }
  }

  const segments = ordered.map((clip): ExportSegment => {
    const onKeyframe = isOnKeyframe(keyframesBySource?.[clip.sourceId], clip.sourceIn, toleranceMs)
    return {
      clipId: clip.id,
      sourceId: clip.sourceId,
      sourceIn: clip.sourceIn,
      sourceOut: clip.sourceOut,
      durationMs: clip.sourceOut - clip.sourceIn,
      mode: onKeyframe ? 'copy' : 'reencode',
    }
  })

  return {
    segments,
    totalMs: segments.reduce((sum, segment) => sum + segment.durationMs, 0),
    streamCopyOnly: segments.every((segment) => segment.mode === 'copy'),
  }
}

/** Re-encode settings. veryfast because this runs in wasm, where the slower presets are painful. */
const REENCODE_ARGS = [
  '-c:v',
  'libx264',
  '-preset',
  'veryfast',
  '-crf',
  '20',
  '-c:a',
  'aac',
  '-b:a',
  '128k',
]

export function segmentFileName(index: number): string {
  return `segment-${String(index).padStart(4, '0')}.mp4`
}

/**
 * ffmpeg arguments for one segment.
 *
 * Note where `-ss` goes. Before `-i` it is an input seek: ffmpeg jumps straight to the nearest
 * keyframe, which is fast and is exactly what a copy needs. After `-i` it is an output seek: ffmpeg
 * decodes from the start and discards, which is slower but lands on the exact frame — which is what a
 * re-encoded cut needs to be frame-accurate.
 */
export function segmentArgs(segment: ExportSegment, index: number): string[] {
  const start = String(msToSeconds(segment.sourceIn))
  const duration = String(msToSeconds(segment.durationMs))
  const output = segmentFileName(index)

  if (segment.mode === 'copy') {
    return ['-ss', start, '-i', segment.sourceId, '-t', duration, '-c', 'copy', output]
  }
  return ['-i', segment.sourceId, '-ss', start, '-t', duration, ...REENCODE_ARGS, output]
}

/** The concat demuxer's list file: one `file '<name>'` line per segment, in order. */
export function concatListFile(segmentCount: number): string {
  return (
    Array.from({ length: segmentCount }, (_, i) => `file '${segmentFileName(i)}'`).join('\n') + '\n'
  )
}

/**
 * Arguments for the final join.
 *
 * Always `-c copy`: the segments were made to be compatible with each other, so re-encoding here
 * would be a second generation of loss for no benefit.
 */
export function concatArgs(listFileName: string, outputName: string): string[] {
  return ['-f', 'concat', '-safe', '0', '-i', listFileName, '-c', 'copy', outputName]
}
