/**
 * Where the playhead is, shared between the video element and the timeline.
 *
 * It cannot live in React state: during playback it changes every frame, and a state update per
 * frame would re-render the tree sixty times a second (see `docs/ARCHITECTURE.md`). It cannot live
 * inside the Timeline either, now that the player needs to read and write it too.
 *
 * So: a tiny store the components share. The timeline redraws from it on its own animation frame and
 * the player seeks from it, neither going through React. A component that genuinely wants to re-render
 * on it — a time readout — can subscribe through `useSyncExternalStore`.
 */

import type { Ms } from '../editor/types'

export type PlayheadListener = (ms: Ms) => void

export class PlayheadStore {
  #ms: Ms = 0
  #listeners = new Set<PlayheadListener>()

  constructor(initialMs: Ms = 0) {
    this.#ms = Math.max(0, Math.round(initialMs))
  }

  get ms(): Ms {
    return this.#ms
  }

  /**
   * Move the playhead. Negative values clamp to zero and fractions round, because this is fed by
   * `video.currentTime` and by pixel arithmetic, both of which produce neither.
   *
   * Setting the value it already holds notifies nobody: during playback the same millisecond can
   * arrive several times, and waking every listener for it would waste the frame.
   */
  set(ms: Ms): void {
    const next = Math.max(0, Math.round(ms))
    if (next === this.#ms) return
    this.#ms = next
    for (const listener of this.#listeners) listener(next)
  }

  subscribe(listener: PlayheadListener): () => void {
    this.#listeners.add(listener)
    return () => {
      this.#listeners.delete(listener)
    }
  }
}
