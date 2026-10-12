/** The spec for the playhead store. */

import { describe, expect, it, vi } from 'vitest'
import { PlayheadStore } from './playhead'

describe('value', () => {
  it('starts at zero by default', () => {
    expect(new PlayheadStore().ms).toBe(0)
  })

  it('takes an initial position', () => {
    expect(new PlayheadStore(1500).ms).toBe(1500)
  })

  it('clamps a negative position to zero', () => {
    expect(new PlayheadStore(-100).ms).toBe(0)

    const store = new PlayheadStore(500)
    store.set(-1)
    expect(store.ms).toBe(0)
  })

  it('rounds fractions, since video.currentTime is float seconds', () => {
    const store = new PlayheadStore()
    store.set(1500.6)

    expect(store.ms).toBe(1501)
  })
})

describe('notification', () => {
  it('notifies subscribers with the new position', () => {
    const store = new PlayheadStore()
    const listener = vi.fn()
    store.subscribe(listener)

    store.set(2000)

    expect(listener).toHaveBeenCalledWith(2000)
  })

  it('notifies every subscriber', () => {
    const store = new PlayheadStore()
    const a = vi.fn()
    const b = vi.fn()
    store.subscribe(a)
    store.subscribe(b)

    store.set(100)

    expect(a).toHaveBeenCalledTimes(1)
    expect(b).toHaveBeenCalledTimes(1)
  })

  it('stays quiet when the value does not change', () => {
    const store = new PlayheadStore(1000)
    const listener = vi.fn()
    store.subscribe(listener)

    store.set(1000)
    // Same millisecond twice: common during playback, and not worth a frame.
    store.set(1000.4)

    expect(listener).not.toHaveBeenCalled()
  })

  it('stops notifying after unsubscribe', () => {
    const store = new PlayheadStore()
    const listener = vi.fn()
    const unsubscribe = store.subscribe(listener)

    store.set(100)
    unsubscribe()
    store.set(200)

    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('unsubscribing one listener leaves the others alone', () => {
    const store = new PlayheadStore()
    const kept = vi.fn()
    const dropped = vi.fn()
    store.subscribe(kept)
    store.subscribe(dropped)()

    store.set(100)

    expect(kept).toHaveBeenCalledTimes(1)
    expect(dropped).not.toHaveBeenCalled()
  })
})
