/**
 * Debounced autosave.
 *
 * The bus notifies on every command, and a drag can produce one per frame. Writing each of those to
 * IndexedDB would queue hundreds of transactions behind the UI. So: coalesce into one write per quiet
 * period, and never run two writes at once — if a change lands while a write is in flight, remember
 * that one more save is owed and run it when the current one finishes.
 *
 * The `save` function is injected rather than imported, which is what lets this be tested with fake
 * timers and no database.
 */

import type { CommandBus, Unsubscribe } from '../editor/history'
import type { Project } from '../editor/types'

export const DEFAULT_DEBOUNCE_MS = 500

export type AutosaveOptions = {
  debounceMs?: number
  /** Called when a save rejects. Autosave keeps running: one failed write must not stop the next. */
  onError?: (error: unknown) => void
}

export type Autosave = {
  /** Stop listening. Any pending save is cancelled, so call `flush` first if the work matters. */
  stop: Unsubscribe
  /** Write now if anything is pending, and resolve once it has been written. */
  flush: () => Promise<void>
  /** True while a save is scheduled or running — for an "unsaved changes" indicator. */
  isPending: () => boolean
}

export function startAutosave(
  bus: CommandBus,
  save: (project: Project) => Promise<void>,
  options: AutosaveOptions = {},
): Autosave {
  const { debounceMs = DEFAULT_DEBOUNCE_MS, onError } = options

  let timer: ReturnType<typeof setTimeout> | null = null
  let inFlight: Promise<void> | null = null
  let dirty = false
  let stopped = false

  const write = async (): Promise<void> => {
    // Serialise: a second write while one is in flight would race to be last-wins in the store.
    if (inFlight) return inFlight

    dirty = false
    const project = bus.project
    let succeeded = true
    inFlight = save(project)
      .catch((error: unknown) => {
        // Still unsaved, so leave it dirty: the next change, or a flush, retries it.
        succeeded = false
        dirty = true
        onError?.(error)
      })
      .finally(() => {
        inFlight = null
      })

    await inFlight
    // A change arrived mid-write, so that project was never saved: go again. Only after a success,
    // though — retrying a failure here would spin in a tight loop against a full quota.
    if (dirty && succeeded && !stopped) await write()
  }

  const schedule = () => {
    dirty = true
    if (timer !== null) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      void write()
    }, debounceMs)
  }

  const unsubscribe = bus.subscribe(schedule)

  return {
    stop: () => {
      stopped = true
      if (timer !== null) clearTimeout(timer)
      timer = null
      unsubscribe()
    },
    flush: async () => {
      if (timer !== null) {
        clearTimeout(timer)
        timer = null
      }
      if (dirty || inFlight) await write()
    },
    isPending: () => timer !== null || inFlight !== null,
  }
}
