/** The spec for ruler ticks. */

import { describe, expect, it } from 'vitest'
import { TICK_LADDER_MS, chooseTickIntervalMs, isMajorTick, tickPositions } from './ticks'

describe('chooseTickIntervalMs', () => {
  it('picks an interval wide enough for the minimum spacing', () => {
    // At 0.1 px/ms, a 1 s tick is 100 px apart.
    expect(chooseTickIntervalMs(0.1, 80)).toBe(1000)
  })

  it('steps up as you zoom out', () => {
    const zoomedIn = chooseTickIntervalMs(0.5, 80)
    const zoomedOut = chooseTickIntervalMs(0.01, 80)

    expect(zoomedOut).toBeGreaterThan(zoomedIn)
  })

  it('always returns an interval from the ladder, never an arbitrary number', () => {
    for (const pxPerMs of [0.0001, 0.003, 0.02, 0.17, 0.4, 1]) {
      expect(TICK_LADDER_MS).toContain(chooseTickIntervalMs(pxPerMs, 80))
    }
  })

  it('never returns ticks closer than the minimum, except at the ladder top', () => {
    const last = TICK_LADDER_MS[TICK_LADDER_MS.length - 1]!

    for (const pxPerMs of [0.002, 0.05, 0.3, 0.9]) {
      const interval = chooseTickIntervalMs(pxPerMs, 80)
      if (interval !== last) expect(interval * pxPerMs).toBeGreaterThanOrEqual(80)
    }
  })

  it('falls back to the largest interval when nothing fits', () => {
    const last = TICK_LADDER_MS[TICK_LADDER_MS.length - 1]

    expect(chooseTickIntervalMs(0.0000001, 80)).toBe(last)
  })

  it('handles a zero or negative zoom without looping', () => {
    expect(chooseTickIntervalMs(0, 80)).toBe(TICK_LADDER_MS[TICK_LADDER_MS.length - 1])
    expect(chooseTickIntervalMs(-1, 80)).toBe(TICK_LADDER_MS[TICK_LADDER_MS.length - 1])
  })

  it('uses clock-like intervals rather than decimal ones', () => {
    // 100 s would be meaningless on a timeline; the ladder jumps 60 s -> 120 s.
    expect(TICK_LADDER_MS).toContain(60_000)
    expect(TICK_LADDER_MS).not.toContain(100_000)
  })
})

describe('tickPositions', () => {
  it('covers the visible range', () => {
    expect(tickPositions(0, 5000, 1000)).toEqual([0, 1000, 2000, 3000, 4000, 5000])
  })

  it('anchors to absolute time rather than the left edge', () => {
    // Starting at 2300 ms, the first 1 s tick is 2000, not 2300.
    expect(tickPositions(2300, 5000, 1000)[0]).toBe(2000)
  })

  it('stays anchored as the view scrolls', () => {
    const a = tickPositions(2300, 6300, 1000)
    const b = tickPositions(2400, 6400, 1000)

    // Every tick both views share is at the same absolute time.
    for (const ms of a.filter((t) => b.includes(t))) {
      expect(ms % 1000).toBe(0)
    }
  })

  it('never returns a negative position', () => {
    expect(tickPositions(-3000, 2000, 1000).every((ms) => ms >= 0)).toBe(true)
  })

  it('returns nothing for an inverted or invalid range', () => {
    expect(tickPositions(5000, 1000, 1000)).toEqual([])
    expect(tickPositions(0, 1000, 0)).toEqual([])
    expect(tickPositions(Number.NaN, 1000, 1000)).toEqual([])
  })

  it('returns ascending positions', () => {
    const positions = tickPositions(1234, 20_000, 2500)

    for (let i = 1; i < positions.length; i++) {
      expect(positions[i]!).toBeGreaterThan(positions[i - 1]!)
    }
  })
})

describe('isMajorTick', () => {
  it('labels every tick when labelEvery is one', () => {
    expect(isMajorTick(1000, 1000, 1)).toBe(true)
    expect(isMajorTick(3000, 1000, 1)).toBe(true)
  })

  it('labels every nth tick', () => {
    expect(isMajorTick(0, 1000, 5)).toBe(true)
    expect(isMajorTick(5000, 1000, 5)).toBe(true)
    expect(isMajorTick(3000, 1000, 5)).toBe(false)
  })

  it('keys off absolute time, so labels do not jump as the view scrolls', () => {
    // 10 s is major regardless of which ticks happen to be on screen.
    expect(isMajorTick(10_000, 1000, 5)).toBe(true)
    expect(isMajorTick(10_000, 1000, 5)).toBe(true)
  })
})
