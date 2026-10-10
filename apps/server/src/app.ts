import Fastify from 'fastify'
import type { HealthResponse } from '@mini-cut/shared'

export function buildApp() {
  const app = Fastify({ logger: process.env.NODE_ENV !== 'test' })

  app.get('/api/health', async (): Promise<HealthResponse> => ({ status: 'ok' }))

  return app
}
