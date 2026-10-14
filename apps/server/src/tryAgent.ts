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

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { AgentError, createAnthropicPlanner, planEdit } from './agent'
import type { AgentRequest } from '@mini-cut/shared'

/** Read .env directly rather than depending on a flag being passed through two layers of npm. */
function loadKey(): string | undefined {
  if (process.env.ANTHROPIC_API_KEY) return process.env.ANTHROPIC_API_KEY
  try {
    const file = readFileSync(join(process.cwd(), '.env'), 'utf8')
    const line = file.split('\n').find((candidate) => candidate.startsWith('ANTHROPIC_API_KEY='))
    return line?.slice('ANTHROPIC_API_KEY='.length).trim() || undefined
  } catch {
    return undefined
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
  const apiKey = loadKey()
  if (!apiKey) {
    console.error('No ANTHROPIC_API_KEY. Put one in apps/server/.env, or export it.')
    process.exit(1)
  }
  if (!apiKey.startsWith('sk-ant-')) {
    console.error(
      `That key does not look like an Anthropic key (they begin "sk-ant-"). Got "${apiKey.slice(0, 6)}…".`,
    )
    process.exit(1)
  }

  console.log(`Timeline:    clip-one 0..30000, clip-two 30000..45000`)
  console.log(`Silences:    12000..15500, 33000..34200`)
  console.log(`Instruction: ${sample.instruction}\n`)

  const started = Date.now()
  try {
    const plan = await planEdit(createAnthropicPlanner(apiKey), sample)
    console.log(`${plan.summary}\n`)
    for (const operation of plan.operations) console.log(' ', JSON.stringify(operation))
    console.log(`\n${plan.operations.length} operation(s) in ${Date.now() - started}ms`)
  } catch (error) {
    // An AgentError is the model being refused or declining, which is a result worth reading.
    // Anything else is the call itself failing.
    if (error instanceof AgentError) {
      console.error(`Rejected: ${error.message}`)
      process.exit(2)
    }
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  }
}

void main()
