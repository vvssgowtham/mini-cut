/**
 * Copy a user's file into the Origin Private File System (OPFS).
 *
 * Why OPFS and not a `blob:` URL of the original file: the original `File` is only valid while the
 * user keeps it open, and after a refresh the browser forgets it. OPFS is per-origin storage that
 * survives refreshes, so the project can find its media again (M5 depends on this).
 *
 * Shape of the work:
 * 1. `planChunks(file.size, CHUNK_BYTES)` gives the byte ranges (see `media/chunks.ts`).
 * 2. Open the OPFS file. Writes should go through a sync access handle in a Web Worker
 *    (`createSyncAccessHandle`), which is only available inside workers, not on the main thread.
 * 3. For each range: `file.slice(start, end).arrayBuffer()`, then write at offset `start`.
 *    Only one chunk is ever in memory.
 * 4. Report progress after each chunk, and abort cleanly if the caller cancels.
 *
 * Browser-only: none of this runs under Vitest's Node environment. It is checked by hand in the
 * browser for now (see the M2 issue for the verification steps).
 */

/** 64 MB per chunk: big enough to keep the number of writes low, small enough to stay well inside memory. */
export const CHUNK_BYTES = 64 * 1024 * 1024

export type CopyProgress = { copiedBytes: number; totalBytes: number }

export type CopyOptions = {
  onProgress?: (progress: CopyProgress) => void
  /** Aborting stops between chunks and removes the partial OPFS file. */
  signal?: AbortSignal
}

/**
 * Copy `file` into OPFS under `name` and resolve with the OPFS file name.
 *
 * Rejects if the browser lacks OPFS sync access handles, if the copy is aborted, or if a write fails.
 * A rejected copy must not leave a half-written file behind.
 */
export async function copyFileToOpfs(
  _file: File,
  _name: string,
  _options: CopyOptions = {},
): Promise<string> {
  throw new Error('not implemented: copyFileToOpfs')
}

/** Open an OPFS file for reading and return a `blob:` URL the `<video>` element can play. */
export async function openOpfsAsUrl(_name: string): Promise<string> {
  throw new Error('not implemented: openOpfsAsUrl')
}
