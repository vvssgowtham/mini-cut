/**
 * The agent endpoint: plain language in, validated timeline operations out.
 *
 * Two rules shape this file.
 *
 * **Nothing the model returns is trusted.** Its reply is parsed against `agentPlanSchema`, and then
 * every operation is checked against the clips that actually exist — a model will cheerfully invent
 * a clip id, or split at a point outside the clip. Validation that only checks shape would let both
 * through.
 *
 * **The media never leaves the browser.** Only clip timings are sent. A 2 GB upload per instruction
 * would be slow, expensive and a needless disclosure, and the model does not need the pictures to
 * decide where to cut.
 */

import Anthropic from '@anthropic-ai/sdk'
import {
  agentPlanSchema,
  type AgentOperation,
  type AgentPlan,
  type AgentRequest,
} from '@mini-cut/shared'

/** Latest Claude Sonnet: the reasoning here is light, and latency matters more than depth. */
const MODEL = 'claude-sonnet-5-5'
const MAX_TOKENS = 2048

const SYSTEM_PROMPT = `You edit a video timeline by returning operations.

The timeline is a list of clips. Each clip has an id, a source window (sourceIn to sourceOut, in
milliseconds of the source media) and a start position on the timeline (also milliseconds).
A clip occupies start .. start + (sourceOut - sourceIn).

Return operations of these types only:
- trim:   { "type": "trim", "clipId", "sourceIn", "sourceOut" } — change which part of the source is shown
- move:   { "type": "move", "clipId", "start" } — move the clip along the timeline
- split:  { "type": "split", "clipId", "atMs" } — cut in two at an absolute timeline position strictly inside the clip
- delete: { "type": "delete", "clipId" } — remove the clip

Rules:
- Only use clip ids present in the timeline you are given.
- All times are integer milliseconds and never negative.
- sourceOut must be greater than sourceIn.
- To remove the first N seconds of a clip, trim its sourceIn forward; do not move it.
- If the instruction cannot be carried out with these operations, say so in the summary and return
  an empty operations array.

You may also be given "silences": quiet stretches in timeline milliseconds, already measured from
the audio. Use them rather than guessing where speech pauses. Removing a silence inside a clip
means splitting around it and deleting the middle piece; work from the last silence backwards so
earlier positions stay valid as the timeline changes.

Reply with the submit_edit tool only.`

const EDIT_TOOL: Anthropic.Tool = {
  name: 'submit_edit',
  description: 'Submit the timeline operations that carry out the instruction.',
  input_schema: {
    type: 'object',
    properties: {
      summary: {
        type: 'string',
        description: "One plain sentence describing the change, in the user's terms.",
      },
      operations: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            type: { type: 'string', enum: ['trim', 'move', 'split', 'delete'] },
            clipId: { type: 'string' },
            sourceIn: { type: 'integer' },
            sourceOut: { type: 'integer' },
            start: { type: 'integer' },
            atMs: { type: 'integer' },
          },
          required: ['type', 'clipId'],
        },
      },
    },
    required: ['summary', 'operations'],
  },
}

export class AgentError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AgentError'
  }
}

/** The model call, injected so the route can be tested without a network or an API key. */
export type EditPlanner = (request: AgentRequest) => Promise<unknown>

export function createAnthropicPlanner(apiKey: string): EditPlanner {
  const client = new Anthropic({ apiKey })

  return async (request) => {
    const message = await client.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: SYSTEM_PROMPT,
      tools: [EDIT_TOOL],
      tool_choice: { type: 'tool', name: EDIT_TOOL.name },
      messages: [
        {
          role: 'user',
          content: [
            `Timeline:\n${JSON.stringify(request.clips, null, 2)}`,
            request.silences?.length
              ? `Silences:\n${JSON.stringify(request.silences, null, 2)}`
              : null,
            `Instruction: ${request.instruction}`,
          ]
            .filter(Boolean)
            .join('\n\n'),
        },
      ],
    })

    const toolUse = message.content.find((block) => block.type === 'tool_use')
    if (!toolUse) throw new AgentError('the model did not return an edit')
    return toolUse.input
  }
}

/**
 * Check operations against the timeline they will be applied to.
 *
 * Shape validation is not enough. A model will reference a clip that does not exist, or split at a
 * point outside the clip, and both parse perfectly well — so the ids and ranges are checked here,
 * before anything reaches the bus.
 */
export function validateAgainstTimeline(
  operations: readonly AgentOperation[],
  clips: AgentRequest['clips'],
): void {
  const byId = new Map(clips.map((clip) => [clip.id, clip]))

  for (const operation of operations) {
    const clip = byId.get(operation.clipId)
    if (!clip) throw new AgentError(`no clip "${operation.clipId}" on the timeline`)

    if (operation.type === 'trim') {
      if (operation.sourceOut <= operation.sourceIn) {
        throw new AgentError(`trim of "${clip.id}" would leave it empty`)
      }
    }

    if (operation.type === 'split') {
      const end = clip.start + (clip.sourceOut - clip.sourceIn)
      if (operation.atMs <= clip.start || operation.atMs >= end) {
        throw new AgentError(
          `split of "${clip.id}" at ${operation.atMs}ms is outside the clip (${clip.start}..${end})`,
        )
      }
    }
  }
}

/** Ask the planner, then validate what came back twice: shape, then against the real timeline. */
export async function planEdit(planner: EditPlanner, request: AgentRequest): Promise<AgentPlan> {
  const raw = await planner(request)

  const parsed = agentPlanSchema.safeParse(raw)
  if (!parsed.success) {
    throw new AgentError(`the model returned an unusable edit: ${parsed.error.issues[0]?.message}`)
  }

  // The model saying "I cannot do that" is an answer, not a malfunction — so its own sentence is
  // what reaches the user, rather than a generic failure.
  if (parsed.data.operations.length === 0) {
    throw new AgentError(parsed.data.summary)
  }

  validateAgainstTimeline(parsed.data.operations, request.clips)
  return parsed.data
}
