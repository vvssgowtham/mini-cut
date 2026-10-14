/**
 * The timeline canvas and its pointer interaction.
 *
 * Deliberately thin: the arithmetic lives in `viewport.ts`, the rendering in `draw.ts`, and the
 * pointer maths in `hitTest.ts`, all of which are unit tested. What is left here is the part that
 * genuinely needs a browser — element refs, pointer capture, resize, and the animation frame.
 *
 * Two rules from `docs/ARCHITECTURE.md` shape this file:
 *
 * - **The playhead is not React state.** It lives in a ref and is drawn directly. Putting it in state
 *   would re-render the tree on every frame of playback.
 * - **Every edit goes through the command bus.** A drag paints a local preview, then dispatches one
 *   command on release — so a drag is one undo step, not one per pointermove.
 *
 * M3 scope: a single track. Multi-track hit-testing comes with the track UI.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { CommandBus } from '../editor/history'
import { useProject } from '../editor/useProject'
import type { PlayheadStore } from '../media/playhead'
import { clipEnd, type Clip, type Ms } from '../editor/types'
import { drawTimeline, TIMELINE_HEIGHT_PX } from './draw'
import { hitTest, type Hit } from './hitTest'
import { applyKeyAction, keyToAction } from './keyboard'
import {
  clampOffset,
  normalizeWheelDelta,
  panBy,
  scrollToReveal,
  xToTime,
  zoomAt,
  type Viewport,
} from './viewport'

const DEFAULT_HEIGHT_PX = TIMELINE_HEIGHT_PX
const INITIAL_PX_PER_MS = 0.1
const ZOOM_PER_WHEEL_NOTCH = 1.0015

type DragState = {
  hit: Hit
  /** The clip as it was when the drag started; the preview is derived from this, never compounded. */
  original: Clip
  grabMs: Ms
  preview: Clip
}

export type TimelineProps = {
  bus: CommandBus
  /** Shared with the video player, so scrubbing here seeks the preview and vice versa. */
  playhead: PlayheadStore
  selectedClipId: string | null
  onSelect: (clipId: string | null) => void
  heightPx?: number
}

