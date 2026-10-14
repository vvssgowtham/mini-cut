/**
 * Try the agent from the terminal, against a fixed sample timeline.
 *
 * The agent is the one feature that cannot be proven by the test suite: the tests stub the model, so
 * they show that bad output is rejected but say nothing about whether a real reply is any good. That
 * needs a key and a round trip.
 *
 * Doing it through the browser means importing a file and clicking before you learn anything. This
 * asks the same question in a few seconds:
 *
 *   npm run agent:try -w @mini-cut/server -- "cut the first 10 seconds"
 */

import {
  AgentBusyError,
  AgentConfigError,
  AgentError,
  createAnthropicPlanner,
  createGeminiPlanner,
  createGroqPlanner,
  planEdit,
} from './agent'
import { loadEnvFile } from './env'
import type { EditPlanner } from './agent'
import type { AgentRequest } from '@mini-cut/shared'

// The same loader the server uses, so the two cannot disagree about whether a key is configured.
loadEnvFile()

const readEnv = (name: string): string | undefined => process.env[name]

/**
 * Whichever provider has a key.
 *
 * The key format is checked first: a wrong one otherwise costs a round trip and comes back as a
 * 401, which reads like the agent is broken rather than like the credential is.
 */
function choosePlanner(): { provider: string; planner: EditPlanner } | { error: string } {
  const providers = [
    {
      name: 'Anthropic',
      variable: 'ANTHROPIC_API_KEY',
      prefix: 'sk-ant-',
      build: createAnthropicPlanner,
    },
    { name: 'Gemini', variable: 'GOOGLE_API_KEY', prefix: 'AIza', build: createGeminiPlanner },
    { name: 'Groq', variable: 'GROQ_API_KEY', prefix: 'gsk_', build: createGroqPlanner },
  ]

  const skipped: string[] = []
  for (const { name, variable, prefix, build } of providers) {
    const key = readEnv(variable)
    if (!key) continue
    // Skipped rather than fatal: a stale value for one provider must not stop a working key for
    // another further down the list. It is still reported, so a typo does not pass unnoticed.
    if (!key.startsWith(prefix)) {
      skipped.push(`${variable} does not look like a ${name} key (they begin "${prefix}")`)
      continue
    }
    return { provider: name, planner: build(key) }
  }

  return {
    error: [
      ...skipped,
      'No usable key found. Put ANTHROPIC_API_KEY, GOOGLE_API_KEY or GROQ_API_KEY in apps/server/.env.',
    ].join('\n'),
  }
}

/** Two clips with a quiet stretch in the middle, enough to exercise trim, split, delete and move. */
const sample: AgentRequest = {
  instruction: process.argv.slice(2).join(' ') || 'cut the first 10 seconds',
  clips: [
    { id: 'clip-one', sourceIn: 0, sourceOut: 30_000, start: 0 },
    { id: 'clip-two', sourceIn: 0, sourceOut: 15_000, start: 30_000 },
  ],
  silences: [
    { startMs: 12_000, endMs: 15_500 },
    { startMs: 33_000, endMs: 34_200 },
  ],
}

async function main() {
  const chosen = choosePlanner()
  if ('error' in chosen) {
    console.error(chosen.error)
    process.exit(1)
  }

  console.log(`Provider:    ${chosen.provider}`)
  console.log(`Timeline:    clip-one 0..30000, clip-two 30000..45000`)
  console.log(`Silences:    12000..15500, 33000..34200`)
  console.log(`Instruction: ${sample.instruction}\n`)

  const started = Date.now()
  try {
    const plan = await planEdit(chosen.planner, sample)
    console.log(`${plan.summary}\n`)
    for (const operation of plan.operations) console.log(' ', JSON.stringify(operation))
    console.log(`\n${plan.operations.length} operation(s) in ${Date.now() - started}ms`)
  } catch (error) {
    // An AgentError is the model being refused or declining, which is a result worth reading.
    // Anything else is the call itself failing.
    if (error instanceof AgentBusyError || error instanceof AgentConfigError) {
      console.error(error.message)
      process.exit(1)
    }
    if (error instanceof AgentError) {
      console.error(`Rejected: ${error.message}`)
      process.exit(2)
    }
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  }
}

void main()
