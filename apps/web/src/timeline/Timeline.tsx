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
import type { Waveform } from '../media/waveform'
import { clipEnd, type Clip, type Ms } from '../editor/types'
import { drawTimeline, TIMELINE_HEIGHT_PX } from './draw'
import { hitTest, isScrubTarget, type Hit } from './hitTest'
import { clampStart, maxEndFor } from '../editor/placement'
import { applyKeyAction, keyToAction } from './keyboard'
import {
  clampOffset,
  fitToContent,
  normalizeWheelDelta,
  panBy,
  scrollToReveal,
  xToTime,
  zoomAt,
  zoomByCentre,
  type Viewport,
} from './viewport'

const DEFAULT_HEIGHT_PX = TIMELINE_HEIGHT_PX
const INITIAL_PX_PER_MS = 0.1
const ZOOM_PER_WHEEL_NOTCH = 1.0015

/**
 * Dragging either moves the playhead or edits a clip, and the two behave differently enough to be
 * separate cases rather than one with a flag: a scrub commits nothing, while a clip edit builds a
 * preview and dispatches a command on release.
 */
type DragState =
  | { kind: 'scrub' }
  | {
      kind: 'clip'
      hit: Hit
      /** The clip as it was when the drag started; the preview derives from this, never compounds. */
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
  /** Set once, so the parent can drive Fit and the zoom buttons from the toolbar. */
  onViewControls?: (controls: ViewControls) => void
  /** Peaks per source id, drawn inside each clip as they arrive. */
  waveforms?: ReadonlyMap<string, Waveform>
  heightPx?: number
}

export type ViewControls = {
  fit: () => void
  zoomIn: () => void
  zoomOut: () => void
}

