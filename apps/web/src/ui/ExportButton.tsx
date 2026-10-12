/**
 * Export: plan the cut, run ffmpeg, hand back a file.
 *
 * An export of real footage takes minutes, so this is a progress and cancel UI as much as a button.
 * The plan is built before anything loads, because a timeline that cannot be exported — overlapping
 * clips, nothing on it — should say so immediately rather than after a wasm download.
 */

import { useRef, useState } from 'react'
import type { Project } from '../editor/types'
import { FfmpegUnavailableError, isExportSupported, loadFfmpeg } from '../media/ffmpeg'
import { planExport } from '../media/exportPlan'
import { runExport, type ExportProgress } from '../media/runExport'

export type ExportButtonProps = {
  project: Project
  disabled?: boolean
}

type State =
  | { status: 'idle' }
  | { status: 'preparing' }
  | { status: 'running'; progress: ExportProgress }
  | { status: 'failed'; message: string }

function label(state: State): string {
  if (state.status === 'preparing') return 'Preparing'
  if (state.status !== 'running') return 'Export'
  const percent = Math.round(state.progress.ratio * 100)
  return state.progress.phase === 'concat' ? `Joining ${percent}%` : `Exporting ${percent}%`
}

export function ExportButton({ project, disabled }: ExportButtonProps) {
  const [state, setState] = useState<State>({ status: 'idle' })
  const abortRef = useRef<AbortController | null>(null)
  const busy = state.status === 'preparing' || state.status === 'running'

  const start = async () => {
    const controller = new AbortController()
    abortRef.current = controller
    setState({ status: 'preparing' })

    let ffmpeg: Awaited<ReturnType<typeof loadFfmpeg>> | null = null
    try {
      // Plan first: an unexportable timeline should fail now, not after a wasm download.
      const plan = planExport(project)

      ffmpeg = await loadFfmpeg()
      for (const sourceId of new Set(plan.segments.map((segment) => segment.sourceId))) {
        controller.signal.throwIfAborted()
        await ffmpeg.loadSource(sourceId)
      }

      const output = await runExport(ffmpeg, plan, {
        signal: controller.signal,
        onProgress: (progress) => setState({ status: 'running', progress }),
      })

      download(output, 'mini-cut.mp4')
      setState({ status: 'idle' })
    } catch (error) {
      const aborted = error instanceof DOMException && error.name === 'AbortError'
      setState(
        aborted
          ? { status: 'idle' }
          : {
              status: 'failed',
              message:
                error instanceof FfmpegUnavailableError
                  ? error.message
                  : error instanceof Error
                    ? error.message
                    : 'export failed',
            },
      )
    } finally {
      // Frees the wasm heap, which holds a full copy of every source.
      ffmpeg?.terminate()
      abortRef.current = null
    }
  }

  return (
    <span className="export">
      <button
        type="button"
        onClick={() => void start()}
        disabled={disabled || busy || !isExportSupported()}
        title={isExportSupported() ? undefined : 'Export needs a cross-origin isolated page'}
      >
        {label(state)}
      </button>

      {busy && (
        <button type="button" onClick={() => abortRef.current?.abort()}>
          Stop
        </button>
      )}

      {state.status === 'failed' && (
        <span role="alert" className="alert">
          {state.message}
        </span>
      )}
    </span>
  )
}

function download(data: Uint8Array, filename: string): void {
  // Copy into a fresh buffer: the view ffmpeg returns can be backed by its heap, which is freed on
  // terminate() while the browser may still be reading the blob.
  const url = URL.createObjectURL(new Blob([new Uint8Array(data)], { type: 'video/mp4' }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}
