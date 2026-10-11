import { healthResponseSchema } from '@mini-cut/shared'
import { useEffect, useState } from 'react'
import { CommandBus } from './editor/history'
import type { Project } from './editor/types'
import { useProject } from './editor/useProject'
import { Timeline } from './timeline/Timeline'

type ApiStatus = 'checking' | 'ok' | 'down'

/**
 * Stand-in until M2's file import is wired to the UI: three clips so the timeline has something to
 * draw and drag.
 */
function demoProject(): Project {
  return {
    version: 1,
    durationMs: 12_000,
    tracks: [
      {
        id: 't1',
        clips: [
          { id: 'a', sourceId: 's1', sourceIn: 0, sourceOut: 3000, start: 0 },
          { id: 'b', sourceId: 's1', sourceIn: 5000, sourceOut: 8000, start: 3500 },
          { id: 'c', sourceId: 's1', sourceIn: 0, sourceOut: 2000, start: 8000 },
        ],
      },
    ],
  }
}

export default function App() {
  const [api, setApi] = useState<ApiStatus>('checking')
  // One bus for the life of the app; the lazy initialiser keeps it from being rebuilt each render.
  const [bus] = useState(() => new CommandBus(demoProject()))
  const project = useProject(bus)

  useEffect(() => {
    const controller = new AbortController()

    fetch('/api/health', { signal: controller.signal })
      .then((res) => {
        if (!res.ok) throw new Error(`Health check failed: ${res.status}`)
        return res.json()
      })
      .then((body) => {
        healthResponseSchema.parse(body)
        setApi('ok')
      })
      .catch(() => {
        if (!controller.signal.aborted) setApi('down')
      })

    return () => controller.abort()
  }, [])

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

  return (
    <main style={{ padding: 16, fontFamily: 'system-ui, sans-serif' }}>
      <h1>Mini Cut</h1>
      <p>API: {api}</p>

      <p>
        Drag a clip to move it, drag its edges to trim. Scroll to pan, ctrl or cmd and scroll to
        zoom. Click empty space to move the playhead.
      </p>

      <Timeline bus={bus} />

      <p>
        <button type="button" onClick={() => bus.undo()} disabled={!bus.canUndo}>
          Undo
        </button>{' '}
        <button type="button" onClick={() => bus.redo()} disabled={!bus.canRedo}>
          Redo
        </button>{' '}
        <span>{project.tracks[0]?.clips.length ?? 0} clips</span>
      </p>
    </main>
  )
}
