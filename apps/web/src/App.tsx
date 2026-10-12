/**
 * The editor shell: import a video, preview it, cut it on the timeline, and have the result still be
 * there after a refresh.
 *
 * Three things are deliberately held outside React's render path. The command bus owns the project
 * (React subscribes through `useProject`), the playhead store owns the play position (it changes
 * every frame), and autosave listens to the bus directly rather than to a component.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { AgentPanel } from './agent/AgentPanel'
import { joinAvailability, splitAvailability } from './editor/clipActions'
import { CommandBus } from './editor/history'
import { clipEnd, type Project } from './editor/types'
import { useProject } from './editor/useProject'
import { PlaybackStore } from './media/playback'
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
import { timelineEnd } from './media/timelineMap'
import { RestoreError } from './storage/restore'
import { Timeline } from './timeline/Timeline'
import { ExportButton } from './ui/ExportButton'
import { ImportButton } from './ui/ImportButton'
import { Timecode } from './ui/Timecode'
import { Transport } from './ui/Transport'

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
  const [playback] = useState(() => new PlaybackStore())
  const project = useProject(bus)

  // One object URL per imported file. A single url would mean a second import replaced the first,
  // which is exactly what used to happen.
  const [sources, setSources] = useState<ReadonlyMap<string, string>>(new Map())
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [notice, setNotice] = useState<string | null>(null)
  const [online, setOnline] = useState(() => navigator.onLine)
  // Recomputed per render rather than memoised: it depends on the playhead, which changes outside
  // React, and a stale enabled/disabled button is worse than the work of checking again.
  const [playheadTick, setPlayheadTick] = useState(0)
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null)
  /** Revoked on unmount; each createObjectURL pins its file for the life of the document. */
  const sourcesRef = useRef<ReadonlyMap<string, string>>(sources)

  const addSource = useCallback(async (sourceId: string) => {
    const url = await openOpfsAsUrl(sourceId)
    setSources((current) => {
      if (current.has(sourceId)) {
        // Already open: drop the duplicate rather than leaking it.
        revokeOpfsUrl(url)
        return current
      }
      return new Map(current).set(sourceId, url)
    })
  }, [])

  useEffect(() => {
    sourcesRef.current = sources
  }, [sources])

  useEffect(() => {
    return () => {
      for (const url of sourcesRef.current.values()) revokeOpfsUrl(url)
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

        const sourceIds = new Set(
          restored.tracks.flatMap((track) => track.clips.map((clip) => clip.sourceId)),
        )
        for (const sourceId of sourceIds) await addSource(sourceId)
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
  }, [addSource, bus])

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

  // The project lives in IndexedDB and the media in OPFS, so going offline costs nothing — but the
  // user cannot know that unless it is said.
  // Re-render the toolbar when the playhead moves, so Split enables and disables as it crosses a
  // clip edge. Only the toolbar: the canvas and the video read the store directly.
  useEffect(() => playhead.subscribe(() => setPlayheadTick((tick) => tick + 1)), [playhead])

  useEffect(() => {
    const update = () => setOnline(navigator.onLine)
    window.addEventListener('online', update)
    window.addEventListener('offline', update)
    return () => {
      window.removeEventListener('online', update)
      window.removeEventListener('offline', update)
    }
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      // Never steal a key from a field the user is typing in.
      if (target?.closest('input, textarea, [contenteditable]')) return

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault()
        if (event.shiftKey) bus.redo()
        else bus.undo()
        return
      }

      if (event.key === ' ') {
        // Space is the universal play/pause in every editor. preventDefault stops it also
        // scrolling the page, and stops a focused button re-firing its own click.
        event.preventDefault()
        void playback.toggle()
        return
      }

      if ((event.key === 'Backspace' || event.key === 'Delete') && selectedClipId) {
        const trackId = bus.project.tracks[0]?.id
        if (!trackId) return
        event.preventDefault()
        bus.execute({ type: 'delete', trackId, clipId: selectedClipId })
        setSelectedClipId(null)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [bus, playback, selectedClipId])

  const handleImported = useCallback(
    async (opfsName: string) => {
      setNotice(null)
      await addSource(opfsName)

      const url = await openOpfsAsUrl(opfsName)
      let durationMs: number
      try {
        durationMs = await probeDuration(url)
      } finally {
        revokeOpfsUrl(url)
      }

      const current = bus.project
      const track = current.tracks[0]
      if (!track) return

      // Append after whatever is already there, as an insert rather than a replace: a second
      // import adds to the cut instead of discarding the first one and its undo history.
      const start = timelineEnd(track.clips)
      const clip = {
        id: crypto.randomUUID(),
        sourceId: opfsName,
        sourceIn: 0,
        sourceOut: durationMs,
        start,
      }

      bus.execute({ type: 'insert', trackId: track.id, index: track.clips.length, clip })
      playhead.set(start)
      setSelectedClipId(clip.id)
      void requestPersistentStorage()
    },
    [addSource, bus, playhead],
  )

  const clips = project.tracks[0]?.clips ?? []
  const cutDurationMs = clips.reduce((sum, clip) => sum + (clip.sourceOut - clip.sourceIn), 0)
  const timelineEndMs = clips.reduce((end, clip) => Math.max(end, clipEnd(clip)), 0)
  void playheadTick // the subscription above is what keeps these two in step with the playhead
  const split = splitAvailability(project, selectedClipId, playhead.ms)
  const join = joinAvailability(project, selectedClipId)

  return (
    <div className="app">
      <header className="zone masthead">
        <h1 className="wordmark">Mini Cut</h1>
        <Timecode playhead={playhead} idle={clips.length === 0} />
        <span className="state" data-tone={saveState === 'error' ? 'error' : undefined}>
          {saveState === 'saving' && 'Saving'}
          {saveState === 'saved' && (online ? 'Saved' : 'Saved on this device')}
          {saveState === 'error' && 'Not saved'}
          {saveState === 'idle' && !online && 'Offline'}
        </span>
      </header>

      <section className="zone viewer">
        <VideoPlayer clips={clips} sources={sources} playhead={playhead} playback={playback} />
      </section>

      <section className="zone timeline" aria-label="Timeline">
        <Timeline
          bus={bus}
          playhead={playhead}
          selectedClipId={selectedClipId}
          onSelect={setSelectedClipId}
        />
      </section>

      <section className="zone">
        <AgentPanel bus={bus} project={project} disabled={clips.length === 0} />
      </section>

      <footer className="zone">
        {notice && (
          <p role="alert" className="alert">
            {notice}
          </p>
        )}

        <div className="transport">
          <Transport
            playhead={playhead}
            playback={playback}
            durationMs={timelineEndMs}
            disabled={clips.length === 0}
          />

          <span className="divider" aria-hidden="true" />

          <button type="button" onClick={() => bus.undo()} disabled={!bus.canUndo}>
            Undo
          </button>
          <button type="button" onClick={() => bus.redo()} disabled={!bus.canRedo}>
            Redo
          </button>
          <button
            type="button"
            onClick={() => {
              if (!split.available) return
              bus.execute(split.command)
              setSelectedClipId(split.command.type === 'split' ? split.command.leftId : null)
            }}
            disabled={!split.available}
            title={split.available ? 'Split at the playhead (S)' : split.reason}
          >
            Split
          </button>
          <button
            type="button"
            onClick={() => {
              if (!join.available) return
              bus.execute(join.command)
              setSelectedClipId(join.command.type === 'join' ? join.command.mergedId : null)
            }}
            disabled={!join.available}
            title={join.available ? 'Join with the next clip' : join.reason}
          >
            Join
          </button>
          <button
            type="button"
            onClick={() => {
              const trackId = bus.project.tracks[0]?.id
              if (!trackId || !selectedClipId) return
              bus.execute({ type: 'delete', trackId, clipId: selectedClipId })
              setSelectedClipId(null)
            }}
            disabled={!selectedClipId}
            title={selectedClipId ? 'Delete the selected clip' : 'Select a clip to delete.'}
          >
            Delete
          </button>

          <span className="divider" aria-hidden="true" />

          <ImportButton onImported={handleImported} />
          <ExportButton project={project} disabled={clips.length === 0} />

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
