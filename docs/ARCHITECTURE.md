# Architecture

## Principles

1. **Every change to a project is a command.** Trim, split, move and delete are commands with `apply`
   and `undo`. The UI, keyboard shortcuts and the AI agent all go through the same command bus.
2. **The agent never touches state directly.** It returns operations in a strict schema, validated with
   zod, then run through the command bus. Invalid output is rejected.
3. **Never load a whole video into memory.** Files live in OPFS and are read in slices.
4. **The main thread stays free.** Thumbnails, waveform and export run in workers.
5. **The playhead is not React state.** Keep it in a ref and draw it on the canvas to avoid re-renders.
6. **The saved project is versioned JSON** with a schema version so old saves can be migrated.

## Layout

| Path                     | Purpose                                                     |
| ------------------------ | ----------------------------------------------------------- |
| `apps/web/src/editor/`   | Project model, commands, command bus, undo/redo             |
| `apps/web/src/timeline/` | Canvas timeline rendering and interaction                   |
| `apps/web/src/media/`    | Playback, probing, export helpers                           |
| `apps/web/src/workers/`  | Web Workers (thumbnails, waveform, export)                  |
| `apps/web/src/storage/`  | OPFS for media, IndexedDB for project JSON, autosave        |
| `apps/web/src/agent/`    | Client side of the AI agent: build context, preview, accept |
| `apps/server/`           | Fastify API (`/api/health` now; agent endpoint in M7)       |
| `packages/shared/`       | Types and zod schemas used by both web and server           |
| `docs/`                  | Architecture notes and decisions                            |

The shared package is consumed as TypeScript source (no build step). The server runs with `tsx`.

## Milestones

M1 editor core, M2 large-file playback, M3 canvas timeline, M4 waveform, M5 autosave and offline,
M6 export, M7 AI agent, M8 performance pass. Tracked as GitHub issues.

## Decisions

_Record notable trade-offs here as you make them (date, decision, why)._
