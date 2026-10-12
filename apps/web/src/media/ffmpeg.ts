/**
 * Loading ffmpeg.wasm, and feeding it the source media.
 *
 * Kept apart from `runExport.ts` on purpose. That module holds the sequencing — the part with the
 * bugs in it, and the part worth testing — and takes its ffmpeg as an argument. This one is the
 * untestable half: a multi-megabyte wasm download and a virtual filesystem, neither of which exists
 * under Node.
 *
 * The import is dynamic so that wasm stays out of the main bundle. Someone who only trims and never
 * exports should never pay to download an encoder.
 */

import type { FfmpegLike } from './runExport'
import { openOpfsAsUrl, revokeOpfsUrl } from '../storage/opfs'

/**
 * Multi-threaded ffmpeg.wasm needs `SharedArrayBuffer`, which the browser only exposes on a
 * cross-origin isolated page. The dev server sets COOP/COEP (see `vite.config.ts`) and production
 * hosting must too, so this is checked up front rather than failing deep inside a load.
 */
export function isExportSupported(): boolean {
  // Read both off globalThis. A bare `crossOriginIsolated` throws a ReferenceError wherever it is
  // not defined — jsdom, older Safari — which would take down the whole app, not just export.
  return typeof SharedArrayBuffer !== 'undefined' && globalThis.crossOriginIsolated === true
}

export class FfmpegUnavailableError extends Error {
  constructor() {
    super(
      'Export needs a cross-origin isolated page. The server must send ' +
        'Cross-Origin-Opener-Policy: same-origin and Cross-Origin-Embedder-Policy: require-corp.',
    )
    this.name = 'FfmpegUnavailableError'
  }
}

export type LoadedFfmpeg = FfmpegLike & {
  /** Copy a source out of OPFS into ffmpeg's virtual filesystem under the same name. */
  loadSource: (opfsName: string) => Promise<void>
  terminate: () => void
}

/**
 * Load ffmpeg.wasm and return the narrow interface `runExport` expects.
 *
 * `onLog` receives ffmpeg's stderr, which is where it reports a codec it cannot handle. Without it,
 * a failed export is an opaque rejection.
 */
export async function loadFfmpeg(onLog?: (line: string) => void): Promise<LoadedFfmpeg> {
  if (!isExportSupported()) throw new FfmpegUnavailableError()

  const { FFmpeg } = await import('@ffmpeg/ffmpeg')
  const ffmpeg = new FFmpeg()
  if (onLog) ffmpeg.on('log', ({ message }) => onLog(message))

  await ffmpeg.load()

  return {
    exec: (args) => ffmpeg.exec(args),
    writeFile: (name, data) => ffmpeg.writeFile(name, data),
    readFile: async (name) => {
      const data = await ffmpeg.readFile(name)
      // readFile returns a string when asked for text; everything here is binary.
      if (typeof data === 'string') throw new Error(`expected binary data for ${name}`)
      return data
    },
    deleteFile: (name) => ffmpeg.deleteFile(name),

    loadSource: async (opfsName) => {
      const url = await openOpfsAsUrl(opfsName)
      try {
        const response = await fetch(url)
        const bytes = new Uint8Array(await response.arrayBuffer())
        await ffmpeg.writeFile(opfsName, bytes)
      } finally {
        // The blob is now duplicated inside the wasm heap; holding the URL as well would pin two
        // copies of a multi-gigabyte file.
        revokeOpfsUrl(url)
      }
    },

    terminate: () => ffmpeg.terminate(),
  }
}
