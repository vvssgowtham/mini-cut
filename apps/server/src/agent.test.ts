/**
 * The spec for the agent endpoint.
 *
 * The planner is stubbed throughout, so these run with no network and no API key. The interesting
 * cases are the hostile ones: the whole safety argument for letting a model edit someone's project
 * is that nothing it returns reaches the timeline unchecked.
 */

import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import { buildApp } from './app'
import type { AgentRequest } from '@mini-cut/shared'
import {
  AgentAuthError,
  AgentBusyError,
  AgentConfigError,
  createGeminiPlanner,
  type EditPlanner,
} from './agent'

const clips = [
  { id: 'a', sourceIn: 0, sourceOut: 10_000, start: 0 },
  { id: 'b', sourceIn: 0, sourceOut: 5000, start: 10_000 },
]

/** Genuinely valid: clip 'a' shows source 0..10000, so this drops its first second. */
const validPlan = {
  summary: 'Removes the first second.',
  operations: [{ type: 'trim', clipId: 'a', sourceIn: 1000, sourceOut: 10_000 }],
}

function appWith(planner: EditPlanner) {
  const app = buildApp({ planner })
  afterAll(() => app.close())
  return app
}

const post = (app: ReturnType<typeof buildApp>, payload: unknown) =>
  app.inject({ method: 'POST', url: '/api/agent', payload: payload as object })

describe('a usable edit', () => {
  it('returns the plan', async () => {
    const app = appWith(async () => ({
      summary: 'Removes the first second.',
      operations: [{ type: 'trim', clipId: 'a', sourceIn: 1000, sourceOut: 10_000 }],
    }))

    const response = await post(app, { instruction: 'cut the first second', clips })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({ ok: true, plan: { operations: [{ type: 'trim' }] } })
  })

  it('sends the model the clips but never the media', async () => {
    const planner: EditPlanner = vi.fn(async () => validPlan)
    const app = appWith(planner)

    await post(app, { instruction: 'trim it', clips })

    const sent = JSON.stringify(vi.mocked(planner).mock.calls[0]?.[0])
    expect(sent).toContain('"id":"a"')
    expect(sent).not.toMatch(/blob:|opfs|\.mp4/i)
  })
})

describe('rejecting the caller', () => {
  it('rejects a request with no instruction', async () => {
    const app = appWith(async () => validPlan)

    expect((await post(app, { instruction: '', clips })).statusCode).toBe(400)
  })

  it('rejects a request with no clips', async () => {
    const app = appWith(async () => validPlan)

    expect((await post(app, { instruction: 'cut it', clips: [] })).statusCode).toBe(400)
  })

  it('rejects a malformed body', async () => {
    const app = appWith(async () => validPlan)

    expect((await post(app, { nope: true })).statusCode).toBe(400)
  })
})

describe('rejecting the model', () => {
  const hostile: [string, unknown][] = [
    ['a reply that is not an object', 'just some text'],
    ['a missing operations array', { summary: 'done' }],
    ['an unknown operation type', { summary: 'x', operations: [{ type: 'explode', clipId: 'a' }] }],
    [
      'a clip that does not exist',
      { summary: 'x', operations: [{ type: 'delete', clipId: 'ghost' }] },
    ],
    [
      'a negative time',
      { summary: 'x', operations: [{ type: 'move', clipId: 'a', start: -5000 }] },
    ],
    [
      'a fractional time',
      { summary: 'x', operations: [{ type: 'move', clipId: 'a', start: 1.5 }] },
    ],
    [
      'a trim that would empty the clip',
      {
        summary: 'x',
        operations: [{ type: 'trim', clipId: 'a', sourceIn: 5000, sourceOut: 5000 }],
      },
    ],
    [
      'a split outside the clip',
      { summary: 'x', operations: [{ type: 'split', clipId: 'a', atMs: 99_000 }] },
    ],
    [
      'a split exactly on the clip edge',
      { summary: 'x', operations: [{ type: 'split', clipId: 'a', atMs: 0 }] },
    ],
  ]

  for (const [label, reply] of hostile) {
    it(`refuses ${label}`, async () => {
      const app = appWith(async () => reply)

      const response = await post(app, { instruction: 'do something', clips })

      expect(response.statusCode).toBe(422)
      expect(response.json().ok).toBe(false)
    })
  }

  it('caps how many operations one instruction can produce', async () => {
    const app = appWith(async () => ({
      summary: 'delete everything, repeatedly',
      operations: Array.from({ length: 500 }, () => ({ type: 'delete', clipId: 'a' })),
    }))

    expect((await post(app, { instruction: 'delete all', clips })).statusCode).toBe(422)
  })

  it('explains what was wrong rather than failing opaquely', async () => {
    const app = appWith(async () => ({
      summary: 'x',
      operations: [{ type: 'delete', clipId: 'ghost' }],
    }))

    expect((await post(app, { instruction: 'delete it', clips })).json().error).toMatch(/ghost/)
  })
})

