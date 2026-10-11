/**
 * Splitting a large file into byte ranges, so it can be copied into OPFS a chunk at a time.
 *
 * Why chunks: `file.arrayBuffer()` loads the whole file into memory. A 2 GB file would need 2 GB of
 * heap on top of everything else, and the tab can crash. `file.slice(start, end)` returns a lazy view,
 * and only the chunk you read is pulled into memory.
 */

/** A half-open byte range: `start` is included, `end` is excluded. */
export type ByteRange = { start: number; end: number }

/**
 * Split `totalBytes` into consecutive ranges of at most `chunkBytes` each.
 *
 * Rules the tests check:
 * - the ranges cover `[0, totalBytes)` exactly: no gaps, no overlap
 * - every range is non-empty except that an empty file gives no ranges at all
 * - only the last range may be shorter than `chunkBytes`
 * - throw when `chunkBytes` is not a positive integer, or `totalBytes` is negative or not an integer
 */
export function planChunks(_totalBytes: number, _chunkBytes: number): ByteRange[] {
  throw new Error('not implemented: planChunks')
}
