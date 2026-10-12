/**
 * The editor shell: import a video, preview it, cut it on the timeline, and have the result still be
 * there after a refresh.
 *
 * Three things are deliberately held outside React's render path. The command bus owns the project
 * (React subscribes through `useProject`), the playhead store owns the play position (it changes
 * every frame), and autosave listens to the bus directly rather than to a component.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { CommandBus } from './editor/history'
import type { Project } from './editor/types'
import { useProject } from './editor/useProject'
import { PlayheadStore } from './media/playhead'
import { probeDuration } from './media/probe'
import { VideoPlayer } from './media/VideoPlayer'
import { formatDuration } from './media/timecode'
import { startAutosave } from './storage/autosave'
import {
  CURRENT_PROJECT_ID,
  loadProject,
  requestPersistentStorage,
  saveProject,
} from './storage/db'
import { openOpfsAsUrl, revokeOpfsUrl } from './storage/opfs'
import { RestoreError } from './storage/restore'
import { Timeline } from './timeline/Timeline'
import { ImportButton } from './ui/ImportButton'
import { Timecode } from './ui/Timecode'

const emptyProject = (): Project => ({
  version: 1,
  durationMs: 0,
  tracks: [{ id: 't1', clips: [] }],
})

/** IndexedDB is absent under jsdom, where the component tests run. */
const hasIndexedDb = () => typeof indexedDB !== 'undefined'

type SaveState = 'idle' | 'saving' | 'saved' | 'error'

export default function App() {
  const [bus] = useState(() => new CommandBus(emptyProject()))
  const [playhead] = useState(() => new PlayheadStore())
  const project = useProject(bus)

  const [sourceUrl, setSourceUrl] = useState<string | null>(null)
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [notice, setNotice] = useState<string | null>(null)
  /** Object URLs are revoked on replace and on unmount; otherwise each import pins another file. */
  const sourceUrlRef = useRef<string | null>(null)

  const showSource = useCallback((url: string | null) => {
    if (sourceUrlRef.current) revokeOpfsUrl(sourceUrlRef.current)
    sourceUrlRef.current = url
    setSourceUrl(url)
  }, [])

  useEffect(() => {
    return () => {
      if (sourceUrlRef.current) revokeOpfsUrl(sourceUrlRef.current)
    }
  }, [])

  // Restore the last session.
  useEffect(() => {
    if (!hasIndexedDb()) return
    let cancelled = false

    void (async () => {
      try {
        const restored = await loadProject()
        if (cancelled || !restored) return
        bus.replace(restored)

        const sourceId = restored.tracks[0]?.clips[0]?.sourceId
        if (sourceId) showSource(await openOpfsAsUrl(sourceId))
      } catch (error) {
        // A save from a newer build is kept, not overwritten: the user can reopen it in the tab
        // that wrote it. Anything else is reported and left alone.
        if (error instanceof RestoreError && error.reason === 'too-new') {
          setNotice('This project was saved by a newer version of Mini Cut and was not opened.')
        } else {
          setNotice(error instanceof Error ? error.message : 'could not restore the last project')
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [bus, showSource])

  // Autosave. Flushed on hide rather than on unload: a backgrounded tab can be discarded without
  // ever firing unload, and pagehide/visibilitychange are the events that actually run.
  useEffect(() => {
    if (!hasIndexedDb()) return

    const autosave = startAutosave(
      bus,
      async (next) => {
        setSaveState('saving')
        await saveProject(next, CURRENT_PROJECT_ID)
        setSaveState('saved')
      },
      {
        onError: (error) => {
          setSaveState('error')
          setNotice(error instanceof Error ? error.message : 'autosave failed')
        },
      },
    )

    const flush = () => void autosave.flush()
    window.addEventListener('pagehide', flush)
    document.addEventListener('visibilitychange', flush)

    return () => {
      window.removeEventListener('pagehide', flush)
      document.removeEventListener('visibilitychange', flush)
      void autosave.flush()
      autosave.stop()
    }
  }, [bus])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'z') return
      event.preventDefault()
      if (event.shiftKey) bus.redo()
      else bus.undo()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [bus])

  const handleImported = useCallback(
    async (opfsName: string) => {
      setNotice(null)
      const url = await openOpfsAsUrl(opfsName)
      showSource(url)

      const durationMs = await probeDuration(url)
      // A fresh import replaces the project outright, so its undo history goes with it.
      bus.replace({
        version: 1,
        durationMs,
        tracks: [
          {
            id: 't1',
            clips: [
              {
                id: crypto.randomUUID(),
                sourceId: opfsName,
                sourceIn: 0,
                sourceOut: durationMs,
                start: 0,
              },
            ],
          },
        ],
      })
      playhead.set(0)
      void requestPersistentStorage()
    },
    [bus, playhead, showSource],
  )

  const clips = project.tracks[0]?.clips ?? []
  const cutDurationMs = clips.reduce((sum, clip) => sum + (clip.sourceOut - clip.sourceIn), 0)

  return (
    <div className="app">
      <header className="zone masthead">
        <h1 className="wordmark">Mini Cut</h1>
        <Timecode playhead={playhead} idle={!sourceUrl} />
        <span className="state" data-tone={saveState === 'error' ? 'error' : undefined}>
          {saveState === 'saving' && 'Saving'}
          {saveState === 'saved' && 'Saved'}
          {saveState === 'error' && 'Not saved'}
        </span>
      </header>

      <section className="zone viewer">
        <VideoPlayer src={sourceUrl} playhead={playhead} />
      </section>

      <section className="zone timeline" aria-label="Timeline">
        <Timeline bus={bus} playhead={playhead} />
      </section>

      <footer className="zone">
        {notice && (
          <p role="alert" className="alert">
            {notice}
          </p>
        )}

        <div className="transport">
          <button type="button" onClick={() => bus.undo()} disabled={!bus.canUndo}>
            Undo
          </button>
          <button type="button" onClick={() => bus.redo()} disabled={!bus.canRedo}>
            Redo
          </button>
          <ImportButton onImported={handleImported} />

          <span className="readout">
            <span aria-label={`${clips.length} ${clips.length === 1 ? 'clip' : 'clips'}`}>
              <b>{clips.length}</b> {clips.length === 1 ? 'clip' : 'clips'}
            </span>
            <span>
              <b>{formatDuration(cutDurationMs)}</b> cut
            </span>
          </span>
        </div>

        <p className="hint">
          Drag a clip to move it, or its edges to trim. Scroll to pan, hold ctrl or cmd and scroll
          to zoom, and click empty space to move the playhead.
        </p>
      </footer>
    </div>
  )
}