export function Timeline({
  bus,
  playhead,
  selectedClipId,
  onSelect,
  heightPx = DEFAULT_HEIGHT_PX,
}: TimelineProps) {
  const project = useProject(bus)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const viewportRef = useRef<Viewport>({ offsetMs: 0, pxPerMs: INITIAL_PX_PER_MS, widthPx: 0 })
  const dragRef = useRef<DragState | null>(null)
  const hoveredRef = useRef<string | null>(null)
  const selectedRef = useRef(selectedClipId)
  const frameRef = useRef<number | null>(null)
  const projectRef = useRef(project)
  // Announced to screen readers: a canvas has no accessible structure of its own, so without this
  // a keyboard user has no way to know what is selected or what an edit did.
  const [announcement, setAnnouncement] = useState('')

  /** Coalesce into one draw per frame: a wheel gesture can fire many events between frames. */
  /** End of the cut, so panning cannot wander off into empty space. */
  const contentEndRef = useRef(0)

  const scheduleDraw = useCallback(() => {
    if (frameRef.current !== null) return
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null

      const canvas = canvasRef.current
      // `getContext` returns null in jsdom, where the component tests run.
      const ctx = canvas?.getContext('2d')
      if (!canvas || !ctx) return

      const drag = dragRef.current
      const clips = projectRef.current.tracks[0]?.clips ?? []

      drawTimeline(ctx, {
        viewport: viewportRef.current,
        clips: drag ? clips.map((c) => (c.id === drag.preview.id ? drag.preview : c)) : clips,
        playheadMs: playhead.ms,
        heightPx,
        devicePixelRatio: window.devicePixelRatio || 1,
        selectedClipId: selectedRef.current,
        hoveredClipId: hoveredRef.current,
      })
    })
  }, [heightPx, playhead])

  // Keep the ref the draw and pointer callbacks read in step, then redraw. Both run after this
  // effect, so they always see the current project.
  useEffect(() => {
    projectRef.current = project
    contentEndRef.current = (project.tracks[0]?.clips ?? []).reduce(
      (end, clip) => Math.max(end, clipEnd(clip)),
      0,
    )
    scheduleDraw()
  }, [project, scheduleDraw])

  useEffect(() => {
    selectedRef.current = selectedClipId
    scheduleDraw()
  }, [selectedClipId, scheduleDraw])

  // Size the backing store to the element, and keep it in step with layout.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const resize = () => {
      const dpr = window.devicePixelRatio || 1
      const widthPx = canvas.clientWidth
      canvas.width = Math.round(widthPx * dpr)
      canvas.height = Math.round(heightPx * dpr)
      viewportRef.current = { ...viewportRef.current, widthPx }
      scheduleDraw()
    }

    resize()
    // Absent in jsdom.
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(resize)
    observer.observe(canvas)
    return () => observer.disconnect()
  }, [heightPx, scheduleDraw])

  // The video writes to the store during playback, and the keyboard writes to it when scrubbing.
  // Follow it: stepping frame by frame would otherwise walk the playhead straight off the edge of
  // the screen with the view never catching up.
  useEffect(
    () =>
      playhead.subscribe((ms) => {
        viewportRef.current = scrollToReveal(viewportRef.current, ms)
        scheduleDraw()
      }),
    [playhead, scheduleDraw],
  )

  useEffect(() => {
    return () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current)
      // Must be cleared, not just cancelled. StrictMode mounts, unmounts and remounts in dev, and a
      // stale id left here makes scheduleDraw's guard early-return forever: the canvas never draws
      // again. jsdom cannot catch this, because getContext returns null there.
      frameRef.current = null
    }
  }, [])

  const localPoint = (event: { clientX: number; clientY: number }) => {
    const rect = canvasRef.current?.getBoundingClientRect()
    return { x: event.clientX - (rect?.left ?? 0), y: event.clientY - (rect?.top ?? 0) }
  }

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLCanvasElement>) => {
      const action = keyToAction(event)
      if (!action) return
      event.preventDefault()

      const currentProject = projectRef.current
      const result = applyKeyAction(action, currentProject, selectedRef.current, playhead.ms)

      if (result.playheadMs !== undefined) playhead.set(result.playheadMs)
      if (result.selection !== undefined) onSelect(result.selection)
      // One group, so a two-command trim is a single undo step.
      if (result.commands.length > 0) bus.executeGroup(result.commands)

      if (result.message) {
        setAnnouncement(result.message)
        return
      }
      if (result.selection) {
        const clips = currentProject.tracks[0]?.clips ?? []
        const index = clips.findIndex((clip) => clip.id === result.selection)
        setAnnouncement(`Clip ${index + 1} of ${clips.length} selected`)
      } else if (result.playheadMs !== undefined) {
        // Left unannounced: scrubbing fires per key press and would flood a screen reader. The
        // timecode readout carries the position instead.
      } else if (result.commands.length > 0) {
        setAnnouncement(`${action.type.replace('-', ' ')} applied`)
      }
    },
    [bus, onSelect, playhead],
  )

  const handleWheel = useCallback(
    (event: React.WheelEvent<HTMLCanvasElement>) => {
      const { x } = localPoint(event)
      const viewport = viewportRef.current
      // A mouse wheel reports lines and some devices report pages; treating either as pixels makes
      // scrolling either a crawl or a leap.
      const raw = event.deltaX || event.deltaY
      const deltaPx = normalizeWheelDelta(raw, event.deltaMode, viewport.widthPx)

      viewportRef.current =
        event.ctrlKey || event.metaKey
          ? zoomAt(viewport, x, ZOOM_PER_WHEEL_NOTCH ** -deltaPx)
          : clampOffset(panBy(viewport, deltaPx), contentEndRef.current)
      scheduleDraw()
    },
    [scheduleDraw],
  )

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      const { x, y } = localPoint(event)
      const viewport = viewportRef.current
      const clips = projectRef.current.tracks[0]?.clips ?? []
      const hit = hitTest(viewport, clips, x, y)

      if (!hit) {
        // Empty space scrubs the playhead and drops the selection.
        onSelect(null)
        playhead.set(xToTime(viewport, x))
        scheduleDraw()
        return
      }

      const original = clips.find((c) => c.id === hit.clipId)
      if (!original) return

      onSelect(hit.clipId)

      event.currentTarget.setPointerCapture(event.pointerId)
      dragRef.current = { hit, original, grabMs: xToTime(viewport, x), preview: original }
    },
    [onSelect, playhead, scheduleDraw],
  )

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      const drag = dragRef.current
      if (!drag) {
        // Hover drives the trim-handle affordance, so it only redraws when it actually changes.
        const { x: hx, y: hy } = localPoint(event)
        const clips = projectRef.current.tracks[0]?.clips ?? []
        const next = hitTest(viewportRef.current, clips, hx, hy)?.clipId ?? null
        if (next !== hoveredRef.current) {
          hoveredRef.current = next
          scheduleDraw()
        }
        return
      }

      const { x } = localPoint(event)
      const deltaMs = Math.round(xToTime(viewportRef.current, x) - drag.grabMs)
      const { original } = drag

      // Always derived from `original`, so the preview cannot drift as the pointer moves.
      let preview = original
      if (drag.hit.kind === 'body') {
        preview = { ...original, start: Math.max(0, original.start + deltaMs) }
      } else if (drag.hit.kind === 'trim-start') {
        const sourceIn = Math.min(original.sourceOut - 1, Math.max(0, original.sourceIn + deltaMs))
        preview = { ...original, sourceIn, start: Math.max(0, original.start + deltaMs) }
      } else {
        preview = {
          ...original,
          sourceOut: Math.max(original.sourceIn + 1, original.sourceOut + deltaMs),
        }
      }

      dragRef.current = { ...drag, preview }
      scheduleDraw()
    },
    [scheduleDraw],
  )

  const handlePointerUp = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      const drag = dragRef.current
      dragRef.current = null
      if (!drag) return

      event.currentTarget.releasePointerCapture(event.pointerId)

      const trackId = projectRef.current.tracks[0]?.id
      const { original, preview, hit } = drag
      // One command for the whole gesture, so one ctrl+Z takes it back.
      if (trackId && hit.kind === 'body' && preview.start !== original.start) {
        bus.execute({ type: 'move', trackId, clipId: original.id, start: preview.start })
      } else if (
        trackId &&
        hit.kind !== 'body' &&
        (preview.sourceIn !== original.sourceIn || preview.sourceOut !== original.sourceOut)
      ) {
        bus.execute({
          type: 'trim',
          trackId,
          clipId: original.id,
          sourceIn: preview.sourceIn,
          sourceOut: preview.sourceOut,
        })
        if (preview.start !== original.start) {
          bus.execute({ type: 'move', trackId, clipId: original.id, start: preview.start })
        }
      }
      scheduleDraw()
    },
    [bus, scheduleDraw],
  )

  return (
    <>
      <canvas
        ref={canvasRef}
        tabIndex={0}
        role="application"
        onKeyDown={handleKeyDown}
        aria-label={`Timeline, ${(project.tracks[0]?.clips ?? []).length} clips. Arrow keys select, alt and arrows nudge, bracket keys trim to the playhead, S splits, delete removes.`}
        style={{ width: '100%', height: heightPx, display: 'block', touchAction: 'none' }}
        onWheel={handleWheel}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onPointerLeave={() => {
          if (hoveredRef.current === null) return
          hoveredRef.current = null
          scheduleDraw()
        }}
      />
      <span className="sr-only" role="status">
        {announcement}
      </span>
    </>
  )
}
