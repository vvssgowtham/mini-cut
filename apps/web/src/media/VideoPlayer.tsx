/**
 * The preview: a video element driven by, and driving, the shared playhead.
 *
 * The tricky part is that the data flows both ways. The video moves the playhead during playback,
 * and scrubbing the timeline moves the video. Wired naively that is a loop — each update provokes the
 * other — so the component tracks the last position it wrote and ignores the echo. Only a position it
 * did not write counts as a seek request.
 */

import { useEffect, useRef } from 'react'
import type { Ms } from '../editor/types'
import type { PlayheadStore } from './playhead'
import { msToSeconds, secondsToMs } from './time'

/** Below this, a difference is the echo of our own update rather than a real seek. */
const SEEK_EPSILON_MS = 60

export type VideoPlayerProps = {
  /** Object URL from `openOpfsAsUrl`, or null before anything is imported. */
  src: string | null
  playhead: PlayheadStore
}

export function VideoPlayer({ src, playhead }: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  /** The last position this component pushed into the store, so its echo can be ignored. */
  const lastPushedRef = useRef<Ms>(-1)

  // Playhead -> video.
  useEffect(() => {
    return playhead.subscribe((ms) => {
      const video = videoRef.current
      if (!video) return
      if (Math.abs(ms - lastPushedRef.current) <= SEEK_EPSILON_MS) return
      const seconds = msToSeconds(ms)
      if (Math.abs(video.currentTime - seconds) * 1000 > SEEK_EPSILON_MS) {
        video.currentTime = seconds
      }
    })
  }, [playhead])

  // Video -> playhead, once per presented frame rather than per timeupdate event, which fires only
  // about four times a second and makes the playhead visibly lag the picture.
  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    // The DOM lib declares this unconditionally, but jsdom and older Safari do not have it, so the
    // check has to be at runtime; the timeupdate fallback below covers those.
    if (typeof video.requestVideoFrameCallback !== 'function') return

    let handle = 0
    let cancelled = false
    const onFrame = (_now: number, metadata: { mediaTime: number }) => {
      if (cancelled) return
      const ms = secondsToMs(metadata.mediaTime)
      lastPushedRef.current = ms
      playhead.set(ms)
      handle = video.requestVideoFrameCallback(onFrame)
    }
    handle = video.requestVideoFrameCallback(onFrame)

    return () => {
      cancelled = true
      video.cancelVideoFrameCallback?.(handle)
    }
  }, [playhead, src])

  const onTimeUpdate = () => {
    const video = videoRef.current
    if (!video || typeof video.requestVideoFrameCallback === 'function') return
    const ms = secondsToMs(video.currentTime)
    lastPushedRef.current = ms
    playhead.set(ms)
  }

  if (!src) {
    return (
      <p className="viewer-empty">
        Import a video to start cutting. It stays on this device — nothing is uploaded.
      </p>
    )
  }

  return <video ref={videoRef} src={src} controls preload="metadata" onTimeUpdate={onTimeUpdate} />
}
