/**
 * Split, Join and Delete for the selected clip.
 *
 * Its own component for a performance reason, not a tidiness one. Whether Split is possible depends
 * on the playhead, which moves every frame during playback. Subscribing to that from `App` re-rendered
 * the whole editor sixty times a second — the canvas, the video, the agent panel — and made editing
 * feel like it was sticking.
 *
 * The subscription here returns a **boolean**, so `useSyncExternalStore` bails out while the answer
 * is unchanged. Crossing a clip edge re-renders three buttons; every other frame renders nothing.
 */

import { useCallback, useSyncExternalStore } from 'react'
import { closeGapAvailability, joinAvailability, splitAvailability } from '../editor/clipActions'
import type { CommandBus } from '../editor/history'
import type { Project } from '../editor/types'
import type { PlayheadStore } from '../media/playhead'

export type ClipActionsProps = {
  bus: CommandBus
  project: Project
  playhead: PlayheadStore
  selectedClipId: string | null
  onSelect: (clipId: string | null) => void
  disabled?: boolean
}

export function ClipActions({
  bus,
  project,
  playhead,
  selectedClipId,
  onSelect,
  disabled,
}: ClipActionsProps) {
  // A boolean snapshot, so a moving playhead only re-renders when the answer actually changes.
  const canSplit = useSyncExternalStore(
    useCallback((onChange: () => void) => playhead.subscribe(onChange), [playhead]),
    () => splitAvailability(project, selectedClipId, playhead.ms).available,
  )

  // Read once per render for the tooltip; the boolean above is what drives re-rendering.
  const split = splitAvailability(project, selectedClipId, playhead.ms)
  const join = joinAvailability(project, selectedClipId)
  const closeGap = closeGapAvailability(project, selectedClipId)

  return (
    <>
      <button
        type="button"
        onClick={() => {
          const action = splitAvailability(project, selectedClipId, playhead.ms)
          if (!action.available || action.command.type !== 'split') return
          bus.execute(action.command)
          onSelect(action.command.leftId)
        }}
        disabled={disabled || !canSplit}
        title={split.available ? 'Split at the playhead (S)' : split.reason}
      >
        Split
      </button>

      <button
        type="button"
        onClick={() => {
          if (!join.available || join.command.type !== 'join') return
          bus.execute(join.command)
          onSelect(join.command.mergedId)
        }}
        disabled={disabled || !join.available}
        title={join.available ? 'Put the two halves of a split back together (J)' : join.reason}
      >
        Rejoin
      </button>

      <button
        type="button"
        onClick={() => {
          if (!closeGap.available) return
          // One group: a ripple moves every later clip, and all of it is one ctrl+Z.
          bus.executeGroup(closeGap.commands)
        }}
        disabled={disabled || !closeGap.available}
        title={
          closeGap.available
            ? `Pull this clip back ${Math.round(closeGap.closedMs / 100) / 10}s and bring the rest with it`
            : closeGap.reason
        }
      >
        Close gap
      </button>

      <button
        type="button"
        onClick={() => {
          const trackId = bus.project.tracks[0]?.id
          if (!trackId || !selectedClipId) return
          bus.execute({ type: 'delete', trackId, clipId: selectedClipId })
          onSelect(null)
        }}
        disabled={disabled || !selectedClipId}
        title={selectedClipId ? 'Delete the selected clip' : 'Select a clip to delete.'}
      >
        Delete
      </button>
    </>
  )
}
