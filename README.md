# Mini Cut

A browser-based video editor with an AI edit agent. Open a large local video, trim and split clips on a
canvas timeline, export, and type commands like "cut the first 10 seconds" that an LLM turns into
validated timeline edits.

**Status:** early setup. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) and the open issues for the
milestone plan (M1 to M8).

## Stack

npm workspaces monorepo: React 19 + Vite (`apps/web`), Fastify (`apps/server`), and shared zod schemas
(`packages/shared`). TypeScript strict throughout, Vitest, oxlint, Prettier. Planned: Web Workers, OPFS,
IndexedDB, ffmpeg.wasm.

## Getting started

Requires Node 22+.

```bash
npm install
npm run dev      # web on :5173, API on :3001 (Vite proxies /api)
```

The page shows `API: ok` when the frontend can reach `GET /api/health`.

## Scripts

| Script           | What it does                                 |
| ---------------- | -------------------------------------------- |
| `npm run dev`    | Start the dev server (cross-origin isolated) |
| `npm run build`  | Typecheck and build for production           |
| `npm run check`  | Lint, typecheck, format check, tests (as CI) |
| `npm test`       | Run tests once (`test:watch` for watch mode) |
| `npm run format` | Format everything with Prettier              |

## Cross-origin isolation

Multi-threaded ffmpeg.wasm needs `SharedArrayBuffer`, which needs these response headers. The dev and
preview servers set them (see `vite.config.ts`); production hosting must set them too:

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

## Performance results

_To be filled in during M8: fps while scrubbing a 2 GB file, memory use, time to first frame, export time._
