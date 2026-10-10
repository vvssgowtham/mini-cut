# Mini Cut

Browser video editor with an AI edit agent. npm workspaces monorepo: `apps/web` (React 19 + Vite), `apps/server` (Fastify), `packages/shared` (zod schemas and types used by both). TypeScript strict. See
docs/ARCHITECTURE.md for the principles and layout.

## Commands

- `npm run dev`: web (:5173) and API (:3001) together; web sets COOP/COEP headers
- `npm run check`: lint, typecheck, format check, tests. Run before committing.
- `npm test`: Vitest once. `npm run format`: Prettier.

## Conventions

- Anything both sides need (operation schemas, types) lives in `packages/shared`, not duplicated.
- All project changes go through the command bus in `apps/web/src/editor/`. Do not mutate project state elsewhere.
- Never read a whole media file into memory; use OPFS and `Blob.slice`.
- Heavy work (thumbnails, waveform, export) belongs in workers under `src/workers/`.
- Keep the playhead out of React state.
- No semicolons, single quotes (Prettier enforces this).
- The owner is learning these topics: prefer small, explained changes over large generated ones.
