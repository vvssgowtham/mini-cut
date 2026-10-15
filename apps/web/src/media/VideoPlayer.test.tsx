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

describe('playing straight through a boundary', () => {
  /** Drives the element the way playback does: report a source time, let the component react. */
  function advanceTo(video: HTMLVideoElement, seconds: number) {
    Object.defineProperty(video, 'currentTime', {
      value: seconds,
      writable: true,
      configurable: true,
    })
    fireEvent.timeUpdate(video)
  }

  it('carries on into the next clip instead of stopping at the join', () => {
    const playhead = new PlayheadStore()
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
    playback.reportPlaying(true)

    // Run the first clip out: it shows source 0..3000.
    act(() => advanceTo(video, 3.0))

    // The element should now be on the second file, and the playhead inside the second clip.
    expect(video.getAttribute('src')).toBe('blob:two')
    act(() => fireEvent.loadedMetadata(video))

    expect(playhead.ms).toBeGreaterThanOrEqual(second.start)
  })

  it('keeps reporting position once the second clip is playing', () => {
    const playhead = new PlayheadStore()
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
    playback.reportPlaying(true)

    act(() => advanceTo(video, 3.0))
    act(() => fireEvent.loadedMetadata(video))

    // A second into the second clip: the playhead must track it, not sit at the join.
    act(() => advanceTo(video, 1.0))

    expect(playhead.ms).toBe(second.start + 1000)
  })
})

describe('when a clip has no media loaded', () => {
  function advanceTo(video: HTMLVideoElement, seconds: number) {
    Object.defineProperty(video, 'currentTime', {
      value: seconds,
      writable: true,
      configurable: true,
    })
    fireEvent.timeUpdate(video)
  }

  it('says the media is missing rather than showing the empty-project prompt', () => {
    // Only the first clip's media is available — the second never opened.
    const partial = new Map([['one.mp4', 'blob:one']])
    const playhead = new PlayheadStore()
    const playback = new PlaybackStore()
    render(
      <VideoPlayer
        clips={[first, second]}
        sources={partial}
        playhead={playhead}
        playback={playback}
      />,
    )
    const video = document.querySelector('video')
    if (!video) throw new Error('no video element rendered')
    playback.reportPlaying(true)

    act(() => advanceTo(video, 3.0))

    // Playback stops because there is nothing to play, and the viewer explains why rather than
    // inviting an import as though the project were empty.
    expect(playback.isPlaying).toBe(false)
    expect(document.body.textContent).toMatch(/media could not be opened/i)
  })
})

describe('a split clip followed by a second import', () => {
  /** Exactly the reported case: a three minute video cut at ten seconds, then another appended. */
  const splitA: Clip = { id: 'a', sourceId: 'one.mp4', sourceIn: 0, sourceOut: 10_000, start: 0 }
  const splitB: Clip = {
    id: 'b',
    sourceId: 'one.mp4',
    sourceIn: 10_000,
    sourceOut: 180_000,
    start: 10_000,
  }
  const appended: Clip = {
    id: 'c',
    sourceId: 'two.mp4',
    sourceIn: 0,
    sourceOut: 20_000,
    start: 180_000,
  }

  function setupThree(startMs = 0) {
    const playhead = new PlayheadStore(startMs)
    const playback = new PlaybackStore()
    render(
      <VideoPlayer
        clips={[splitA, splitB, appended]}
        sources={sources}
        playhead={playhead}
        playback={playback}
      />,
    )
    const video = document.querySelector('video')
    if (!video) throw new Error('no video element rendered')
    playback.reportPlaying(true)
    return { playhead, playback, video }
  }

  function at(video: HTMLVideoElement, seconds: number) {
    Object.defineProperty(video, 'currentTime', {
      value: seconds,
      writable: true,
      configurable: true,
    })
    fireEvent.timeUpdate(video)
  }

  it('crosses the split without changing file or stopping', () => {
    const { playhead, playback, video } = setupThree()

    act(() => at(video, 10.0))

    // Same source either side of a split, so nothing should swap.
    expect(video.getAttribute('src')).toBe('blob:one')
    expect(playhead.ms).toBe(10_000)
    expect(playback.isPlaying).toBe(true)
  })

  it('keeps advancing through the second half of the split', () => {
    const { playhead, video } = setupThree(10_000)

    act(() => at(video, 25.0))

    expect(playhead.ms).toBe(25_000)
  })

  it('moves to the appended video at the end of the split clip', () => {
    const { playhead, video } = setupThree(10_000)

    act(() => at(video, 180.0))

    expect(video.getAttribute('src')).toBe('blob:two')
    act(() => fireEvent.loadedMetadata(video))
    expect(playhead.ms).toBe(180_000)
  })
})

