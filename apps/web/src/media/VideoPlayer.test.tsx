/**
 * Regression tests for playback across a clip boundary.
 *
 * These exist because the cut stopped dead at every join. Changing the element's `src` makes it fire
 * `pause`, so the store already said "not playing" by the time the new file's metadata arrived, and
 * the code that was meant to resume read that and did nothing. The intent to keep playing has to be
 * captured before the swap, which is not something the pure helpers can check.
 */

import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Clip } from '../editor/types'
import { PlaybackStore } from './playback'
import { PlayheadStore } from './playhead'
import { VideoPlayer } from './VideoPlayer'

/** Two clips, each from a different file, meeting at 3000 ms. */
const first: Clip = { id: 'a', sourceId: 'one.mp4', sourceIn: 0, sourceOut: 3000, start: 0 }
const second: Clip = { id: 'b', sourceId: 'two.mp4', sourceIn: 0, sourceOut: 2000, start: 3000 }

const sources = new Map([
  ['one.mp4', 'blob:one'],
  ['two.mp4', 'blob:two'],
])

let play: ReturnType<typeof vi.fn<() => Promise<void>>>

beforeEach(() => {
  play = vi.fn<() => Promise<void>>(async () => {})
  // jsdom implements neither, and leaves requestVideoFrameCallback out entirely — so the component
  // falls back to timeupdate, which is what these tests drive.
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(play)
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

function setup(playheadMs = 0) {
  const playhead = new PlayheadStore(playheadMs)
  const playback = new PlaybackStore()
  render(
    <VideoPlayer
      clips={[first, second]}
      sources={sources}
      playhead={playhead}
      playback={playback}
    />,
  )
  const video = document.querySelector('video')
  if (!video) throw new Error('no video element rendered')
  return { playhead, playback, video }
}

/** jsdom never advances currentTime on its own, so the test says where the element is. */
function atSourceTime(video: HTMLVideoElement, seconds: number) {
  Object.defineProperty(video, 'currentTime', {
    value: seconds,
    writable: true,
    configurable: true,
  })
  fireEvent.timeUpdate(video)
}

describe('source selection', () => {
  it('shows the first clip to begin with', () => {
    const { video } = setup()

    expect(video.getAttribute('src')).toBe('blob:one')
  })

  it('swaps to the other file when the playhead crosses into the next clip', () => {
    const { playhead, video } = setup()

    // act() so React flushes the source swap before the element is read.
    act(() => playhead.set(3500))

    expect(video.getAttribute('src')).toBe('blob:two')
  })

  it('stays on the same file while the playhead moves within a clip', () => {
    const { playhead, video } = setup()

    act(() => playhead.set(1500))

    expect(video.getAttribute('src')).toBe('blob:one')
  })
})

describe('playback across a clip boundary', () => {
  it('keeps playing after swapping to the next file', () => {
    const { playback, video } = setup()
    playback.reportPlaying(true)

    // Run past the first clip's out point: the component should move to the second clip.
    atSourceTime(video, 3.0)
    expect(video.getAttribute('src')).toBe('blob:two')

    play.mockClear()
    fireEvent.loadedMetadata(video)

    expect(play).toHaveBeenCalled()
  })

  it('does not start playing after a swap made while paused', () => {
    const { playhead, video } = setup()

    // Scrubbing into the next clip is not a reason to start playback.
    act(() => playhead.set(3500))
    play.mockClear()
    fireEvent.loadedMetadata(video)

    expect(play).not.toHaveBeenCalled()
  })

  it('jumps forward out of a gap rather than playing footage the cut excludes', () => {
    // Clips meet at 3000; make a gap by starting the second at 4000.
    const playhead = new PlayheadStore(3500)
    const playback = new PlaybackStore()
    render(
      <VideoPlayer
        clips={[first, { ...second, start: 4000 }]}
        sources={sources}
        playhead={playhead}
        playback={playback}
      />,
    )
    const video = document.querySelector('video')
    if (!video) throw new Error('no video element rendered')
    playback.reportPlaying(true)

    act(() => atSourceTime(video, 1.0))

    // Moved to where the next clip actually begins instead of leaving the playhead stranded.
    expect(playhead.ms).toBe(4000)
  })

  it('stops at the end of the last clip rather than running on', () => {
    const { playback, video } = setup(3000)
    playback.reportPlaying(true)
    const pause = vi.spyOn(playback, 'pause')

    // The element is past the final clip's out point and there is nothing after it.
    atSourceTime(video, 2.0)

    expect(pause).toHaveBeenCalled()
  })
})
