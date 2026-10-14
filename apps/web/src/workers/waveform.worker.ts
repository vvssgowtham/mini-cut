/**
 * Decoding a file's audio into peaks, off the main thread.
 *
 * Decoding a few minutes of audio takes seconds and is pure computation. On the main thread that is
 * seconds of frozen UI — no scrubbing, no playback, no cursor. In a worker it is seconds of the
 * waveform simply not being there yet, which is the difference between slow and broken.
 *
 * Browser-only, so no unit tests: the arithmetic it relies on lives in `media/waveform.ts`, which is
 * tested. What is here is the decode and the plumbing.
 */

import { bucketCountFor, downsampleToPeaks } from '../media/waveform'

export type WaveformRequest = { sourceId: string; bytes: ArrayBuffer }

export type WaveformResponse =
  | { sourceId: string; ok: true; peaks: Float32Array; durationMs: number }
  | { sourceId: string; ok: false; error: string }

/**
 * Mix every channel down to one track of peaks.
 *
 * A stereo file where one side is silent should not read as half silent, so channels are combined
 * by taking the louder of the two at each sample rather than averaging them.
 */
function mixToMono(buffer: AudioBuffer): Float32Array {
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, i) =>
    buffer.getChannelData(i),
  )
  const first = channels[0]
  if (!first) return new Float32Array(0)
  if (channels.length === 1) return first

  const mixed = new Float32Array(first.length)
  for (let i = 0; i < first.length; i++) {
    let loudest = 0
    for (const channel of channels) {
      const magnitude = Math.abs(channel[i] ?? 0)
      if (magnitude > loudest) loudest = magnitude
    }
    mixed[i] = loudest
  }
  return mixed
}

self.onmessage = async (event: MessageEvent<WaveformRequest>) => {
  const { sourceId, bytes } = event.data

  try {
    // OfflineAudioContext decodes without needing an output device, which a worker does not have.
    // The sample rate and length here are placeholders; decodeAudioData reports the real ones.
    const context = new OfflineAudioContext(1, 1, 44_100)
    const decoded = await context.decodeAudioData(bytes)

    const durationMs = Math.round(decoded.duration * 1000)
    const peaks = downsampleToPeaks(mixToMono(decoded), bucketCountFor(durationMs))

    const response: WaveformResponse = { sourceId, ok: true, peaks, durationMs }
    // Transferred, not copied: the peaks can be megabytes for a long file. The cast is because the
    // worker's `self` is typed as a window here, which has a narrower postMessage.
    ;(self as unknown as Worker).postMessage(response, [peaks.buffer])
  } catch (error) {
    const response: WaveformResponse = {
      sourceId,
      ok: false,
      // A file with no audio track at all is normal, not a failure worth shouting about.
      error: error instanceof Error ? error.message : 'could not decode audio',
    }
    ;(self as unknown as Worker).postMessage(response)
  }
}
