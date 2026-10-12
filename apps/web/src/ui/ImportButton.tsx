/**
 * Importing a video: pick a file, copy it into OPFS, report progress.
 *
 * The copy is the slow part — minutes for a 2 GB file — so this is a progress UI first and a button
 * second. It stays usable during the copy and offers a cancel, because the alternative for someone
 * who picked the wrong file is to close the tab.
 */

import { useRef, useState } from 'react'
import { copyFileToOpfs, type CopyProgress } from '../storage/opfs'

export type ImportButtonProps = {
  /** Called with the OPFS name the copy actually used, which may differ from the file's own name. */
  onImported: (opfsName: string, file: File) => void | Promise<void>
  disabled?: boolean
}

type State =
  | { status: 'idle' }
  | { status: 'copying'; progress: CopyProgress }
  | { status: 'failed'; message: string }

function percent({ copiedBytes, totalBytes }: CopyProgress): number {
  if (totalBytes === 0) return 100
  return Math.round((copiedBytes / totalBytes) * 100)
}

export function ImportButton({ onImported, disabled }: ImportButtonProps) {
  const [state, setState] = useState<State>({ status: 'idle' })
  const inputRef = useRef<HTMLInputElement>(null)
  const abortRef = useRef<AbortController | null>(null)

  const handleFile = async (file: File) => {
    const controller = new AbortController()
    abortRef.current = controller
    setState({ status: 'copying', progress: { copiedBytes: 0, totalBytes: file.size } })

    try {
      const opfsName = await copyFileToOpfs(file, file.name, {
        signal: controller.signal,
        onProgress: (progress) => setState({ status: 'copying', progress }),
      })
      setState({ status: 'idle' })
      await onImported(opfsName, file)
    } catch (error) {
      // A cancel is a choice, not a failure, so it leaves no error on screen.
      const aborted = error instanceof DOMException && error.name === 'AbortError'
      setState(
        aborted
          ? { status: 'idle' }
          : { status: 'failed', message: error instanceof Error ? error.message : 'import failed' },
      )
    } finally {
      abortRef.current = null
      // Clear the input so picking the same file again still fires a change event.
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  return (
    <div className="import">
      {/* A real input, visually hidden behind its own label: the native control prints "No file
          chosen" beside itself, which cannot be styled and reads as unfinished next to real buttons.
          The label keeps it clickable and focusable. */}
      <label className="import-label">
        <input
          ref={inputRef}
          type="file"
          accept="video/*"
          disabled={disabled || state.status === 'copying'}
          onChange={(event) => {
            const file = event.target.files?.[0]
            if (file) void handleFile(file)
          }}
        />
        <span>Import video</span>
      </label>

      {state.status === 'copying' && (
        <span className="copying">
          <progress
            aria-label="Copying video"
            value={state.progress.copiedBytes}
            max={state.progress.totalBytes || 1}
          />
          <b>{percent(state.progress)}%</b>
          <button type="button" onClick={() => abortRef.current?.abort()}>
            Stop copying
          </button>
        </span>
      )}

      {state.status === 'failed' && (
        <span role="alert" className="alert">
          {state.message}
        </span>
      )}
    </div>
  )
}
