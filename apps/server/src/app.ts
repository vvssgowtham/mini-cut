import Fastify from 'fastify'
import cors from '@fastify/cors'
import { agentRequestSchema, type AgentResponse, type HealthResponse } from '@mini-cut/shared'
import {
  AgentBusyError,
  AgentConfigError,
  AgentError,
  createAnthropicPlanner,
  createGeminiPlanner,
  createGroqPlanner,
  planEdit,
  type EditPlanner,
} from './agent'

export type AppOptions = {
  /** Injected in tests; in production it is built from ANTHROPIC_API_KEY. */
  planner?: EditPlanner
}

/**
 * Whichever provider has a key, preferring Anthropic when both are set.
 *
 * Two providers rather than one because the planner was already injected, so the second is a second
 * function rather than a second agent. Everything either returns is validated identically: the
 * safety of this feature is the schema and the timeline checks, not the vendor.
 */
function plannerFromEnv(): EditPlanner | null {
  // Each provider's keys have a recognisable prefix, and a key that does not match one cannot
  // work. Checking here means a stale or wrong value left in .env is skipped rather than claimed:
  // without it, an old GOOGLE_API_KEY shadows a working GROQ_API_KEY further down the list and the
  // agent fails with an authentication error for a provider the user is not trying to use.
  const providers = [
    { key: process.env.ANTHROPIC_API_KEY, prefix: 'sk-ant-', build: createAnthropicPlanner },
    { key: process.env.GOOGLE_API_KEY, prefix: 'AIza', build: createGeminiPlanner },
    { key: process.env.GROQ_API_KEY, prefix: 'gsk_', build: createGroqPlanner },
  ]

  for (const { key, prefix, build } of providers) {
    if (key?.startsWith(prefix)) return build(key)
  }
  return null
}

export function buildApp(options: AppOptions = {}) {
  const app = Fastify({
    logger: process.env.NODE_ENV !== 'test',
    // A timeline of clip metadata is small. The cap keeps a runaway client from queueing megabytes
    // of JSON ahead of the model call.
    bodyLimit: 1024 * 1024,
  })

  const planner = options.planner ?? plannerFromEnv()

  /**
   * Only needed when the front end is served from another host, which is the usual shape for a
   * static site plus a container. Left off entirely when ALLOWED_ORIGIN is unset, so a
   * single-origin deployment does not quietly accept requests from anywhere.
   */
  const allowedOrigin = process.env.ALLOWED_ORIGIN
  if (allowedOrigin) {
    void app.register(cors, { origin: allowedOrigin.split(',').map((value) => value.trim()) })
  }

  app.get('/api/health', async (): Promise<HealthResponse> => ({ status: 'ok' }))

  app.post('/api/agent', async (request, reply): Promise<AgentResponse> => {
    if (!planner) {
      reply.code(503)
      return {
        ok: false,
        error:
          'The agent is not configured. Set ANTHROPIC_API_KEY, GOOGLE_API_KEY or GROQ_API_KEY in apps/server/.env.',
      }
    }

    const parsed = agentRequestSchema.safeParse(request.body)
    if (!parsed.success) {
      reply.code(400)
      return { ok: false, error: parsed.error.issues[0]?.message ?? 'invalid request' }
    }

    try {
      return { ok: true, plan: await planEdit(planner, parsed.data) }
    } catch (error) {
      // An unusable edit is the model's failure, not the caller's, so it is 422 rather than 400.
      // The message is safe to show: it describes the edit, never the key or the upstream call.
      // Busy is worth retrying, so it is 503 with a Retry-After rather than something that looks
      // like the request itself was wrong.
      if (error instanceof AgentBusyError) {
        reply.code(503).header('retry-after', '20')
        return { ok: false, error: error.message }
      }

      // Configuration, not a transient outage, so it reads as 503 and says what to change rather
      // than sending someone to look at their network.
      if (error instanceof AgentConfigError) {
        reply.code(503)
        return { ok: false, error: error.message }
      }
      if (error instanceof AgentError) {
        reply.code(422)
        return { ok: false, error: error.message }
      }
      request.log.error(error)
      reply.code(502)
      return { ok: false, error: 'the editing service is unavailable' }
    }
  })

  return app
}
