/**
 * Ask for an edit in plain language, see what it would do, then accept or discard.
 *
 * The preview is the point. An agent that edits the moment it replies makes the user audit their own
 * timeline to find out what happened; one that shows its working first makes the change reviewable
 * before it exists. Undo would recover either way, but recovering is not the same as consenting.
 */

import { useState } from 'react'
import type { AgentPlan, AgentRequest, AgentResponse } from '@mini-cut/shared'
import type { CommandBus } from '../editor/history'
import type { Project } from '../editor/types'
import { PlanRejectedError, applyPlan, planToCommands } from './applyPlan'

export type AgentPanelProps = {
  bus: CommandBus
  project: Project
  disabled?: boolean
}

type State =
  | { status: 'idle' }
  | { status: 'thinking' }
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

export function AgentPanel({ bus, project, disabled }: AgentPanelProps) {
  const [instruction, setInstruction] = useState('')
  const [state, setState] = useState<State>({ status: 'idle' })

  const ask = async () => {
    setState({ status: 'thinking' })
    try {
      const response = await fetch('/api/agent', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ instruction, clips: timelineFor(project) }),
      })
      const body = (await response.json()) as AgentResponse

      if (!body.ok) {
        setState({ status: 'failed', message: body.error })
        return
      }

      // Convert now, so the preview counts what would actually run rather than what was promised,
      // and a plan this build cannot apply fails before it is offered.
      const commands = planToCommands(body.plan, project)
      setState({ status: 'proposed', plan: body.plan, affected: commands.length })
    } catch (error) {
      setState({
        status: 'failed',
        message:
          error instanceof PlanRejectedError
            ? error.message
            : 'could not reach the editing service',
      })
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

      {state.status === 'failed' && (
        <p role="alert" className="alert">
          {state.message}
        </p>
      )}
    </div>
  )
}
