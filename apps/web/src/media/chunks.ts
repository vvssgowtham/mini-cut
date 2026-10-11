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
 * The ranges cover `[0, totalBytes)` exactly — no gaps, no overlap — and only the last one may be
 * shorter than `chunkBytes`. An empty file gives no ranges at all.
 *
 * Throws when `chunkBytes` is not a positive integer, or `totalBytes` is negative or not an integer.
 */
export function planChunks(totalBytes: number, chunkBytes: number): ByteRange[] {
  if (!Number.isInteger(totalBytes) || totalBytes < 0) {
    throw new RangeError(`totalBytes must be a non-negative integer, got ${totalBytes}`)
  }
  if (!Number.isInteger(chunkBytes) || chunkBytes <= 0) {
    throw new RangeError(`chunkBytes must be a positive integer, got ${chunkBytes}`)
  }

  const ranges: ByteRange[] = []
  for (let start = 0; start < totalBytes; start += chunkBytes) {
    ranges.push({ start, end: Math.min(start + chunkBytes, totalBytes) })
  }
  return ranges
}
