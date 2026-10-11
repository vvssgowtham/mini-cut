/**
 * React binding for the CommandBus.
 *
 * `useSyncExternalStore` rather than copying the project into `useState`: the bus is the single source
 * of truth (see `docs/ARCHITECTURE.md`), and a second copy in component state would drift the moment
 * anything dispatched outside React — which is exactly what the M7 agent will do.
 */

import { useCallback, useSyncExternalStore } from 'react'
import type { CommandBus } from './history'
import type { Project } from './types'

export function useProject(bus: CommandBus): Project {
  return useSyncExternalStore(
    useCallback((onChange: () => void) => bus.subscribe(onChange), [bus]),
    useCallback(() => bus.project, [bus]),
  )
}
