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

/**
 * Something about the setup is wrong, rather than the service being down.
 *
 * Separate from a general failure because the remedy is completely different: "the editing service
 * is unavailable" sends someone looking at their network and their code, when the answer is one
 * wrong line in a file.
 */
export class AgentConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AgentConfigError'
  }
}

/**
 * The provider is busy or rate limiting, and the same request may well succeed shortly.
 *
 * Distinct from a configuration failure because the remedy is to wait, not to change anything. The
 * first version of this classifier matched the word "model" anywhere in the reply, so "this model
 * is experiencing high demand" was reported as a retired model and sent the user to edit a setting
 * that was already correct.
 */
export class AgentBusyError extends Error {
  constructor(provider: string, detail: string) {
    super(`${provider} is busy right now: ${detail} Try again in a moment.`)
    this.name = 'AgentBusyError'
  }
}

/** The provider refused the credentials. Never carries the key or the provider's raw response. */
export class AgentAuthError extends AgentConfigError {
  constructor(provider: string) {
    super(
      `${provider} rejected the API key. Check the value in apps/server/.env — an expired key, or ` +
        `one for a different product, both look like this.`,
    )
    this.name = 'AgentAuthError'
  }
}

export class AgentError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AgentError'
  }
}

/** The model call, injected so the route can be tested without a network or an API key. */
export type EditPlanner = (request: AgentRequest) => Promise<unknown>

/** The timeline, the measured silences and the instruction — identical whichever model reads it. */
function promptFor(request: AgentRequest): string {
  return [
    `Timeline:\n${JSON.stringify(request.clips, null, 2)}`,
    request.silences?.length ? `Silences:\n${JSON.stringify(request.silences, null, 2)}` : null,
    `Instruction: ${request.instruction}`,
  ]
    .filter(Boolean)
    .join('\n\n')
}

/** Busy, rate limited or temporarily overloaded — worth retrying, not worth reconfiguring. */
function isBusy(detail: string): boolean {
  return /high demand|overload|rate.?limit|quota|try again later|temporarily/i.test(detail)
}

/** The named model is gone or was never there. */
function isMissingModel(detail: string): boolean {
  return /no longer available|not found|does not exist|not supported|unknown model/i.test(detail)
}

/** 401 and 403 mean the credentials, whichever provider said so. */
function isAuthStatus(status: unknown): boolean {
  return status === 401 || status === 403
}

