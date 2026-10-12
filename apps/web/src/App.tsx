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

  const clipCount = project.tracks[0]?.clips.length ?? 0

  return (
    <main
      style={{ padding: 20, fontFamily: 'system-ui, sans-serif', maxWidth: 1100, margin: '0 auto' }}
    >
      <header style={{ display: 'flex', alignItems: 'baseline', gap: 16 }}>
        <h1 style={{ margin: 0 }}>Mini Cut</h1>
        <span style={{ color: '#8a8a94', fontSize: 14 }}>
          {saveState === 'saving' && 'Saving…'}
          {saveState === 'saved' && 'Saved'}
          {saveState === 'error' && 'Save failed'}
        </span>
      </header>

      <section style={{ margin: '16px 0' }}>
        <ImportButton onImported={handleImported} />
      </section>

      {notice && (
        <p role="alert" style={{ color: '#ff6b6b' }}>
          {notice}
        </p>
      )}

      <VideoPlayer src={sourceUrl} playhead={playhead} />

      <section style={{ marginTop: 16 }}>
        <Timeline bus={bus} playhead={playhead} />
      </section>

      <section style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
        <button type="button" onClick={() => bus.undo()} disabled={!bus.canUndo}>
          Undo
        </button>
        <button type="button" onClick={() => bus.redo()} disabled={!bus.canRedo}>
          Redo
        </button>
        <span style={{ color: '#8a8a94', fontSize: 14 }}>
          {clipCount} clip{clipCount === 1 ? '' : 's'}
        </span>
      </section>

      <p style={{ color: '#8a8a94', fontSize: 13, marginTop: 16 }}>
        Drag a clip to move it, drag its edges to trim. Scroll to pan, ctrl or cmd and scroll to
        zoom. Click empty space to move the playhead.
      </p>
    </main>
  )
}
