/**
 * CommandBus: holds the current project and the undo/redo stacks.
 *
 * Everything that changes a project goes through here — keyboard shortcuts, dragging on the canvas
 * (M3), and accepted AI edits (M7). That single funnel is what makes the agent safe: it cannot
 * reach the project except as validated ops.
 *
 * Listeners: M5's autosave subscribes to persist on change, M3's canvas subscribes to redraw.
 */

import type { Command, Op } from './commands'
import type { Project } from './types'

/** One entry on a stack: the ops that were applied, and the ops that undo them. */
export type HistoryEntry = {
  ops: Op[]
  /** Inverses in the order they must be applied to undo this entry (reverse of `ops`). */
  inverses: Op[]
}

export type Unsubscribe = () => void

export class CommandBus {
  // Suggested fields (adjust as you like):
  //   #project: Project
  //   #undoStack: HistoryEntry[] = []
  //   #redoStack: HistoryEntry[] = []
  //   #listeners = new Set<(project: Project) => void>()

  constructor(_initial: Project) {
    throw new Error('not implemented: CommandBus constructor')
  }

  /** The current project. Always the latest value; never mutate what this returns. */
  get project(): Project {
    throw new Error('not implemented: project')
  }

  get canUndo(): boolean {
    throw new Error('not implemented: canUndo')
  }

  get canRedo(): boolean {
    throw new Error('not implemented: canRedo')
  }

  /**
   * Apply one command, push it onto the undo stack, and CLEAR THE REDO STACK.
   *
   * Clearing redo is the part people forget. Once you undo and then make a different edit, the
   * future you undid is no longer reachable — keeping it would let redo apply an op to a project
   * that no longer matches the state it was recorded against.
   */
  execute(_command: Command): void {
    throw new Error('not implemented: execute')
  }

  /**
   * Apply several commands as ONE undo entry.
   *
   * M7 needs this: accepting "remove the silent parts" may be fifteen deletes, and the user expects
   * one ctrl+Z to take all of it back. If any command throws, apply none of them — roll back the
   * ones already applied so the project is never left half-edited.
   */
  executeGroup(_commands: Command[]): void {
    throw new Error('not implemented: executeGroup')
  }

  /** Undo the last entry. No-op when the undo stack is empty. */
  undo(): void {
    throw new Error('not implemented: undo')
  }

  /** Redo the last undone entry. No-op when the redo stack is empty. */
  redo(): void {
    throw new Error('not implemented: redo')
  }

  /** Call `listener` after every change. Returns a function that removes it. */
  subscribe(_listener: (project: Project) => void): Unsubscribe {
    throw new Error('not implemented: subscribe')
  }
}
