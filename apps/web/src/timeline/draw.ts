/**
 * Drawing the timeline.
 *
 * Three bands, drawn back to front: a ruler, the clip track, then the playhead over everything so it
 * is never lost behind a clip.
 *
 * The whole canvas is redrawn each frame. That sounds wasteful and is not: `visibleClips` and
 * `tickPositions` both cull to the viewport, so the cost is bounded by canvas width rather than
 * project length — a thousand-clip project costs the same as a ten-clip one at the same zoom.
 *
 * `drawTimeline` takes its context as an argument and reads nothing global, so the tests drive it
 * with a recording stub instead of a browser.
 */

import { clipEnd, type Clip, type Ms } from '../editor/types'
import { formatTimecode } from '../media/timecode'
import { chooseTickIntervalMs, isMajorTick, tickPositions } from './ticks'
import { timeToX, visibleClips, visibleRange, type Viewport } from './viewport'

export type TimelineTheme = {
  rulerBackground: string
  rulerLine: string
  rulerText: string
  trackBackground: string
  clipTop: string
  clipBottom: string
  clipStroke: string
  clipText: string
  clipSelectedStroke: string
  handle: string
  playhead: string
}

/** Mirrors the tokens in `index.css`; a canvas cannot read CSS variables. */
export const defaultTheme: TimelineTheme = {
  rulerBackground: '#12161a',
  rulerLine: '#39434b',
  rulerText: '#7c8792',
  trackBackground: '#171b1e',
  // Clips get a slight vertical gradient so they read as objects sitting on the track rather than
  // holes cut out of it.
  clipTop: '#2f3a42',
  clipBottom: '#222a30',
  clipStroke: '#434f58',
  clipText: '#dde3e8',
  clipSelectedStroke: '#f0a848',
  handle: '#5c6872',
  playhead: '#f0a848',
}

/** Vertical layout, in CSS pixels. */
export const RULER_HEIGHT_PX = 26
export const CLIP_TOP_PX = RULER_HEIGHT_PX + 10
export const CLIP_HEIGHT_PX = 62
export const TIMELINE_HEIGHT_PX = CLIP_TOP_PX + CLIP_HEIGHT_PX + 10

const CLIP_RADIUS_PX = 4
const CLIP_PADDING_PX = 8
/** Below this a clip is a sliver, and a label would be unreadable mush. */
const LABEL_MIN_WIDTH_PX = 54
const TICK_MIN_SPACING_PX = 72
const LABEL_EVERY = 2
const PLAYHEAD_HEAD_PX = 7

export type TimelineScene = {
  viewport: Viewport
  clips: readonly Clip[]
  playheadMs: Ms
  heightPx: number
  /**
   * `window.devicePixelRatio`. The backing store is this many times larger than the CSS size, so
   * everything is drawn through a matching transform — otherwise it is blurry on a retina display.
   */
  devicePixelRatio: number
  selectedClipId?: string | null
  hoveredClipId?: string | null
  theme?: TimelineTheme
}

function drawRuler(
  ctx: CanvasRenderingContext2D,
  scene: TimelineScene,
  theme: TimelineTheme,
): void {
  const { viewport } = scene
  const { startMs, endMs } = visibleRange(viewport)

  ctx.fillStyle = theme.rulerBackground
  ctx.fillRect(0, 0, viewport.widthPx, RULER_HEIGHT_PX)

  const interval = chooseTickIntervalMs(viewport.pxPerMs, TICK_MIN_SPACING_PX)
  ctx.font = '11px ui-monospace, monospace'
  ctx.textBaseline = 'middle'

  for (const ms of tickPositions(startMs, endMs, interval)) {
    const x = Math.round(timeToX(viewport, ms))
    const major = isMajorTick(ms, interval, LABEL_EVERY)

    ctx.fillStyle = theme.rulerLine
    ctx.fillRect(x, major ? 6 : 13, 1, RULER_HEIGHT_PX - (major ? 6 : 13))

    if (major) {
      ctx.fillStyle = theme.rulerText
      ctx.fillText(formatTimecode(ms), x + 5, RULER_HEIGHT_PX / 2)
    }
  }

  ctx.fillStyle = theme.rulerLine
  ctx.fillRect(0, RULER_HEIGHT_PX - 1, viewport.widthPx, 1)
}