export function createAnthropicPlanner(apiKey: string): EditPlanner {
  const client = new Anthropic({ apiKey })

  return async (request) => {
    const message = await client.messages
      .create({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system: SYSTEM_PROMPT,
        tools: [EDIT_TOOL],
        tool_choice: { type: 'tool', name: EDIT_TOOL.name },
        messages: [
          {
            role: 'user',
            content: promptFor(request),
          },
        ],
      })
      .catch((error: unknown) => {
        if (isAuthStatus((error as { status?: unknown }).status)) throw new AgentAuthError('Claude')
        throw error
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

/**
 * The same job through Gemini.
 *
 * Here because the planner was already injected, so supporting a second provider is a second
 * function rather than a second agent. Whatever either model returns is validated identically — the
 * safety of this feature comes from the schema and the timeline checks, not from trusting a
 * particular vendor.
 *
 * Plain fetch rather than another SDK: this is one request, and a megabyte of dependency to make it
 * is a poor trade.
 */
/**
 * Read when the planner is built, not when this module is imported.
 *
 * ES imports run before anything in the entry file, so .env had not been loaded yet at module
 * scope — which meant the documented override silently did nothing from a file and only worked
 * from a real environment variable.
 */
const geminiModel = () => process.env.GEMINI_MODEL ?? 'gemini-3.5-flash'

/**
 * Gemini accepts a subset of JSON Schema, and rejects a declaration containing keywords it does not
 * know, so the tool is described separately rather than reusing the Anthropic one.
 */
const GEMINI_FUNCTION = {
  name: 'submit_edit',
  description: 'Submit the timeline operations that carry out the instruction.',
  parameters: {
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

type GeminiReply = {
  candidates?: { content?: { parts?: { functionCall?: { args?: unknown } }[] } }[]
  error?: { message?: string }
}

export function createGeminiPlanner(apiKey: string, model = geminiModel()): EditPlanner {
  return async (request) => {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        method: 'POST',
        // The key goes in a header rather than the query string, so it cannot end up in a proxy or
        // server access log.
        headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
          contents: [{ role: 'user', parts: [{ text: promptFor(request) }] }],
          tools: [{ functionDeclarations: [GEMINI_FUNCTION] }],
          // ANY forces a function call, so the model cannot answer in prose and leave nothing to parse.
          toolConfig: {
            functionCallingConfig: { mode: 'ANY', allowedFunctionNames: [GEMINI_FUNCTION.name] },
          },
          generationConfig: { maxOutputTokens: MAX_TOKENS },
        }),
      },
    )

    const body = (await response.json()) as GeminiReply
    // Gemini answers an invalid key with 400 and an explanatory message, not 401 — found by
    // sending it a deliberately wrong key — so the message has to be read as well as the status.
    const detail = body.error?.message ?? ''
    if (isAuthStatus(response.status) || /api[ _-]?key/i.test(detail)) {
      throw new AgentAuthError('Gemini')
    }
    // Order matters: "this model is experiencing high demand" mentions the model but is not a
    // problem with the model, so being busy is ruled out before anything is blamed on the name.
    if (response.status === 429 || response.status === 503 || isBusy(detail)) {
      throw new AgentBusyError('Gemini', detail)
    }

    // A model that is gone is configuration, and the provider's own message names the
    // replacement — more useful than anything this code could invent, so it passes through rather
    // than hiding behind "unavailable". Models are retired on Google's schedule, so this recurs.
    if (response.status === 404 || isMissingModel(detail)) {
      throw new AgentConfigError(
        `Gemini rejected the model "${model}": ${detail} Set GEMINI_MODEL in apps/server/.env to override it.`,
      )
    }
    if (!response.ok) {
      throw new Error(`Gemini returned ${response.status}: ${detail || 'no detail'}`)
    }

    const call = body.candidates?.[0]?.content?.parts?.find((part) => part.functionCall)
    if (!call?.functionCall?.args) throw new AgentError('the model did not return an edit')
    return call.functionCall.args
  }
}

/**
 * The same job through Groq.
 *
 * A third provider costs one more function because the planner was already injected, and Groq
 * speaks the OpenAI chat-completions dialect — so this differs from the Gemini version only in the
 * envelope, not in what is asked or what is checked afterwards.
 *
 * Worth having for a different reason than Gemini: Groq is fast and its free tier is generous,
 * which matters when a provider you were using starts rate limiting mid-demo.
 */
/** Read when the planner is built, for the same reason as the Gemini model above. */
const groqModel = () => process.env.GROQ_MODEL ?? 'openai/gpt-oss-120b'

/** OpenAI-dialect tool definition: the same shape, wrapped differently. */
const GROQ_TOOL = {
  type: 'function',
  function: {
    name: 'submit_edit',
    description: 'Submit the timeline operations that carry out the instruction.',
    parameters: GEMINI_FUNCTION.parameters,
  },
}

type GroqReply = {
  choices?: { message?: { tool_calls?: { function?: { arguments?: string } }[] } }[]
  error?: { message?: string }
}

export function createGroqPlanner(apiKey: string, model = groqModel()): EditPlanner {
  return async (request) => {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        max_tokens: MAX_TOKENS,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: promptFor(request) },
        ],
        tools: [GROQ_TOOL],
        // Forced, so the model cannot answer in prose and leave nothing to parse.
        tool_choice: { type: 'function', function: { name: GROQ_TOOL.function.name } },
      }),
    })

    const body = (await response.json()) as GroqReply
    const detail = body.error?.message ?? ''

    if (isAuthStatus(response.status)) throw new AgentAuthError('Groq')
    if (response.status === 429 || response.status === 503 || isBusy(detail)) {
      throw new AgentBusyError('Groq', detail)
    }
    if (response.status === 404 || isMissingModel(detail) || /decommission/i.test(detail)) {
      throw new AgentConfigError(
        `Groq rejected the model "${model}": ${detail} Set GROQ_MODEL in apps/server/.env to override it.`,
      )
    }
    if (!response.ok) {
      throw new Error(`Groq returned ${response.status}: ${detail || 'no detail'}`)
    }

    const args = body.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments
    if (!args) throw new AgentError('the model did not return an edit')

    // Arguments arrive as a JSON string here, unlike Gemini's parsed object. A model that emits
    // malformed JSON is the model failing, not the request being wrong.
    try {
      return JSON.parse(args) as unknown
    } catch {
      throw new AgentError('the model returned an edit that was not valid JSON')
    }
  }
}