describe('reaching the end of a source file', () => {
  /** Two files, each played to its own end — the shape a plain import gives you. */
  const firstWhole: Clip = { id: 'a', sourceId: 'one.mp4', sourceIn: 0, sourceOut: 3000, start: 0 }
  const secondWhole: Clip = {
    id: 'b',
    sourceId: 'two.mp4',
    sourceIn: 0,
    sourceOut: 2000,
    start: 3000,
  }

  function setup(clips: Clip[], startMs = 0) {
    const playhead = new PlayheadStore(startMs)
    const playback = new PlaybackStore()
    render(<VideoPlayer clips={clips} sources={sources} playhead={playhead} playback={playback} />)
    const video = document.querySelector('video')
    if (!video) throw new Error('no video element rendered')
    playback.reportPlaying(true)
    return { playhead, playback, video }
  }

  it('moves to the next clip when the file ends rather than stopping', () => {
    // The frame callback that normally drives a crossing stops firing once the element ends, so
    // this event is the only thing left to continue from.
    const { playhead, video } = setup([firstWhole, secondWhole])

    act(() => fireEvent.ended(video))

    expect(video.getAttribute('src')).toBe('blob:two')
    act(() => fireEvent.loadedMetadata(video))
    expect(playhead.ms).toBe(3000)
  })

  it('resumes playing the next file', () => {
    const { playback, video } = setup([firstWhole, secondWhole])

    act(() => fireEvent.ended(video))
    play.mockClear()
    act(() => fireEvent.loadedMetadata(video))

    expect(play).toHaveBeenCalled()

    // play() is mocked, so nothing fires the element's own event. The store moves only on that
    // event by design, so the browser's half of the exchange has to be simulated here.
    act(() => fireEvent.play(video))
    expect(playback.isPlaying).toBe(true)
  })

  it('stops for real at the end of the last clip', () => {
    const { playback, video } = setup([firstWhole], 0)

    act(() => fireEvent.ended(video))

    expect(playback.isPlaying).toBe(false)
  })
})

describe('ending a file that also reports a pause', () => {
  /** What browsers actually do: `pause` then `ended`, so the store says "not playing" first. */
  const firstWhole: Clip = { id: 'a', sourceId: 'one.mp4', sourceIn: 0, sourceOut: 3000, start: 0 }
  const secondWhole: Clip = {
    id: 'b',
    sourceId: 'two.mp4',
    sourceIn: 0,
    sourceOut: 2000,
    start: 3000,
  }

  it('still resumes the next file', () => {
    const playhead = new PlayheadStore()
    const playback = new PlaybackStore()
    render(
      <VideoPlayer
        clips={[firstWhole, secondWhole]}
        sources={sources}
        playhead={playhead}
        playback={playback}
      />,
    )
    const video = document.querySelector('video')
    if (!video) throw new Error('no video element rendered')
    playback.reportPlaying(true)

    // The pause arrives first, which is what made the next clip load and then sit there.
    act(() => fireEvent.pause(video))
    expect(playback.isPlaying).toBe(false)

    act(() => fireEvent.ended(video))
    expect(video.getAttribute('src')).toBe('blob:two')

    play.mockClear()
    act(() => fireEvent.loadedMetadata(video))

    expect(play).toHaveBeenCalled()
  })
})
