/**
 * Mapping timeline time onto the clip playing at that moment.
 *
 * With one clip the two were interchangeable, and the player simply treated `video.currentTime` as
 * the playhead. With several — especially several from different files — they are not: the timeline
 * is the finished cut, while each clip shows some window of some source. At 30 s on the timeline you
 * might be 4 s into the second file.
 *
 * These are the conversions between the two. Pure, so the player can stay a thin wrapper around a
 * video element instead of carrying the arithmetic as well.
 */

import { clipEnd, type Clip, type Ms } from '../editor/types'

/** Clips in playback order. Storage keeps insertion order, which is not the same thing. */
export function inPlaybackOrder(clips: readonly Clip[]): Clip[] {
  return [...clips].sort((a, b) => a.start - b.start)
}

/**
 * The clip covering `timelineMs`, or null in a gap or past the end.
 *
 * The range is half-open: a clip ending exactly where the next begins hands over cleanly rather
 * than both claiming the boundary.
 */
export function clipAt(clips: readonly Clip[], timelineMs: Ms): Clip | null {
  return (
    inPlaybackOrder(clips).find((clip) => timelineMs >= clip.start && timelineMs < clipEnd(clip)) ??
    null
  )
}

/** Where in the source file a timeline position falls, for a clip known to cover it. */
export function sourceTimeFor(clip: Clip, timelineMs: Ms): Ms {
  return clip.sourceIn + (timelineMs - clip.start)
}

/** The reverse: where a source position sits on the timeline. */
export function timelineTimeFor(clip: Clip, sourceMs: Ms): Ms {
  return clip.start + (sourceMs - clip.sourceIn)
}

/**
 * The next clip to play after this one.
 *
 * By timeline position rather than by index, because a clip moved earlier should play earlier. A gap
 * between them is skipped: the cut is what the clips say, not the empty space between them.
 */
export function nextClipAfter(clips: readonly Clip[], clip: Clip): Clip | null {
  return inPlaybackOrder(clips).find((candidate) => candidate.start >= clipEnd(clip)) ?? null
}

/**
 * Where playback should resume from `timelineMs`.
 *
 * In a gap, playback jumps forward to the next clip rather than waiting out the silence — the gap
 * is not part of the cut, and export closes it too.
 */
export function playbackPositionAt(
  clips: readonly Clip[],
  timelineMs: Ms,
): { clip: Clip; sourceMs: Ms; timelineMs: Ms } | null {
  const covering = clipAt(clips, timelineMs)
  if (covering) {
    return { clip: covering, sourceMs: sourceTimeFor(covering, timelineMs), timelineMs }
  }

  const upcoming = inPlaybackOrder(clips).find((clip) => clip.start > timelineMs)
  if (!upcoming) return null
  return { clip: upcoming, sourceMs: upcoming.sourceIn, timelineMs: upcoming.start }
}

/** End of the whole cut: where the last clip finishes. */
export function timelineEnd(clips: readonly Clip[]): Ms {
  return clips.reduce((end, clip) => Math.max(end, clipEnd(clip)), 0)
}
