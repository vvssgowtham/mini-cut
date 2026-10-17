/**
 * The preview: a video element following the timeline across clips.
 *
 * With one clip, timeline time and `video.currentTime` were interchangeable and this was a thin
 * wrapper. With several — especially several from different files — they are not. The playhead is a
 * position in the finished cut; the element is somewhere inside one source. So the component keeps
 * three things in step:
 *
 * - **Which clip is under the playhead**, which decides the file loaded.
 * - **Where in that file to be**, which is the clip's source window offset by the playhead.
 * - **What to do at a clip boundary**, which during playback means moving to the next clip rather
 *   than running on into footage the cut does not include.
 *
 * Data flows both ways — the video drives the playhead while playing, scrubbing drives the video —
 * so the component tracks the last position it wrote and ignores the echo, or the two would chase
 * each other.
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { clipEnd, type Clip, type Ms } from '../editor/types'
import type { PlaybackStore } from './playback'
import type { PlayheadStore } from './playhead'
import { msToSeconds, secondsToMs } from './time'
import { clipAt, playbackPositionAt, timelineTimeFor } from './timelineMap'

/** Below this, a difference is the echo of our own update rather than a real seek. */
const SEEK_EPSILON_MS = 60

export type VideoPlayerProps = {
  clips: readonly Clip[]
  /** OPFS object URL per source id. A clip whose source is missing cannot be shown. */
  sources: ReadonlyMap<string, string>
  playhead: PlayheadStore
  playback: PlaybackStore
  /** Shown instead of the bare prompt when there are no clips at all. */
  empty?: ReactNode
}

