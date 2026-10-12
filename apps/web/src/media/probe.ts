/**
 * Reading a media file's duration before it goes on the timeline.
 *
 * Browser-only, so no unit tests: it needs a real decoder. `preload="metadata"` is the point — the
 * browser reads the header and stops, so this costs a few hundred kilobytes rather than the whole
 * 2 GB file.
 */

import type { Ms } from '../editor/types'
import { secondsToMs } from './time'

/** Give up rather than hang on a file the browser cannot decode. */
const PROBE_TIMEOUT_MS = 30_000

export class ProbeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ProbeError'
  }
}

/**
 * Resolve the duration of the media at `url`.
 *
 * Rejects when the browser cannot decode the file — an unsupported codec in an otherwise valid
 * container, say — rather than returning a zero that would put an invisible clip on the timeline.
 */
export function probeDuration(url: string): Promise<Ms> {
  return new Promise<Ms>((resolve, reject) => {
    const video = document.createElement('video')
    video.preload = 'metadata'
    video.muted = true

    const cleanup = () => {
      clearTimeout(timer)
      video.removeAttribute('src')
      video.load()
    }

    const timer = setTimeout(() => {
      cleanup()
      reject(new ProbeError('timed out reading media metadata'))
    }, PROBE_TIMEOUT_MS)

    video.onloadedmetadata = () => {
      const { duration } = video
      cleanup()
      // A stream with no known length reports Infinity; a file we cannot read reports NaN.
      if (!Number.isFinite(duration) || duration <= 0) {
        reject(new ProbeError(`media has no usable duration (got ${duration})`))
        return
      }
      resolve(secondsToMs(duration))
    }

    video.onerror = () => {
      cleanup()
      reject(new ProbeError('browser could not decode this media'))
    }

    video.src = url
  })
}
