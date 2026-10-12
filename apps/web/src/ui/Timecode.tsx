/**
 * The playhead position, read from the shared store.
 *
 * This is the one place a playhead change is allowed to re-render, because the number itself is the
 * content. Everything else — the canvas marker, the video seek — reads the store directly and stays
 * out of React, so a running playhead re-renders four characters rather than the editor.
 */

import { useCallback, useSyncExternalStore } from 'react'
import type { PlayheadStore } from '../media/playhead'
import { formatTimecode } from '../media/timecode'

export type TimecodeProps = {
  playhead: PlayheadStore
  /** Dimmed until there is media, so an idle editor does not read as a running clock. */
  idle?: boolean
}

export function Timecode({ playhead, idle = false }: TimecodeProps) {
  const ms = useSyncExternalStore(
    useCallback((onChange: () => void) => playhead.subscribe(onChange), [playhead]),
    useCallback(() => playhead.ms, [playhead]),
  )

  return (
    // aria-live="off" because <output> is a live region by default, and this changes every frame
    // during playback — a screen reader would read the timecode aloud continuously.
    <output className="timecode" data-idle={idle} aria-live="off" aria-label="Playhead position">
      {formatTimecode(ms)}
    </output>
  )
}
