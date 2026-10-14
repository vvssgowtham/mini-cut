/** The spec for reading .env. */

import { afterEach, describe, expect, it } from 'vitest'
import { loadEnvFile, parseEnvFile } from './env'

describe('parseEnvFile', () => {
  it('reads key and value pairs', () => {
    expect(parseEnvFile('A=1\nB=two')).toEqual({ A: '1', B: 'two' })
  })

  it('ignores comments and blank lines', () => {
    expect(parseEnvFile('# a note\n\nA=1\n   \n# another\nB=2')).toEqual({ A: '1', B: '2' })
  })

  it('keeps everything after the first equals, since keys can contain them', () => {
    expect(parseEnvFile('TOKEN=abc=def==')).toEqual({ TOKEN: 'abc=def==' })
  })

  it('strips surrounding quotes, which are syntax rather than part of the value', () => {
    expect(parseEnvFile(`A="quoted"\nB='single'`)).toEqual({ A: 'quoted', B: 'single' })
  })

  it('trims whitespace around both sides', () => {
    expect(parseEnvFile('  A  =  1  ')).toEqual({ A: '1' })
  })

  it('skips a key with no value, so an unfilled template does not look configured', () => {
    expect(parseEnvFile('ANTHROPIC_API_KEY=\nGOOGLE_API_KEY=AIza1')).toEqual({
      GOOGLE_API_KEY: 'AIza1',
    })
  })

  it('skips lines with no equals at all', () => {
    expect(parseEnvFile('nonsense\nA=1')).toEqual({ A: '1' })
  })

  it('handles an empty file', () => {
    expect(parseEnvFile('')).toEqual({})
  })
})

describe('loadEnvFile', () => {
  afterEach(() => {
    delete process.env.MINI_CUT_TEST_VALUE
  })

  it('does nothing when there is no file', () => {
    expect(() => loadEnvFile('/nowhere/at/all/.env')).not.toThrow()
  })

  it('leaves a real environment variable alone', () => {
    // A deployed container sets these directly; a stale local file must not override them.
    process.env.MINI_CUT_TEST_VALUE = 'from-environment'
    loadEnvFile('/nowhere/at/all/.env')

    expect(process.env.MINI_CUT_TEST_VALUE).toBe('from-environment')
  })
})
