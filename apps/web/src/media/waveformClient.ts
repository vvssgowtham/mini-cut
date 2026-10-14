/**
 * Asking the worker for a source's peaks.
 *
 * Browser-only. Kept apart from the worker itself so callers never deal with `postMessage`, and so
 * a file with no audio track resolves to null rather than rejecting — a silent screen recording is
 * ordinary, not an error.
 */

import type { Waveform } from './waveform'
import type { WaveformRequest, WaveformResponse } from '../workers/waveform.worker'
import { openOpfsAsUrl, revokeOpfsUrl } from '../storage/opfs'

/** Analysing a source means holding its bytes in memory, so only one runs at a time. */
let queue: Promise<unknown> = Promise.resolve()

function analyse(sourceId: string, bytes: ArrayBuffer): Promise<Waveform | null> {
  return new Promise((resolve) => {
    const worker = new Worker(new URL('../workers/waveform.worker.ts', import.meta.url), {
      type: 'module',
    })

    worker.onmessage = (event: MessageEvent<WaveformResponse>) => {
      const data = event.data
      worker.terminate()
      resolve(data.ok ? { peaks: data.peaks, durationMs: data.durationMs } : null)
    }
    worker.onerror = () => {
      worker.terminate()
      resolve(null)
    }

    const request: WaveformRequest = { sourceId, bytes }
    worker.postMessage(request, [bytes])
  })
}

/**
 * Read a source out of OPFS and reduce it to peaks, or resolve null when it has no usable audio.
 *
 * Requests are serialised: each one holds a whole file in memory while it decodes, and two large
 * imports at once is how a tab runs out of room.
 */
export function requestWaveform(sourceId: string): Promise<Waveform | null> {
  const run = queue.then(async () => {
    const url = await openOpfsAsUrl(sourceId)
    try {
      const bytes = await (await fetch(url)).arrayBuffer()
      return await analyse(sourceId, bytes)
    } catch {
      return null
    } finally {
      revokeOpfsUrl(url)
    }
  })

  // The queue must not stall on a failure, so it continues regardless of the outcome.
  queue = run.catch(() => undefined)
  return run
}
