import { healthResponseSchema } from '@mini-cut/shared'
import { afterAll, describe, expect, it } from 'vitest'
import { buildApp } from './app'

describe('GET /api/health', () => {
  const app = buildApp()
  afterAll(() => app.close())

  it('returns 200 with a body matching the shared schema', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health' })

    expect(res.statusCode).toBe(200)
    expect(healthResponseSchema.parse(res.json())).toEqual({ status: 'ok' })
  })
})
