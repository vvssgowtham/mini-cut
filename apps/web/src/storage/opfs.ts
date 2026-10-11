/**
 * Copy a user's file into the Origin Private File System (OPFS).
 *
 * Why OPFS and not a `blob:` URL of the original file: the original `File` is only valid while the
 * user keeps it open, and after a refresh the browser forgets it. OPFS is per-origin storage that
 * survives refreshes, so the project can find its media again (M5 depends on this).
 *
 * How the copy works:
 * 1. `planChunks(file.size, CHUNK_BYTES)` gives the byte ranges (see `media/chunks.ts`).
 * 2. `file.slice(start, end).arrayBuffer()` pulls one chunk into memory at a time, and it is written
 *    at its own offset. The whole file is never resident.
 * 3. Writes go through `createWritable()`, which buffers into a swap file and commits atomically on
 *    `close()`. That is what makes a crash safe: an interrupted copy leaves no file at all, rather
 *    than a truncated one that is byte-for-byte indistinguishable from a complete video.
 *    (`createSyncAccessHandle()` would be faster but is worker-only and writes in place, so it would
 *    need its own completion marker.)
 *
 * Browser-only: none of this runs under Vitest's Node environment, so it has no unit tests. It is
 * verified by hand in the browser — see the M2 issue for the steps.
 */

import { planChunks } from '../media/chunks'

/** 64 MB per chunk: big enough to keep the number of writes low, small enough to stay well inside memory. */
export const CHUNK_BYTES = 64 * 1024 * 1024

/** Give up rather than spin forever if an origin somehow holds thousands of same-named files. */
const MAX_NAME_ATTEMPTS = 10_000

export type CopyProgress = { copiedBytes: number; totalBytes: number }

export type CopyOptions = {
  onProgress?: (progress: CopyProgress) => void
  /** Aborting stops between chunks and leaves no file behind. */
  signal?: AbortSignal
}

async function fileExists(root: FileSystemDirectoryHandle, name: string): Promise<boolean> {
  try {
    await root.getFileHandle(name)
    return true
  } catch {
    return false
  }
}

/** `clip.mov` -> `clip-2.mov` -> `clip-3.mov`, the first one that is free. */
async function uniqueName(root: FileSystemDirectoryHandle, requested: string): Promise<string> {
  if (!(await fileExists(root, requested))) return requested

  const dot = requested.lastIndexOf('.')
  const stem = dot > 0 ? requested.slice(0, dot) : requested
  const extension = dot > 0 ? requested.slice(dot) : ''

  for (let suffix = 2; suffix < MAX_NAME_ATTEMPTS; suffix++) {
    const candidate = `${stem}-${suffix}${extension}`
    if (!(await fileExists(root, candidate))) return candidate
  }
  throw new Error(`could not find a free OPFS name for ${requested}`)
}

/**
 * Copy `file` into OPFS and resolve with the OPFS file name actually used.
 *
 * **Naming.** `requestedName` is a suggestion, not a guarantee. Two different source files very often
 * share a basename (two phone cameras both produce `IMG_0001.mov`), and silently overwriting the first
 * would leave every `Clip.sourceId` that referenced it pointing at the wrong video. So if the name is
 * already taken, this picks a free variant and returns it. Callers must use the returned name, never
 * the one they passed in.
 *
 * **Failure.** Rejects if the browser lacks OPFS, if a write fails, or if `options.signal` aborts —
 * the abort case rejects with a `DOMException` named `AbortError`, so callers can tell a user cancel
 * from a real failure. No rejection leaves a usable-looking partial file.
 */
export async function copyFileToOpfs(
  file: File,
  requestedName: string,
  options: CopyOptions = {},
): Promise<string> {
  const { onProgress, signal } = options
  signal?.throwIfAborted()

  const root = await navigator.storage.getDirectory()
  const name = await uniqueName(root, requestedName)
  const handle = await root.getFileHandle(name, { create: true })
  const writable = await handle.createWritable()

  try {
    for (const { start, end } of planChunks(file.size, CHUNK_BYTES)) {
      signal?.throwIfAborted()
      const chunk = await file.slice(start, end).arrayBuffer()
      await writable.write({ type: 'write', position: start, data: chunk })
      onProgress?.({ copiedBytes: end, totalBytes: file.size })
    }
    // Commits the swap file. Until this resolves, nothing is readable under `name`.
    await writable.close()
  } catch (error) {
    // `abort()` discards the swap file; `removeEntry` clears the placeholder `getFileHandle` created.
    await writable.abort().catch(() => {})
    await root.removeEntry(name).catch(() => {})
    throw error
  }

  return name
}

/**
 * Open an OPFS file for reading and return a `blob:` URL the `<video>` element can play.
 *
 * The caller owns the returned URL and must pass it to {@link revokeOpfsUrl} when the media is no
 * longer on screen. `URL.createObjectURL` pins the blob for the lifetime of the document, so a caller
 * that swaps between two 2 GB clips without revoking retains both — the exact out-of-memory failure
 * the chunked copy in `media/chunks.ts` exists to avoid.
 */
export async function openOpfsAsUrl(name: string): Promise<string> {
  const root = await navigator.storage.getDirectory()
  const handle = await root.getFileHandle(name)
  return URL.createObjectURL(await handle.getFile())
}

/**
 * Release a URL from {@link openOpfsAsUrl}. Safe to call twice, and safe to call with a URL that was
 * never handed out.
 */
export function revokeOpfsUrl(url: string): void {
  URL.revokeObjectURL(url)
}
