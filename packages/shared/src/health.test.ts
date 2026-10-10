import { describe, expect, it } from 'vitest'
import { healthResponseSchema } from './health'

describe('healthResponseSchema', () => {
  it('accepts an ok status', () => {
    expect(healthResponseSchema.parse({ status: 'ok' })).toEqual({ status: 'ok' })
  })

  it('rejects anything else', () => {
    expect(healthResponseSchema.safeParse({ status: 'down' }).success).toBe(false)
    expect(healthResponseSchema.safeParse({}).success).toBe(false)
  })
})
