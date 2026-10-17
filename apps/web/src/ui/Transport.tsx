/**
 * Transport: the controls for moving through footage.
 *
 * Frame stepping is the reason this exists rather than leaving it to the video element's own
 * controls. Finding a cut means nudging one frame at a time, and no browser's built-in controls
 * offer that.
 *
 * Every control here is a real button with a label, so the whole transport is reachable by keyboard —
 * the timeline canvas is not, which makes this the only keyboard path to the playhead.
 */

import { useCallback, useSyncExternalStore } from 'react'
import type { Ms } from '../editor/types'
import type { PlaybackStore } from '../media/playback'
import type { PlayheadStore } from '../media/playhead'
import { DISPLAY_FPS } from '../media/timecode'
import { Icon } from './Icons'

const FRAME_MS = Math.round(1000 / DISPLAY_FPS)

export type TransportProps = {
  playhead: PlayheadStore
  playback: PlaybackStore
  /** End of the last clip, so stepping and jumping cannot run past the footage. */
  durationMs: Ms
  disabled?: boolean
}

export function Transport({ playhead, playback, durationMs, disabled }: TransportProps) {
  const isPlaying = useSyncExternalStore(
    useCallback((onChange: () => void) => playback.subscribe(onChange), [playback]),
    useCallback(() => playback.isPlaying, [playback]),
  )

  const step = (deltaMs: Ms) => {
    // Stepping is a scrub, not a seek during playback: stop first so the picture holds still.
    playback.pause()
    playhead.set(Math.min(durationMs, Math.max(0, playhead.ms + deltaMs)))
  }

  return (
    <div className="transport-set" role="group" aria-label="Transport">
      <button
        type="button"
        className="play"
        onClick={() => void playback.toggle()}
        disabled={disabled}
        aria-pressed={isPlaying}
      >
        <Icon name={isPlaying ? 'pause' : 'play'} />
        {isPlaying ? 'Pause' : 'Play'}
      </button>
      <div className="transport-group">
        <button
          type="button"
          onClick={() => playhead.set(0)}
          disabled={disabled}
          title="Go to start (Home)"
        >
          <Icon name="skipStart" />
          Start
        </button>
        <button
          type="button"
          onClick={() => step(-FRAME_MS)}
          disabled={disabled}
          title="Back one frame (left arrow)"
        >
          <Icon name="arrowLeft" />
          &minus;1 frame
        </button>
        <button
          type="button"
          onClick={() => step(FRAME_MS)}
          disabled={disabled}
          title="Forward one frame (right arrow)"
        >
          <Icon name="arrowRight" />
          +1 frame
        </button>
        <button
          type="button"
          onClick={() => playhead.set(durationMs)}
          disabled={disabled}
          title="Go to end (End)"
        >
          <Icon name="skipEnd" />
          End
        </button>
      </div>
    </div>
  )
}
