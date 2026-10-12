/**
 * Play state, shared between the video element and the transport.
 *
 * The same shape as `PlayheadStore`, and for the same reason: the element lives inside the viewer,
 * but the controls that drive it live in the footer, and the space bar drives it from anywhere. A
 * store is the one place all three can meet without threading refs through the tree.
 *
 * The store never assumes a command worked. `play()` can be rejected by the browser's autoplay
 * policy, and the element can stall or end on its own, so the flag is only ever set from the
 * element's own `play`, `pause` and `ended` events. Asking is not the same as happening.
 */

export type PlaybackListener = (isPlaying: boolean) => void

export class PlaybackStore {
  #element: HTMLVideoElement | null = null
  #playing = false
  #listeners = new Set<PlaybackListener>()

  get isPlaying(): boolean {
    return this.#playing
  }

  get hasMedia(): boolean {
    return this.#element !== null
  }

  /** The viewer calls this when its element mounts, and with null when it unmounts. */
  attach(element: HTMLVideoElement | null): void {
    this.#element = element
    if (!element) this.#setPlaying(false)
  }

  /** Called from the element's own events — the only thing that may change the flag. */
  reportPlaying(isPlaying: boolean): void {
    this.#setPlaying(isPlaying)
  }

  async play(): Promise<void> {
    try {
      await this.#element?.play()
    } catch {
      // Autoplay policies reject this when there has been no user gesture. The element stays
      // paused and the flag stays false, which is already true, so there is nothing to undo.
    }
  }

  pause(): void {
    this.#element?.pause()
  }

  async toggle(): Promise<void> {
    if (this.#playing) this.pause()
    else await this.play()
  }

  subscribe(listener: PlaybackListener): () => void {
    this.#listeners.add(listener)
    return () => {
      this.#listeners.delete(listener)
    }
  }

  #setPlaying(next: boolean): void {
    if (next === this.#playing) return
    this.#playing = next
    for (const listener of this.#listeners) listener(next)
  }
}
