import Fastify from 'fastify'
import { agentRequestSchema, type AgentResponse, type HealthResponse } from '@mini-cut/shared'
import { AgentError, createAnthropicPlanner, planEdit, type EditPlanner } from './agent'

export type AppOptions = {
  /** Injected in tests; in production it is built from ANTHROPIC_API_KEY. */
  planner?: EditPlanner
}

export function buildApp(options: AppOptions = {}) {
  const app = Fastify({
    logger: process.env.NODE_ENV !== 'test',
    // A timeline of clip metadata is small. The cap keeps a runaway client from queueing megabytes
    // of JSON ahead of the model call.
    bodyLimit: 1024 * 1024,
  })

  const apiKey = process.env.ANTHROPIC_API_KEY
  const planner = options.planner ?? (apiKey ? createAnthropicPlanner(apiKey) : null)

  app.get('/api/health', async (): Promise<HealthResponse> => ({ status: 'ok' }))

  app.post('/api/agent', async (request, reply): Promise<AgentResponse> => {
    if (!planner) {
      reply.code(503)
      return { ok: false, error: 'the agent is not configured: ANTHROPIC_API_KEY is not set' }
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
