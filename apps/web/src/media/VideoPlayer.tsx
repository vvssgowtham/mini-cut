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

import { useCallback, useEffect, useRef, useState } from 'react'
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
}

export function VideoPlayer({ clips, sources, playhead, playback }: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const lastPushedRef = useRef<Ms>(-1)
  const clipsRef = useRef(clips)

  /** The file the element should be showing; null until something is asked for. */
  const [requestedSourceId, setRequestedSourceId] = useState<string | null>(null)

  // Derived during render rather than set from an effect: an effect would need a second render to
  // show the first import, and falling back here costs nothing.
  const activeSourceId =
    requestedSourceId && sources.has(requestedSourceId)
      ? requestedSourceId
      : (clips[0]?.sourceId ?? null)
  const src = activeSourceId ? (sources.get(activeSourceId) ?? null) : null

  useEffect(() => {
    clipsRef.current = clips
  }, [clips])

  /** Put the element on whatever clip covers `timelineMs`, loading another file if needed. */
  const seekTo = useCallback(
    (timelineMs: Ms) => {
      const position = playbackPositionAt(clipsRef.current, timelineMs)
      if (!position) return

      if (position.clip.sourceId !== activeSourceId) {
        // The element reloads on the new src; loadedmetadata lands it on the right frame.
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
    [activeSourceId],
  )

  /** Source position to timeline position, crossing into the next clip at the boundary. */
  const advance = useCallback(
    (sourceMs: Ms) => {
      const current = clipAt(clipsRef.current, playhead.ms)
      if (!current || current.sourceId !== activeSourceId) return

      if (sourceMs >= current.sourceOut) {
        // Past this clip's out point: the cut either continues elsewhere or ends here.
        const next = playbackPositionAt(clipsRef.current, clipEnd(current))
        if (!next) {
          playback.pause()
          return
        }
        lastPushedRef.current = -1
        playhead.set(next.timelineMs)
        seekTo(next.timelineMs)
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
    if (playback.isPlaying) void playback.play()
  }

  const handleTimeUpdate = () => {
    const video = videoRef.current
    if (!video || typeof video.requestVideoFrameCallback === 'function') return
    advance(secondsToMs(video.currentTime))
  }

  if (!src) {
    return (
      <p className="viewer-empty">
        Import a video to start cutting. It stays on this device — nothing is uploaded.
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
      onEnded={() => playback.reportPlaying(false)}
      onClick={() => void playback.toggle()}
    />
  )
}