describe('upstream failure', () => {
  it('reports a model call that throws, without leaking the detail', async () => {
    const app = appWith(async () => {
      throw new Error('401 invalid x-api-key sk-ant-secret')
    })

    const response = await post(app, { instruction: 'cut it', clips })

    expect(response.statusCode).toBe(502)
    expect(response.json().error).not.toMatch(/sk-ant|api-key/i)
  })
})

describe('without an API key', () => {
  it('says the agent is not configured rather than pretending to work', async () => {
    const previous = process.env.ANTHROPIC_API_KEY
    delete process.env.ANTHROPIC_API_KEY
    const app = buildApp()

    const response = await post(app, { instruction: 'cut it', clips })

    expect(response.statusCode).toBe(503)
    expect(response.json().error).toMatch(/not configured/)

    await app.close()
    if (previous) process.env.ANTHROPIC_API_KEY = previous
  })
})

describe('silences', () => {
  it('passes measured silences to the model rather than making it guess', async () => {
    const planner: EditPlanner = vi.fn(async () => validPlan)
    const app = appWith(planner)

    await post(app, {
      instruction: 'remove the silent parts',
      clips,
      silences: [{ startMs: 2000, endMs: 4000 }],
    })

    expect(vi.mocked(planner).mock.calls[0]?.[0].silences).toEqual([{ startMs: 2000, endMs: 4000 }])
  })

  it('works without them, since a source may have no audio at all', async () => {
    const app = appWith(async () => validPlan)

    expect((await post(app, { instruction: 'trim it', clips })).statusCode).toBe(200)
  })

  it('rejects malformed silence ranges', async () => {
    const app = appWith(async () => validPlan)

    const response = await post(app, {
      instruction: 'cut it',
      clips,
      silences: [{ startMs: -1, endMs: 'soon' }],
    })

    expect(response.statusCode).toBe(400)
  })
})

describe('when the model cannot carry out the instruction', () => {
  it('passes its explanation through rather than a generic failure', async () => {
    const app = appWith(async () => ({
      summary: 'There is no audio on this timeline, so there are no silences to remove.',
      operations: [],
    }))

    const response = await post(app, { instruction: 'remove the silences', clips })

    expect(response.statusCode).toBe(422)
    expect(response.json().error).toMatch(/no audio on this timeline/)
  })
})

describe('provider selection', () => {
  const keys = ['ANTHROPIC_API_KEY', 'GOOGLE_API_KEY'] as const

  /** Runs `body` with only the given keys set, restoring the environment afterwards. */
  async function withOnly(
    set: Partial<Record<(typeof keys)[number], string>>,
    body: () => Promise<void>,
  ) {
    const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]))
    for (const key of keys) delete process.env[key]
    Object.assign(process.env, set)
    try {
      await body()
    } finally {
      for (const key of keys) {
        if (previous[key] === undefined) delete process.env[key]
        else process.env[key] = previous[key]
      }
    }
  }

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('uses Gemini when only a Google key is set', async () => {
    // fetch is stubbed so this never leaves the machine; the point is which provider was chosen.
    const fetched = vi.fn<(url: string | URL | Request) => Promise<Response>>(
      async () =>
        new Response(
          JSON.stringify({
            candidates: [
              {
                content: { parts: [{ functionCall: { args: { summary: 'ok', operations: [] } } }] },
              },
            ],
          }),
          { status: 200 },
        ),
    )
    vi.stubGlobal('fetch', fetched)

    await withOnly({ GOOGLE_API_KEY: 'AIza-test' }, async () => {
      const app = buildApp()
      await post(app, { instruction: 'cut it', clips })
      await app.close()
    })

    expect(fetched).toHaveBeenCalled()
    expect(String(fetched.mock.calls[0]?.[0])).toContain('generativelanguage.googleapis')
  })

  it('says which variables to set when neither is present', async () => {
    await withOnly({}, async () => {
      const app = buildApp()
      const response = await post(app, { instruction: 'cut it', clips })
      await app.close()

      expect(response.statusCode).toBe(503)
      expect(response.json().error).toMatch(/ANTHROPIC_API_KEY or GOOGLE_API_KEY/)
    })
  })
})

