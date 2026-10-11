/** The spec for planChunks. */

import { describe, expect, it } from 'vitest'
import { planChunks } from './chunks'

describe('planChunks', () => {
  it('returns no ranges for an empty file', () => {
    expect(planChunks(0, 4)).toEqual([])
  })

  it('splits a file into chunks with a shorter last chunk', () => {
    expect(planChunks(10, 4)).toEqual([
      { start: 0, end: 4 },
      { start: 4, end: 8 },
      { start: 8, end: 10 },
    ])
  })

  it('gives full chunks only when the size divides evenly', () => {
    expect(planChunks(8, 4)).toEqual([
      { start: 0, end: 4 },
      { start: 4, end: 8 },
    ])
  })

  it('gives one range when the file fits in a single chunk', () => {
    expect(planChunks(3, 100)).toEqual([{ start: 0, end: 3 }])
  })

  it('covers the file exactly, with no gaps or overlap, for a large size', () => {
    const total = 2 * 1024 * 1024 * 1024 + 123 // just over 2 GB
    const chunk = 64 * 1024 * 1024
    const ranges = planChunks(total, chunk)

    expect(ranges[0]?.start).toBe(0)
    expect(ranges[ranges.length - 1]?.end).toBe(total)
    for (let i = 1; i < ranges.length; i++) {
      expect(ranges[i]?.start).toBe(ranges[i - 1]?.end)
    }
    for (const range of ranges.slice(0, -1)) {
      expect(range.end - range.start).toBe(chunk)
    }
  })

  it('rejects a chunk size that is not a positive integer', () => {
    expect(() => planChunks(10, 0)).toThrow()
    expect(() => planChunks(10, -4)).toThrow()
    expect(() => planChunks(10, 2.5)).toThrow()
  })

  it('rejects a negative or non-integer file size', () => {
    expect(() => planChunks(-1, 4)).toThrow()
    expect(() => planChunks(10.5, 4)).toThrow()
  })
})
