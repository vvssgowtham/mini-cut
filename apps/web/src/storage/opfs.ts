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
 * Copy `file` into OPFS and resolve with the OPFS file name actually used.
 *
 * **Naming.** `requestedName` is a suggestion, not a guarantee. Two different source files very often
 * share a basename (two phone cameras both produce `IMG_0001.mov`), and silently overwriting the first
 * would leave every `Clip.sourceId` that referenced it pointing at the wrong video. So: if the name is
 * already taken by a *different* file, this picks a free variant and returns it. Callers must use the
 * returned name, never the one they passed in.
 *
 * **Completion.** A copy is only valid once its final chunk is written. A tab closed or crashed
 * mid-copy would otherwise leave a truncated file that is byte-for-byte indistinguishable from a whole
 * one, and the next session would play a silently corrupt video. The implementation must therefore
 * mark completion out of band — write to a temporary name and rename on success, or record the name in
 * a manifest only after the last chunk lands — and treat any unmarked file as garbage to be deleted.
 *
 * **Failure.** Rejects if the browser lacks OPFS sync access handles, if a write fails, or if
 * `options.signal` aborts — the abort case rejects with a `DOMException` named `AbortError`, so callers
 * can tell a user cancel from a real failure. No rejection may leave a usable-looking partial file.
 */
export async function copyFileToOpfs(
  _file: File,
  _requestedName: string,
  _options: CopyOptions = {},
): Promise<string> {
  throw new Error('not implemented: copyFileToOpfs')
}

/**
 * Open an OPFS file for reading and return a `blob:` URL the `<video>` element can play.
 *
 * The caller owns the returned URL and must pass it to {@link revokeOpfsUrl} when the media is no
 * longer on screen. `URL.createObjectURL` pins the blob for the lifetime of the document, so a caller
 * that swaps between two 2 GB clips without revoking retains both — the exact out-of-memory failure
 * the chunked copy in `media/chunks.ts` exists to avoid.
 */
export async function openOpfsAsUrl(_name: string): Promise<string> {
  throw new Error('not implemented: openOpfsAsUrl')
}

/**
 * Release a URL from {@link openOpfsAsUrl}. Safe to call twice, and safe to call with a URL that was
 * never handed out.
 */
export function revokeOpfsUrl(_url: string): void {
  throw new Error('not implemented: revokeOpfsUrl')
}
