/** The spec for the playback store. */

import { describe, expect, it, vi } from 'vitest'
import { PlaybackStore } from './playback'

function fakeVideo(overrides: Partial<HTMLVideoElement> = {}) {
  return {
    play: vi.fn(async () => {}),
    pause: vi.fn(),
    ...overrides,
  } as unknown as HTMLVideoElement
}

describe('attachment', () => {
  it('reports no media until an element is attached', () => {
    const store = new PlaybackStore()

    expect(store.hasMedia).toBe(false)
    store.attach(fakeVideo())
    expect(store.hasMedia).toBe(true)
  })

  it('stops reporting playback when the element goes away', () => {
    const store = new PlaybackStore()
    store.attach(fakeVideo())
    store.reportPlaying(true)

    store.attach(null)

    expect(store.isPlaying).toBe(false)
    expect(store.hasMedia).toBe(false)
  })
})

describe('commands', () => {
  it('plays and pauses the element', async () => {
    const video = fakeVideo()
    const store = new PlaybackStore()
    store.attach(video)

    await store.play()
    expect(video.play).toHaveBeenCalled()

    store.pause()
    expect(video.pause).toHaveBeenCalled()
  })

  it('does nothing without an element', async () => {
    const store = new PlaybackStore()

    await expect(store.play()).resolves.toBeUndefined()
    expect(() => store.pause()).not.toThrow()
  })

  it('toggle plays when paused and pauses when playing', async () => {
    const video = fakeVideo()
    const store = new PlaybackStore()
    store.attach(video)

    await store.toggle()
    expect(video.play).toHaveBeenCalledTimes(1)

    store.reportPlaying(true)
    await store.toggle()
    expect(video.pause).toHaveBeenCalledTimes(1)
  })

  it('survives play() being rejected by an autoplay policy', async () => {
    const video = fakeVideo({ play: vi.fn().mockRejectedValue(new Error('NotAllowedError')) })
    const store = new PlaybackStore()
    store.attach(video)

    await expect(store.play()).resolves.toBeUndefined()
    // Asking is not the same as happening: the flag only moves on the element's own event.
    expect(store.isPlaying).toBe(false)
  })
})

describe('state', () => {
  it('only changes on a reported event, not on a command', async () => {
    const store = new PlaybackStore()
    store.attach(fakeVideo())

    await store.play()
    expect(store.isPlaying).toBe(false)

    store.reportPlaying(true)
    expect(store.isPlaying).toBe(true)
  })

  it('notifies subscribers when playback starts and stops', () => {
    const store = new PlaybackStore()
    const listener = vi.fn()
    store.subscribe(listener)

    store.reportPlaying(true)
    store.reportPlaying(false)

    expect(listener).toHaveBeenNthCalledWith(1, true)
    expect(listener).toHaveBeenNthCalledWith(2, false)
  })

  it('stays quiet when the state does not change', () => {
    const store = new PlaybackStore()
    const listener = vi.fn()
    store.subscribe(listener)

    store.reportPlaying(false)
    store.reportPlaying(false)

    expect(listener).not.toHaveBeenCalled()
  })

  it('stops notifying after unsubscribe', () => {
    const store = new PlaybackStore()
    const listener = vi.fn()
    store.subscribe(listener)()

    store.reportPlaying(true)

    expect(listener).not.toHaveBeenCalled()
  })
})
