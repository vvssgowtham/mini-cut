import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from './App'

function mockFetch(response: Partial<Response> | Error) {
  const fn =
    response instanceof Error
      ? vi.fn().mockRejectedValue(response)
      : vi.fn().mockResolvedValue(response)
  vi.stubGlobal('fetch', fn)
  return fn
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('App API health check', () => {
  it('calls /api/health and shows ok when the response matches the schema', async () => {
    const fetchMock = mockFetch({ ok: true, json: async () => ({ status: 'ok' }) })

    render(<App />)

    expect(await screen.findByText('API: ok')).toBeTruthy()
    expect(fetchMock).toHaveBeenCalledWith('/api/health', expect.anything())
  })

  it('shows down when the request fails', async () => {
    mockFetch(new Error('network'))

    render(<App />)

    expect(await screen.findByText('API: down')).toBeTruthy()
  })

  it('shows down when the body does not match the schema', async () => {
    mockFetch({ ok: true, json: async () => ({ status: 'nope' }) })

    render(<App />)

    expect(await screen.findByText('API: down')).toBeTruthy()
  })
})
