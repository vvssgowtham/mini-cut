/**
 * CommandBus: holds the current project and the undo/redo stacks.
 *
 * Everything that changes a project goes through here — keyboard shortcuts, dragging on the canvas
 * (M3), and accepted AI edits (M7). That single funnel is what makes the agent safe: it cannot
 * reach the project except as validated ops.
 *
 * Listeners: M5's autosave subscribes to persist on change, M3's canvas subscribes to redraw.
 */

import { apply, type Command, type Op } from './commands'
import type { Project } from './types'

/** One entry on a stack: the ops that were applied, and the ops that undo them. */
export type HistoryEntry = {
  ops: Op[]
  /** Inverses in the order they must be applied to undo this entry (reverse of `ops`). */
  inverses: Op[]
}

export type Unsubscribe = () => void

export class CommandBus {
  #project: Project
  #undoStack: HistoryEntry[] = []
  #redoStack: HistoryEntry[] = []
  #listeners = new Set<(project: Project) => void>()

  constructor(initial: Project) {
    this.#project = initial
  }

  /** The current project. Always the latest value; never mutate what this returns. */
  get project(): Project {
    return this.#project
  }

  get canUndo(): boolean {
    return this.#undoStack.length > 0
  }

  get canRedo(): boolean {
    return this.#redoStack.length > 0
  }

  /**
   * Swap in a different project and throw away the history.
   *
   * For opening a file or restoring a session — not for editing. The history goes because its
   * inverses describe a project that is no longer loaded: undoing a trim from the previous file
   * against this one would reference clip ids that do not exist here.
   */
  replace(project: Project): void {
    this.#project = project
    this.#undoStack = []
    this.#redoStack = []
    this.#notify()
  }

  /**
   * Apply one command, push it onto the undo stack, and CLEAR THE REDO STACK.
   *
   * Clearing redo is the part people forget. Once you undo and then make a different edit, the
   * future you undid is no longer reachable — keeping it would let redo apply an op to a project
   * that no longer matches the state it was recorded against.
   */
  execute(command: Command): void {
    // One command is just a group of one, so the two can never drift apart.
    this.executeGroup([command])
  }

  /**
   * Apply several commands as ONE undo entry.
   *
   * M7 needs this: accepting "remove the silent parts" may be fifteen deletes, and the user expects
   * one ctrl+Z to take all of it back. If any command throws, apply none of them — roll back the
   * ones already applied so the project is never left half-edited.
   */
  executeGroup(commands: Command[]): void {
    if (commands.length === 0) return

    // Build the result on a local variable and only commit it to the bus at the end. Because
    // `apply` is pure, a throw anywhere below leaves `#project` untouched — that IS the rollback.
    let project = this.#project
    const inverses: Op[] = []
    for (const command of commands) {
      const result = apply(project, command)
      project = result.project
      // Unshift: undo runs the inverses in reverse order, last command undone first.
      inverses.unshift(result.inverse)
    }

    this.#undoStack.push({ ops: [...commands], inverses })
    this.#redoStack = []
    this.#project = project
    this.#notify()
  }

  /** Undo the last entry. No-op when the undo stack is empty. */
  undo(): void {
    const entry = this.#undoStack.pop()
    if (!entry) return

    this.#project = this.#applyAll(entry.inverses)
    this.#redoStack.push(entry)
    this.#notify()
  }

  /** Redo the last undone entry. No-op when the redo stack is empty. */
  redo(): void {
    const entry = this.#redoStack.pop()
    if (!entry) return

    this.#project = this.#applyAll(entry.ops)
    this.#undoStack.push(entry)
    this.#notify()
  }

  /** Call `listener` after every change. Returns a function that removes it. */
  subscribe(listener: (project: Project) => void): Unsubscribe {
    this.#listeners.add(listener)
    return () => {
      this.#listeners.delete(listener)
    }
  }

  /** Run a list of ops in order, each one on the output of the last. */
  #applyAll(ops: Op[]): Project {
    let project = this.#project
    for (const op of ops) {
      project = apply(project, op).project
    }
    return project
  }

  #notify(): void {
    for (const listener of this.#listeners) {
      listener(this.#project)
    }
  }
}