function drawClip(
  ctx: CanvasRenderingContext2D,
  clip: Clip,
  scene: TimelineScene,
  theme: TimelineTheme,
): void {
  const { viewport } = scene
  const x = timeToX(viewport, clip.start)
  const width = (clipEnd(clip) - clip.start) * viewport.pxPerMs
  const selected = scene.selectedClipId === clip.id
  const hovered = scene.hoveredClipId === clip.id

  const gradient = ctx.createLinearGradient(0, CLIP_TOP_PX, 0, CLIP_TOP_PX + CLIP_HEIGHT_PX)
  gradient.addColorStop(0, theme.clipTop)
  gradient.addColorStop(1, theme.clipBottom)

  ctx.beginPath()
  ctx.roundRect(x, CLIP_TOP_PX, width, CLIP_HEIGHT_PX, CLIP_RADIUS_PX)
  ctx.fillStyle = gradient
  ctx.fill()
  ctx.lineWidth = selected ? 2 : 1
  ctx.strokeStyle = selected ? theme.clipSelectedStroke : theme.clipStroke
  ctx.stroke()

  // Trim handles appear on hover rather than always: two bars on every clip would read as busier
  // than the footage.
  if (hovered || selected) {
    ctx.fillStyle = theme.handle
    for (const handleX of [x + 3, x + width - 5]) {
      ctx.fillRect(handleX, CLIP_TOP_PX + 14, 2, CLIP_HEIGHT_PX - 28)
    }
  }

  if (width < LABEL_MIN_WIDTH_PX) return

  // Clip to the clip's own box so a long name cannot spill onto its neighbour.
  ctx.save()
  ctx.beginPath()
  ctx.rect(x, CLIP_TOP_PX, width - CLIP_PADDING_PX, CLIP_HEIGHT_PX)
  ctx.clip()

  ctx.fillStyle = theme.clipText
  ctx.font = '11px system-ui, sans-serif'
  ctx.textBaseline = 'middle'
  ctx.fillText(clip.sourceId, x + CLIP_PADDING_PX, CLIP_TOP_PX + 16)

  ctx.fillStyle = theme.rulerText
  ctx.font = '11px ui-monospace, monospace'
  ctx.fillText(formatTimecode(clipEnd(clip) - clip.start), x + CLIP_PADDING_PX, CLIP_TOP_PX + 34)

  ctx.restore()
}

function drawPlayhead(
  ctx: CanvasRenderingContext2D,
  scene: TimelineScene,
  theme: TimelineTheme,
): void {
  const x = timeToX(scene.viewport, scene.playheadMs)
  if (x < 0 || x > scene.viewport.widthPx) return

  const pixelX = Math.round(x)
  ctx.fillStyle = theme.playhead
  ctx.fillRect(pixelX, 0, 1, scene.heightPx)

  // A head to grab, and to find the line against busy clips.
  ctx.beginPath()
  ctx.moveTo(pixelX - PLAYHEAD_HEAD_PX, 0)
  ctx.lineTo(pixelX + PLAYHEAD_HEAD_PX, 0)
  ctx.lineTo(pixelX, PLAYHEAD_HEAD_PX + 3)
  ctx.closePath()
  ctx.fill()
}

/** Draw one frame. Clears first, so the caller never has to. */
export function drawTimeline(ctx: CanvasRenderingContext2D, scene: TimelineScene): void {
  const { viewport, clips, heightPx, devicePixelRatio: dpr, theme = defaultTheme } = scene

  ctx.save()
  // setTransform, not scale: scale compounds, and this runs every frame.
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

  ctx.fillStyle = theme.trackBackground
  ctx.fillRect(0, 0, viewport.widthPx, heightPx)

  drawRuler(ctx, scene, theme)
  for (const clip of visibleClips(viewport, clips)) drawClip(ctx, clip, scene, theme)
  drawPlayhead(ctx, scene, theme)

  ctx.restore()
}