describe('a rejected key', () => {
  it('says the key was rejected rather than reporting an outage', async () => {
    const app = appWith(async () => {
      throw new AgentAuthError('Gemini')
    })

    const response = await post(app, { instruction: 'cut it', clips })

    expect(response.statusCode).toBe(503)
    expect(response.json().error).toMatch(/rejected the API key/)
    expect(response.json().error).toMatch(/apps\/server\/\.env/)
  })
})

describe('Gemini key rejection', () => {
  const sample: AgentRequest = { instruction: 'cut it', clips }

  function withFetch(status: number, body: unknown) {
    return vi.fn(
      async () => new Response(JSON.stringify(body), { status }),
    ) as unknown as typeof fetch
  }

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('treats a 400 about the API key as a rejected key, not a bad request', async () => {
    // Gemini reports an invalid key as 400 rather than 401, so the status alone is not enough.
    vi.stubGlobal(
      'fetch',
      withFetch(400, { error: { message: 'API key not valid. Please pass a valid API key.' } }),
    )

    await expect(createGeminiPlanner('AIzaWrong')(sample)).rejects.toBeInstanceOf(AgentAuthError)
  })

  it('still reports other failures as themselves', async () => {
    vi.stubGlobal('fetch', withFetch(503, { error: { message: 'model is overloaded' } }))

    await expect(createGeminiPlanner('AIzaFine')(sample)).rejects.toThrow(/overloaded/)
  })
})

describe('a retired model', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("passes through the provider's message, which names the replacement", async () => {
    // Models are retired on Google's schedule, so this recurs; the useful detail is theirs.
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              error: {
                message:
                  'This model models/gemini-old is no longer available. Please update your code to use models/gemini-new.',
              },
            }),
            { status: 404 },
          ),
      ),
    )

    const failure = await createGeminiPlanner(
      'AIzaFine',
      'gemini-old',
    )({
      instruction: 'cut it',
      clips,
    }).catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(AgentConfigError)
    expect((failure as Error).message).toMatch(/gemini-new/)
    expect((failure as Error).message).toMatch(/GEMINI_MODEL/)
  })

  it('reports it as configuration rather than an outage', async () => {
    const app = appWith(async () => {
      throw new AgentConfigError('Gemini rejected the model "x": gone.')
    })

    const response = await post(app, { instruction: 'cut it', clips })

    expect(response.statusCode).toBe(503)
    expect(response.json().error).toMatch(/rejected the model/)
  })
})

describe('telling a busy model from a missing one', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function replyWith(status: number, message: string) {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ error: { message } }), { status })),
    )
    return createGeminiPlanner('AIzaFine', 'gemini-test')({ instruction: 'cut it', clips })
  }

  it('treats high demand as busy, not as a bad model name', async () => {
    // The message mentions the model but is not about the model: classifying it as configuration
    // sent the user to change a setting that was already correct.
    const failure = await replyWith(
      503,
      'This model is currently experiencing high demand. Please try again later.',
    ).catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(AgentBusyError)
    expect((failure as Error).message).toMatch(/try again/i)
    expect((failure as Error).message).not.toMatch(/GEMINI_MODEL/)
  })

  it('treats a rate limit as busy', async () => {
    const failure = await replyWith(429, 'Quota exceeded.').catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(AgentBusyError)
  })

  it('still reports a model that is genuinely gone', async () => {
    const failure = await replyWith(
      404,
      'This model models/old is no longer available. Use models/new.',
    ).catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(AgentConfigError)
    expect((failure as Error).message).toMatch(/GEMINI_MODEL/)
  })

  it('asks the caller to retry rather than to reconfigure', async () => {
    const app = appWith(async () => {
      throw new AgentBusyError('Gemini', 'High demand.')
    })

    const response = await post(app, { instruction: 'cut it', clips })

    expect(response.statusCode).toBe(503)
    expect(response.headers['retry-after']).toBe('20')
  })
})
