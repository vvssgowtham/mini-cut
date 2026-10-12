/**
 * Running an export plan: segments first, then the join, reporting progress and honouring cancel.
 *
 * The ffmpeg instance is injected rather than imported, for two reasons. It keeps ffmpeg.wasm — a
 * multi-megabyte wasm download — out of the main bundle, and it lets the sequencing here be tested
 * against a fake. The sequencing is the part with the bugs in it: progress that goes backwards,
 * a cancel that leaves a half-written file, temporary files that are never cleaned up.
 */

import {
  concatArgs,
  concatListFile,
  segmentArgs,
  segmentFileName,
  type ExportPlan,
} from './exportPlan'

const LIST_FILE = 'concat-list.txt'
const OUTPUT_FILE = 'export.mp4'

/**
 * The slice of the ffmpeg.wasm API this uses. Narrow on purpose: anything wider would be harder to
 * fake, and this is all the export needs.
 */
export type FfmpegLike = {
  exec: (args: string[]) => Promise<unknown>
  writeFile: (name: string, data: Uint8Array | string) => Promise<unknown>
  readFile: (name: string) => Promise<Uint8Array>
  deleteFile: (name: string) => Promise<unknown>
}

export type ExportPhase = 'segment' | 'concat'

export type ExportProgress = {
  phase: ExportPhase
  /** 0 to 1 across the whole export, segments and join together. */
  ratio: number
  /** Which segment is being worked on, 0-based. Equal to the count during the join. */
  segmentIndex: number
  segmentCount: number
}

export type RunExportOptions = {
  onProgress?: (progress: ExportProgress) => void
  signal?: AbortSignal
}

/**
 * The join is roughly this share of the work. Stream-copying the segments together is much cheaper
 * than producing them, so the bar should not sit at 90% for as long as it took to reach it.
 */
const CONCAT_SHARE = 0.1

/**
 * Run the plan and resolve with the finished file.
 *
 * Cancellation is checked between steps rather than during one: ffmpeg.wasm has no way to interrupt a
 * running `exec`, so the honest guarantee is that no *further* work starts and nothing is left behind.
 * Temporary files are removed whether the export succeeds, fails or is cancelled — they live in the
 * wasm filesystem and would otherwise hold their memory for the life of the page.
 */
export async function runExport(
  ffmpeg: FfmpegLike,
  plan: ExportPlan,
  options: RunExportOptions = {},
): Promise<Uint8Array> {
  const { onProgress, signal } = options
  const segmentCount = plan.segments.length
  const written: string[] = []

  const report = (phase: ExportPhase, segmentIndex: number) => {
    const segmentShare = (1 - CONCAT_SHARE) * (segmentIndex / Math.max(1, segmentCount))
    onProgress?.({
      phase,
      segmentIndex,
      segmentCount,
      ratio: phase === 'concat' ? 1 - CONCAT_SHARE + CONCAT_SHARE * segmentIndex : segmentShare,
    })
  }

  try {
    signal?.throwIfAborted()
    report('segment', 0)

    for (const [index, segment] of plan.segments.entries()) {
      signal?.throwIfAborted()
      await ffmpeg.exec(segmentArgs(segment, index))
      written.push(segmentFileName(index))
      report('segment', index + 1)
    }

    signal?.throwIfAborted()
    report('concat', 0)

    await ffmpeg.writeFile(LIST_FILE, concatListFile(segmentCount))
    written.push(LIST_FILE)
    await ffmpeg.exec(concatArgs(LIST_FILE, OUTPUT_FILE))
    written.push(OUTPUT_FILE)

    const output = await ffmpeg.readFile(OUTPUT_FILE)
    report('concat', 1)
    return output
  } finally {
    // Best effort: a failed cleanup must not mask the original error.
    for (const name of written) {
      await ffmpeg.deleteFile(name).catch(() => {})
    }
  }
}
