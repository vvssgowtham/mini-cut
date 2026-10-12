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

import type { Ms } from '../editor/types'
import type { PlayheadStore } from '../media/playhead'
import { DISPLAY_FPS } from '../media/timecode'

const FRAME_MS = Math.round(1000 / DISPLAY_FPS)

export type TransportProps = {
  playhead: PlayheadStore
  /** End of the last clip, so stepping and jumping cannot run past the footage. */
  durationMs: Ms
  disabled?: boolean
}

export function Transport({ playhead, durationMs, disabled }: TransportProps) {
  const step = (deltaMs: Ms) => {
    playhead.set(Math.min(durationMs, Math.max(0, playhead.ms + deltaMs)))
  }

  return (
    <div className="transport-group" role="group" aria-label="Transport">
      <button type="button" onClick={() => playhead.set(0)} disabled={disabled} title="Go to start">
        Start
      </button>
      <button
        type="button"
        onClick={() => step(-FRAME_MS)}
        disabled={disabled}
        title="Back one frame"
      >
        &minus;1 frame
      </button>
      <button
        type="button"
        onClick={() => step(FRAME_MS)}
        disabled={disabled}
        title="Forward one frame"
      >
        +1 frame
      </button>
      <button
        type="button"
        onClick={() => playhead.set(durationMs)}
        disabled={disabled}
        title="Go to end"
      >
        End
      </button>
    </div>
  )
}