export function Timeline({
  bus,
  playhead,
  selectedClipId,
  onSelect,
  onViewControls,
  waveforms,
  heightPx = DEFAULT_HEIGHT_PX,
}: TimelineProps) {
  const project = useProject(bus)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const viewportRef = useRef<Viewport>({ offsetMs: 0, pxPerMs: INITIAL_PX_PER_MS, widthPx: 0 })
  const dragRef = useRef<DragState | null>(null)
  const hoveredRef = useRef<string | null>(null)
  const selectedRef = useRef(selectedClipId)
  const waveformsRef = useRef(waveforms)
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
      const preview = drag?.kind === 'clip' ? drag.preview : null

      drawTimeline(ctx, {
        viewport: viewportRef.current,
        clips: preview ? clips.map((c) => (c.id === preview.id ? preview : c)) : clips,
        playheadMs: playhead.ms,
        heightPx,
        devicePixelRatio: window.devicePixelRatio || 1,
        selectedClipId: selectedRef.current,
        hoveredClipId: hoveredRef.current,
        waveforms: waveformsRef.current,
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

  useEffect(() => {
    waveformsRef.current = waveforms
    scheduleDraw()
  }, [waveforms, scheduleDraw])

  // Size the backing store to the element, and keep it in step with layout.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const resize = () => {
      rectRef.current = null
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

  const fit = useCallback(() => {
    viewportRef.current = fitToContent(viewportRef.current, contentEndRef.current)
    scheduleDraw()
  }, [scheduleDraw])

  const zoom = useCallback(
    (factor: number) => {
      viewportRef.current = clampOffset(
        zoomByCentre(viewportRef.current, factor),
        contentEndRef.current,
      )
      scheduleDraw()
    },
    [scheduleDraw],
  )

  useEffect(() => {
    onViewControls?.({ fit, zoomIn: () => zoom(1.6), zoomOut: () => zoom(1 / 1.6) })
  }, [fit, onViewControls, zoom])

  /**
   * Frame the whole cut the first time there is one.
   *
   * The working zoom shows about twelve seconds, so importing a minute of footage left most of the
   * project off screen with nothing on screen to say it was there. Only on first arrival: refitting
   * on every edit would yank the view out from under someone mid-cut.
   */
  const hasFittedRef = useRef(false)
  useEffect(() => {
    if (hasFittedRef.current || contentEndRef.current <= 0 || viewportRef.current.widthPx <= 0) {
      return
    }
    hasFittedRef.current = true
    fit()
  }, [project, fit])

  /**
   * The canvas position, read once and remembered.
   *
   * getBoundingClientRect forces the browser to settle layout before it can answer. Calling it from
   * a pointermove handler means doing that at pointer frequency — well over a hundred times a
   * second on a trackpad — which is what made dragging feel heavy. The rect only changes when the
   * element moves, so it is cached and thrown away when it might have.
   */
  const rectRef = useRef<DOMRect | null>(null)

  const localPoint = (event: { clientX: number; clientY: number }) => {
    rectRef.current ??= canvasRef.current?.getBoundingClientRect() ?? null
    const rect = rectRef.current
    return { x: event.clientX - (rect?.left ?? 0), y: event.clientY - (rect?.top ?? 0) }
  }

  /**
   * Editing shortcuts, bound to the window rather than to the canvas.
   *
   * They used to need the canvas focused, which meant they silently did nothing on page load, and
   * stopped working the moment you clicked Play or Import — focus moved to that button and never
   * came back. Nothing on screen said the canvas had to be clicked first. Editors bind these
   * globally, so this does too.
   */
  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      // Never steal a key from a field someone is typing in.
      const target = event.target as HTMLElement | null
      if (target?.closest('input, textarea, select, [contenteditable]')) return

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

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])

  /**
   * Panning and zooming the timeline, and nothing else.
   *
   * Attached natively rather than through React's `onWheel`, because React registers wheel
   * listeners as passive and silently ignores `preventDefault` in them. Without it the page scrolls
   * while the timeline pans — both move at once, which reads as the editor shaking — and ctrl and
   * wheel zooms the browser instead of the timeline.
   */
  const handleWheel = useCallback(
    (event: WheelEvent) => {
      event.preventDefault()
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

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    // passive: false is the whole point — the default is passive, where preventDefault does nothing.
    canvas.addEventListener('wheel', handleWheel, { passive: false })
    return () => canvas.removeEventListener('wheel', handleWheel)
  }, [handleWheel])

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      // Otherwise the browser begins selecting the surrounding page text mid-drag.
      event.preventDefault()

      const { x, y } = localPoint(event)
      const viewport = viewportRef.current
      const clips = projectRef.current.tracks[0]?.clips ?? []

      // Checked before the clips, so the playhead stays grabbable where it crosses one.
      if (isScrubTarget(viewport, playhead.ms, x, y)) {
        event.currentTarget.setPointerCapture(event.pointerId)
        dragRef.current = { kind: 'scrub' }
        playhead.set(xToTime(viewport, x))
        scheduleDraw()
        return
      }

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
      dragRef.current = {
        kind: 'clip',
        hit,
        original,
        grabMs: xToTime(viewport, x),
        preview: original,
      }
    },
    [onSelect, playhead, scheduleDraw],
  )

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      const drag = dragRef.current

      if (drag?.kind === 'scrub') {
        const { x } = localPoint(event)
        playhead.set(xToTime(viewportRef.current, x))
        scheduleDraw()
        return
      }

      if (!drag) {
        // Hover drives the trim-handle affordance, so it only redraws when it actually changes.
        const { x: hx, y: hy } = localPoint(event)
        const clips = projectRef.current.tracks[0]?.clips ?? []
        const over = hitTest(viewportRef.current, clips, hx, hy)
        const scrubbable = isScrubTarget(viewportRef.current, playhead.ms, hx, hy)

        // The cursor says what a press will do before you make it, which is the only affordance a
        // canvas can offer: it has no elements to style.
        const canvas = event.currentTarget
        canvas.style.cursor = scrubbable
          ? 'col-resize'
          : over?.kind === 'trim-start' || over?.kind === 'trim-end'
            ? 'ew-resize'
            : over
              ? 'grab'
              : 'default'

        const next = over?.clipId ?? null
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
        // Clamped against the neighbours: a clip dropped on top of another produces a timeline
        // that draws fine and then refuses to export.
        const clips = projectRef.current.tracks[0]?.clips ?? []
        preview = { ...original, start: clampStart(clips, original.id, original.start + deltaMs) }
      } else if (drag.hit.kind === 'trim-start') {
        const sourceIn = Math.min(original.sourceOut - 1, Math.max(0, original.sourceIn + deltaMs))
        preview = { ...original, sourceIn, start: Math.max(0, original.start + deltaMs) }
      } else {
        // Clamped so the clip cannot grow into the one after it.
        const siblings = projectRef.current.tracks[0]?.clips ?? []
        const maxDuration = maxEndFor(siblings, original.id) - original.start
        const wanted = Math.max(original.sourceIn + 1, original.sourceOut + deltaMs)
        preview = {
          ...original,
          sourceOut: Math.min(wanted, original.sourceIn + maxDuration),
        }
      }

      dragRef.current = { ...drag, preview }
      scheduleDraw()
    },
    [playhead, scheduleDraw],
  )

  const handlePointerUp = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      const drag = dragRef.current
      dragRef.current = null
      if (!drag) return

      event.currentTarget.releasePointerCapture(event.pointerId)
      // Scrubbing changed the playhead as it went and edits nothing, so there is no command.
      if (drag.kind === 'scrub') return

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
        aria-label={`Timeline, ${(project.tracks[0]?.clips ?? []).length} clips. Arrow keys select, alt and arrows nudge, bracket keys trim to the playhead, S splits, delete removes.`}
        style={{ width: '100%', height: heightPx, display: 'block', touchAction: 'none' }}
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