export function VideoPlayer({ clips, sources, playhead, playback, empty }: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const lastPushedRef = useRef<Ms>(-1)
  const clipsRef = useRef(clips)
  /**
   * Whether playback should continue after a source swap.
   *
   * Changing the element's `src` makes it fire `pause`, so by the time the new file's metadata
   * arrives the store already reports "not playing" — and reading it there would stop the cut dead
   * at every clip boundary. The intent has to be captured before the swap, not inferred after it.
   */
  const resumeAfterSwapRef = useRef(false)

  /** The file the element should be showing; null until something is asked for. */
  const [requestedSourceId, setRequestedSourceId] = useState<string | null>(null)

  // Derived during render rather than set from an effect: an effect would need a second render to
  // show the first import, and falling back here costs nothing.
  //
  // The fallback follows the playhead rather than defaulting to the first clip. Mounting with the
  // playhead already inside a later clip — after a restore, or any remount mid-session — would
  // otherwise load the wrong file and show the wrong picture until something moved.
  const activeSourceId =
    requestedSourceId && sources.has(requestedSourceId)
      ? requestedSourceId
      : (playbackPositionAt(clips, playhead.ms)?.clip.sourceId ?? clips[0]?.sourceId ?? null)
  const src = activeSourceId ? (sources.get(activeSourceId) ?? null) : null

  useEffect(() => {
    clipsRef.current = clips
  }, [clips])

  /** Put the element on whatever clip covers `timelineMs`, loading another file if needed. */
  /**
   * `resume` says whether to carry on playing after a source swap.
   *
   * It is a parameter rather than a reading of `playback.isPlaying`, because the one caller that
   * most needs to resume is the one that cannot trust that flag: a video reaching its end fires
   * `pause` as well as `ended`, so by the time the handler runs the store already says "not
   * playing" and the next clip would load and sit there.
   */
  const seekTo = useCallback(
    (timelineMs: Ms, resume: boolean = playback.isPlaying) => {
      const position = playbackPositionAt(clipsRef.current, timelineMs)
      if (!position) return

      if (position.clip.sourceId !== activeSourceId) {
        // The element reloads on the new src; loadedmetadata lands it on the right frame.
        resumeAfterSwapRef.current = resume
        setRequestedSourceId(position.clip.sourceId)
        return
      }

      const video = videoRef.current
      if (!video) return
      const seconds = msToSeconds(position.sourceMs)
      if (Math.abs(video.currentTime - seconds) * 1000 > SEEK_EPSILON_MS) {
        video.currentTime = seconds
      }
    },
    [activeSourceId, playback],
  )

  /** Source position to timeline position, crossing into the next clip at the boundary. */
  const advance = useCallback(
    (sourceMs: Ms) => {
      const current = clipAt(clipsRef.current, playhead.ms)

      // No clip under the playhead: it is sitting in a gap, or past the end of the cut. The element
      // will happily keep playing its own file either way, showing footage the cut does not include
      // while the playhead stays put — so jump to whatever comes next, or stop.
      if (!current) {
        const next = playbackPositionAt(clipsRef.current, playhead.ms)
        if (!next) {
          playback.pause()
          return
        }
        lastPushedRef.current = -1
        playhead.set(next.timelineMs)
        seekTo(next.timelineMs, true)
        return
      }

      // Still on the previous file, which is normal for the moment a source swap takes.
      if (current.sourceId !== activeSourceId) return

      if (sourceMs >= current.sourceOut) {
        // Past this clip's out point: the cut either continues elsewhere or ends here.
        const next = playbackPositionAt(clipsRef.current, clipEnd(current))
        if (!next) {
          playback.pause()
          return
        }
        lastPushedRef.current = -1
        playhead.set(next.timelineMs)
        seekTo(next.timelineMs, true)
        return
      }

      const timelineMs = timelineTimeFor(current, sourceMs)
      lastPushedRef.current = timelineMs
      playhead.set(timelineMs)
    },
    [activeSourceId, playback, playhead, seekTo],
  )

  useEffect(() => {
    playback.attach(videoRef.current)
    return () => playback.attach(null)
  }, [playback, src])

  // Playhead to video, for scrubbing and the transport.
  useEffect(() => {
    return playhead.subscribe((ms) => {
      if (Math.abs(ms - lastPushedRef.current) <= SEEK_EPSILON_MS) return
      seekTo(ms)
    })
  }, [playhead, seekTo])

  // Video to playhead, once per presented frame. `timeupdate` fires about four times a second,
  // which makes the playhead visibly lag the picture.
  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    // The DOM lib declares this unconditionally, but jsdom and older Safari do not have it.
    if (typeof video.requestVideoFrameCallback !== 'function') return

    let handle = 0
    let cancelled = false

    const onFrame = (_now: number, metadata: { mediaTime: number }) => {
      if (cancelled) return
      advance(secondsToMs(metadata.mediaTime))
      handle = video.requestVideoFrameCallback(onFrame)
    }
    handle = video.requestVideoFrameCallback(onFrame)

    return () => {
      cancelled = true
      video.cancelVideoFrameCallback?.(handle)
    }
  }, [advance, src])

  /** After a source swap the element starts at zero, so put it on the right frame. */
  const handleLoadedMetadata = () => {
    const position = playbackPositionAt(clipsRef.current, playhead.ms)
    const video = videoRef.current
    if (!position || !video || position.clip.sourceId !== activeSourceId) return

    video.currentTime = msToSeconds(position.sourceMs)

    if (resumeAfterSwapRef.current) {
      resumeAfterSwapRef.current = false
      void playback.play()
    }
  }

  /**
   * The element reaching the end of its own file is not the cut ending.
   *
   * A clip's out point very often sits at the end of its source — the last clip of a split, or an
   * untrimmed import — and at that moment the browser stops presenting frames, so the frame
   * callback that normally drives the crossing never fires again. Playback simply stopped at the
   * join. Continuing has to be driven from this event instead.
   */
  const handleEnded = () => {
    const current = clipAt(clipsRef.current, playhead.ms)
    const next = current ? playbackPositionAt(clipsRef.current, clipEnd(current)) : null

    if (!next) {
      playback.reportPlaying(false)
      return
    }

    lastPushedRef.current = -1
    playhead.set(next.timelineMs)
    // Always resuming: `ended` only fires because something was playing, whatever the store says
    // about it by now.
    seekTo(next.timelineMs, true)

    // A different file resumes once its metadata arrives; the same file has nothing to wait for,
    // because `ended` leaves the element paused either way.
    if (next.clip.sourceId === activeSourceId) void playback.play()
  }

  const handleTimeUpdate = () => {
    const video = videoRef.current
    if (!video || typeof video.requestVideoFrameCallback === 'function') return
    advance(secondsToMs(video.currentTime))
  }

  if (!src && clips.length === 0 && empty) return <>{empty}</>

  if (!src) {
    // Two different situations, and conflating them is how a clip with missing media came to look
    // like an empty project: one is an invitation, the other is a fault.
    return (
      <p className="viewer-empty" role={clips.length > 0 ? 'alert' : undefined}>
        {clips.length > 0
          ? 'This clip\u2019s media could not be opened. It may have been cleared from this ' +
            'browser\u2019s storage — import the file again to restore it.'
          : 'Import a video to start cutting. It stays on this device \u2014 nothing is uploaded.'}
      </p>
    )
  }

  return (
    // No `controls`: the browser's own bar is a wide grey slab that fights everything around it,
    // and the transport plus the timeline already cover play, step and scrub.
    <video
      ref={videoRef}
      src={src}
      preload="metadata"
      onLoadedMetadata={handleLoadedMetadata}
      onTimeUpdate={handleTimeUpdate}
      onPlay={() => playback.reportPlaying(true)}
      onPause={() => playback.reportPlaying(false)}
      onEnded={handleEnded}
      onClick={() => void playback.toggle()}
    />
  )
}
