/**
 * The contract between the agent and the editor.
 *
 * This is the whole safety argument for letting a language model edit someone's project. The model
 * never touches the timeline: it returns operations in this shape, they are parsed here, and only
 * what survives the parse is handed to the command bus. Anything malformed, out of range, or simply
 * invented is rejected before it can reach the project.
 *
 * It lives in `shared` because both sides need the same definition — the server validates what the
 * model returned, and the browser validates again before applying. Two copies would drift, and the
 * drift would be a hole.
 */

import { z } from 'zod'

const msSchema = z.number().int().nonnegative()
const idSchema = z.string().min(1)

/**
 * Shapes mirror the editor's own commands in `apps/web/src/editor/commands.ts`, minus the
 * inverse-only ones: an agent may trim, move, split and delete, but `insert` and `merge` exist only
 * as undo products and are not the model's to emit.
 */
export const trimOperationSchema = z.object({
  type: z.literal('trim'),
  clipId: idSchema,
  sourceIn: msSchema,
  sourceOut: msSchema,
})

export const moveOperationSchema = z.object({
  type: z.literal('move'),
  clipId: idSchema,
  start: msSchema,
})

export const deleteOperationSchema = z.object({
  type: z.literal('delete'),
  clipId: idSchema,
})

export const splitOperationSchema = z.object({
  type: z.literal('split'),
  clipId: idSchema,
  atMs: msSchema,
})

/**
 * A discriminated union, so an unknown `type` fails on the discriminator with a clear error rather
 * than being tried against every branch and reported as four confusing ones.
 */
export const agentOperationSchema = z.discriminatedUnion('type', [
  trimOperationSchema,
  moveOperationSchema,
  deleteOperationSchema,
  splitOperationSchema,
])

/**
 * A capped list. An unbounded one lets a confused model return ten thousand deletes, and the cost of
 * reviewing that is paid by the person who asked for one cut.
 */
export const MAX_OPERATIONS = 100

export const agentPlanSchema = z.object({
  /** One plain sentence for the preview, in the user's terms: "Removes the first 10 seconds." */
  summary: z.string().min(1).max(300),
  operations: z.array(agentOperationSchema).min(1).max(MAX_OPERATIONS),
})

export type AgentOperation = z.infer<typeof agentOperationSchema>
export type AgentPlan = z.infer<typeof agentPlanSchema>

/** What the browser sends: the timeline as metadata, never the media itself. */
export const agentRequestSchema = z.object({
  instruction: z.string().min(1).max(2000),
  clips: z
    .array(
      z.object({
        id: idSchema,
        sourceIn: msSchema,
        sourceOut: msSchema,
        start: msSchema,
      }),
    )
    .min(1)
    .max(500),
})

export type AgentRequest = z.infer<typeof agentRequestSchema>

export const agentResponseSchema = z.union([
  z.object({ ok: z.literal(true), plan: agentPlanSchema }),
  z.object({ ok: z.literal(false), error: z.string() }),
])

export type AgentResponse = z.infer<typeof agentResponseSchema>
