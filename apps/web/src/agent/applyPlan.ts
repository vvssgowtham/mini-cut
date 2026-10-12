/**
 * Turning an agent plan into editor commands.
 *
 * The last link in the safety chain. The server validated the model's reply against the schema and
 * against the timeline, but the browser validates again before applying — the response crossed a
 * network, and a client that trusts a server response blindly is one compromised or stale server
 * away from a corrupted project.
 *
 * Everything goes through `executeGroup`, so a fifteen-delete "remove the silent parts" is one
 * ctrl+Z, not fifteen.
 */

import { agentPlanSchema, type AgentOperation, type AgentPlan } from '@mini-cut/shared'
import type { Command } from '../editor/commands'
import type { CommandBus } from '../editor/history'
import { clipEnd, type Project } from '../editor/types'

export class PlanRejectedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PlanRejectedError'
  }
}

/** Ids are generated here, not by the model: a split needs two, and they must be unique locally. */
function newId(): string {
  return crypto.randomUUID()
}

/**
 * Convert one operation into a command for the track that holds its clip.
 *
 * The agent's vocabulary has no track: a model asked to cut a video should not have to reason about
 * which row a clip sits on, so the clip id is resolved to its track here.
 */
function toCommand(operation: AgentOperation, project: Project): Command {
  for (const track of project.tracks) {
    const clip = track.clips.find((candidate) => candidate.id === operation.clipId)
    if (!clip) continue

    switch (operation.type) {
      case 'trim':
        if (operation.sourceOut <= operation.sourceIn) {
          throw new PlanRejectedError(`trim of "${clip.id}" would leave it empty`)
        }
        return {
          type: 'trim',
          trackId: track.id,
          clipId: clip.id,
          sourceIn: operation.sourceIn,
          sourceOut: operation.sourceOut,
        }

      case 'move':
        return { type: 'move', trackId: track.id, clipId: clip.id, start: operation.start }

      case 'delete':
        return { type: 'delete', trackId: track.id, clipId: clip.id }

      case 'split': {
        if (operation.atMs <= clip.start || operation.atMs >= clipEnd(clip)) {
          throw new PlanRejectedError(
            `split of "${clip.id}" at ${operation.atMs}ms falls outside the clip`,
          )
        }
        return {
          type: 'split',
          trackId: track.id,
          clipId: clip.id,
          atMs: operation.atMs,
          leftId: newId(),
          rightId: newId(),
        }
      }
    }
  }

  throw new PlanRejectedError(`no clip "${operation.clipId}" on the timeline`)
}

/**
 * Parse and check a plan against the current project without applying it.
 *
 * Separate from applying so the preview can be built from exactly what would run, rather than from
 * a hopeful description of it.
 */
export function planToCommands(rawPlan: unknown, project: Project): Command[] {
  const parsed = agentPlanSchema.safeParse(rawPlan)
  if (!parsed.success) {
    throw new PlanRejectedError(parsed.error.issues[0]?.message ?? 'unusable edit')
  }
  return parsed.data.operations.map((operation) => toCommand(operation, project))
}

/**
 * Apply a plan as a single undoable step.
 *
 * `executeGroup` applies none of the commands if any of them fails, so a plan cannot leave the
 * project half-edited.
 */
export function applyPlan(bus: CommandBus, plan: AgentPlan): void {
  bus.executeGroup(planToCommands(plan, bus.project))
}
