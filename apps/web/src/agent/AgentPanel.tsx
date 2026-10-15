/**
 * Ask for an edit in plain language, see what it would do, then accept or discard.
 *
 * The preview is the point. An agent that edits the moment it replies makes the user audit their own
 * timeline to find out what happened; one that shows its working first makes the change reviewable
 * before it exists. Undo would recover either way, but recovering is not the same as consenting.
 */

import { useState } from 'react'
import type { AgentPlan, AgentRequest, AgentResponse } from '@mini-cut/shared'
import { findSilences, silencesWithinClip } from '../media/silence'
import type { Waveform } from '../media/waveform'
import type { CommandBus } from '../editor/history'
import type { Project } from '../editor/types'
import { PlanRejectedError, applyPlan, planToCommands } from './applyPlan'

/**
 * Where the API lives.
 *
 * Empty in development and for a single-origin deployment, where the dev proxy or a host rewrite
 * forwards `/api` to the server. Set `VITE_API_BASE_URL` when the front end and the API are on
 * different hosts, which is the normal shape for a static site plus a container.
 */
const API_BASE = normalizeApiBase(import.meta.env.VITE_API_BASE_URL)

/**
 * Accept the sensible variations on an API origin.
 *
 * The value wanted is the origin alone, because `/api/agent` is appended to it. The obvious thing
 * to paste is whatever URL was last confirmed working — usually the health endpoint — which would
 * silently build `…/api/health/api/agent`. Since it is set once at build time and only shows up as
 * a failed request much later, it is worth being forgiving here rather than correct and brittle.
 */
export function normalizeApiBase(value: string | undefined): string {
  if (!value) return ''
  return value
    .trim()
    .replace(/\/+$/, '')
    .replace(/\/api(\/.*)?$/, '')
}

export type AgentPanelProps = {
  bus: CommandBus
  project: Project
  /** Peaks per source, so quiet stretches can be measured rather than guessed at. */
  waveforms?: ReadonlyMap<string, Waveform>
  disabled?: boolean
}

/**
 * How long to wait before explaining the delay.
 *
 * A warm service answers in a second or two. A free-tier container that has gone to sleep takes the
 * better part of a minute to wake, and "Thinking" for fifty seconds reads as broken rather than
 * slow — so past this the panel says what is actually happening.
 */
const SLOW_REQUEST_MS = 4000

type State =
  | { status: 'idle' }
  | { status: 'thinking'; slow: boolean }
  | { status: 'proposed'; plan: AgentPlan; affected: number }
  | { status: 'failed'; message: string }

/** Only timings leave the browser — never the media. */
function timelineFor(project: Project): AgentRequest['clips'] {
  return project.tracks.flatMap((track) =>
    track.clips.map((clip) => ({
      id: clip.id,
      sourceIn: clip.sourceIn,
      sourceOut: clip.sourceOut,
      start: clip.start,
    })),
  )
}

/**
 * Quiet stretches across the whole timeline, in timeline time.
 *
 * Measured per clip rather than per source, because a clip shows only a window of its source and a
 * silence outside that window is not on the timeline at all.
 */
function silencesFor(
  project: Project,
  waveforms: ReadonlyMap<string, Waveform> | undefined,
): AgentRequest['silences'] {
  if (!waveforms?.size) return undefined

  const ranges = project.tracks.flatMap((track) =>
    track.clips.flatMap((clip) => {
      const waveform = waveforms.get(clip.sourceId)
      return waveform ? silencesWithinClip(findSilences(waveform), clip) : []
    }),
  )

  return ranges.length > 0 ? ranges.sort((a, b) => a.startMs - b.startMs) : undefined
}

export function AgentPanel({ bus, project, waveforms, disabled }: AgentPanelProps) {
  const [instruction, setInstruction] = useState('')
  const [state, setState] = useState<State>({ status: 'idle' })

  const ask = async () => {
    setState({ status: 'thinking', slow: false })
    const slowTimer = setTimeout(() => {
      setState((current) =>
        current.status === 'thinking' ? { status: 'thinking', slow: true } : current,
      )
    }, SLOW_REQUEST_MS)

    try {
      const response = await fetch(`${API_BASE}/api/agent`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          instruction,
          clips: timelineFor(project),
          silences: silencesFor(project, waveforms),
        }),
      })
      // Parsed separately from the request: a proxy with nothing behind it answers with an HTML
      // error page, and "unexpected token <" is not a useful thing to show someone.
      let body: AgentResponse
      try {
        body = (await response.json()) as AgentResponse
      } catch {
        setState({
          status: 'failed',
          // A 404 from the page's own origin almost always means the API address was never set
          // at build time, so the request went to the static host. Saying "run npm run dev" sends
          // someone to fix a local server that is not the problem.
          message: API_BASE
            ? `The editing service at ${API_BASE} answered ${response.status} but not with JSON.`
            : `The editing service answered ${response.status} but not with JSON. If this is a deployed build, VITE_API_BASE_URL was not set when it was built, so the request went to this site instead of the API. Locally, "npm run dev" starts the API alongside the editor.`,
        })
        return
      }

      if (!body.ok) {
        setState({ status: 'failed', message: body.error })
        return
      }

      // Convert now, so the preview counts what would actually run rather than what was promised,
      // and a plan this build cannot apply fails before it is offered.
      const commands = planToCommands(body.plan, project)
      setState({ status: 'proposed', plan: body.plan, affected: commands.length })
    } catch (error) {
      // A rejected plan is the agent working and being refused. Anything else here is the request
      // never completing, which almost always means the API is not running — so say that, rather
      // than a sentence nobody can act on.
      setState({
        status: 'failed',
        message:
          error instanceof PlanRejectedError
            ? error.message
            : `Could not reach the editing service at ${API_BASE || ''}/api/agent. Is the API running? "npm run dev" starts it alongside the editor.`,
      })
    } finally {
      clearTimeout(slowTimer)
    }
  }

  const accept = () => {
    if (state.status !== 'proposed') return
    try {
      applyPlan(bus, state.plan)
      setState({ status: 'idle' })
      setInstruction('')
    } catch (error) {
      setState({
        status: 'failed',
        message: error instanceof Error ? error.message : 'could not apply the edit',
      })
    }
  }

  return (
    <div className="agent">
      <form
        className="agent-ask"
        onSubmit={(event) => {
          event.preventDefault()
          if (instruction.trim()) void ask()
        }}
      >
        <input
          type="text"
          value={instruction}
          disabled={disabled || state.status === 'thinking'}
          placeholder="Cut the first 10 seconds"
          aria-label="Describe an edit"
          onChange={(event) => setInstruction(event.target.value)}
        />
        <button
          type="submit"
          disabled={disabled || state.status === 'thinking' || !instruction.trim()}
        >
          {state.status === 'thinking' ? 'Thinking' : 'Suggest edit'}
        </button>
      </form>

      {state.status === 'proposed' && (
        <div className="agent-proposal">
          <p>
            {state.plan.summary}{' '}
            <span className="dim">
              {state.affected} change{state.affected === 1 ? '' : 's'}
            </span>
          </p>
          <button type="button" className="accept" onClick={accept}>
            Apply
          </button>
          <button type="button" onClick={() => setState({ status: 'idle' })}>
            Discard
          </button>
        </div>
      )}

      {state.status === 'thinking' && state.slow && (
        <p className="hint" role="status">
          Still waiting. A free-tier service sleeps when idle and can take up to a minute to wake —
          the next request will be quick.
        </p>
      )}

      {state.status === 'failed' && (
        <p role="alert" className="alert">
          {state.message}
        </p>
      )}
    </div>
  )
}
