/** The spec for reading VITE_API_BASE_URL. */

import { describe, expect, it } from 'vitest'
import { normalizeApiBase } from './AgentPanel'

describe('normalizeApiBase', () => {
  const origin = 'https://mini-cut.onrender.com'

  it('keeps a plain origin', () => {
    expect(normalizeApiBase(origin)).toBe(origin)
  })

  it('is empty when unset, so the dev proxy and single-origin hosting still work', () => {
    expect(normalizeApiBase(undefined)).toBe('')
    expect(normalizeApiBase('')).toBe('')
  })

  it('drops a trailing slash', () => {
    expect(normalizeApiBase(`${origin}/`)).toBe(origin)
  })

  it('drops a pasted /api path, which is the obvious thing to paste', () => {
    // The health URL is the one most recently confirmed working, so it is what gets copied.
    expect(normalizeApiBase(`${origin}/api/health`)).toBe(origin)
    expect(normalizeApiBase(`${origin}/api`)).toBe(origin)
    expect(normalizeApiBase(`${origin}/api/`)).toBe(origin)
  })

  it('ignores surrounding whitespace', () => {
    expect(normalizeApiBase(`  ${origin}  `)).toBe(origin)
  })

  it('leaves a path that is not /api alone, in case the API is mounted under one', () => {
    expect(normalizeApiBase(`${origin}/services/editor`)).toBe(`${origin}/services/editor`)
  })

  it('builds the agent URL correctly from every accepted form', () => {
    for (const written of [origin, `${origin}/`, `${origin}/api`, `${origin}/api/health`]) {
      expect(`${normalizeApiBase(written)}/api/agent`).toBe(`${origin}/api/agent`)
    }
  })
})
