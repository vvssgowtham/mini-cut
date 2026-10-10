/**
 * The timeline data model.
 *
 * Time unit: integer milliseconds, everywhere. `video.currentTime` is float seconds, so convert at
 * the edges with `Math.round(seconds * 1000)`. Milliseconds (rather than frames) survive
 * variable-frame-rate phone video, which has no single fps to count in.
 */

/** Milliseconds. An alias, not a branded type: it documents intent without adding ceremony. */
export type Ms = number

/**
 * One clip on a track.
 *
 * `sourceIn`/`sourceOut` are a window into the source media. `start` is where that window is placed
 * on the timeline. The clip therefore occupies `[start, start + (sourceOut - sourceIn))`.
 */
export type Clip = {
  id: string
  /** Which media file this clip shows. Resolved to a real file in M2. */
  sourceId: string
  sourceIn: Ms
  sourceOut: Ms
  start: Ms
}

/**
 * A track holds clips in insertion order, NOT sorted by `start`. Keeping insertion order means the
 * undo of a delete can put the clip back at the exact index it came from. M3 sorts a copy when it
 * draws.
 */
export type Track = {
  id: string
  clips: Clip[]
}

export type Project = {
  /** Schema version. M5 reads this to migrate an autosave written by an older build. */
  version: 1
  /** Length of the timeline. Set when media loads (M2); no M1 command changes it. */
  durationMs: Ms
  tracks: Track[]
}

/** End of a clip on the timeline (exclusive). */
export function clipEnd(clip: Clip): Ms {
  return clip.start + (clip.sourceOut - clip.sourceIn)
}
