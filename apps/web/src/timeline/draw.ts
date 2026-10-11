/**
 * Drawing the timeline onto a 2D canvas.
 *
 * One canvas, redrawn whole on each frame. That sounds wasteful but is not: `visibleClips` culls to
 * what is on screen, so the work is bounded by the canvas width rather than by project length. A
 * thousand-clip project draws the same amount as a ten-clip one when zoomed in.
 *
 * `drawTimeline` takes the context as an argument and reads nothing global, so the tests drive it
 * with a recording stub and assert on the calls — no browser, no `jsdom` canvas shim.
 */

import { clipEnd, type Clip, type Ms } from '../editor/types'
import { timeToX, visibleClips, type Viewport } from './viewport'

export type TimelineTheme = {
  background: string
  clipFill: string
  clipStroke: string
  playhead: string
}

export const defaultTheme: TimelineTheme = {
  background: '#1a1a1e',
  clipFill: '#3b5bdb',
  clipStroke: '#748ffc',
  playhead: '#ff6b6b',
}

/** Vertical layout, in CSS pixels. */
export const CLIP_TOP_PX = 12
export const CLIP_HEIGHT_PX = 56

export type TimelineScene = {
  viewport: Viewport
  clips: readonly Clip[]
  playheadMs: Ms
  /** Canvas height in CSS pixels. */
  heightPx: number
  /**
   * `window.devicePixelRatio`. The canvas backing store is this many times larger than its CSS size,
   * so everything is drawn through a matching transform — otherwise the result is blurry on a
   * retina display.
   */
  devicePixelRatio: number
  theme?: TimelineTheme
}

/** Draw one frame. Clears first, so the caller never has to. */
export function drawTimeline(ctx: CanvasRenderingContext2D, scene: TimelineScene): void {
  const {
    viewport,
    clips,
    playheadMs,
    heightPx,
    devicePixelRatio: dpr,
    theme = defaultTheme,
  } = scene

  ctx.save()
  // setTransform, not scale: scale compounds, and this runs every frame.
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

  ctx.fillStyle = theme.background
  ctx.fillRect(0, 0, viewport.widthPx, heightPx)

  for (const clip of visibleClips(viewport, clips)) {
    const x = timeToX(viewport, clip.start)
    const width = (clipEnd(clip) - clip.start) * viewport.pxPerMs

    ctx.fillStyle = theme.clipFill
    ctx.fillRect(x, CLIP_TOP_PX, width, CLIP_HEIGHT_PX)
    ctx.strokeStyle = theme.clipStroke
    ctx.strokeRect(x, CLIP_TOP_PX, width, CLIP_HEIGHT_PX)
  }

  const playheadX = timeToX(viewport, playheadMs)
  if (playheadX >= 0 && playheadX <= viewport.widthPx) {
    ctx.fillStyle = theme.playhead
    ctx.fillRect(playheadX, 0, 1, heightPx)
  }

  ctx.restore()
}
