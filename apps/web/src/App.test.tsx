/**
 * App-level tests.
 *
 * jsdom has no IndexedDB, no OPFS and no canvas context, so what can be checked here is the shell:
 * that it mounts, shows the right affordances, and does not fall over when none of those browser
 * APIs exist. Importing, drawing and persistence need a real browser.
 */

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import App from './App'

afterEach(cleanup)

describe('shell', () => {
  it('renders without the browser APIs it would normally use', () => {
    expect(() => render(<App />)).not.toThrow()
    expect(screen.getByRole('heading', { name: 'Mini Cut' })).toBeTruthy()
  })

  it('offers an import control', () => {
    render(<App />)

    expect(screen.getByLabelText('Import video')).toBeTruthy()
  })

  it('prompts for media before anything is imported', () => {
    render(<App />)

    expect(screen.getByText(/import a video to start cutting/i)).toBeTruthy()
  })

  it('starts with an empty timeline', () => {
    render(<App />)

    expect(screen.getByLabelText('0 clips')).toBeTruthy()
  })

  it('disables undo and redo until something is edited', () => {
    render(<App />)

    expect(screen.getByRole('button', { name: 'Undo' }).hasAttribute('disabled')).toBe(true)
    expect(screen.getByRole('button', { name: 'Redo' }).hasAttribute('disabled')).toBe(true)
  })
})
