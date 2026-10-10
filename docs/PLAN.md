# Mini Cut: Build Plan and Learning Guide

> Status: awaiting approval. Merging this PR approves the plan. Each step then becomes its own branch and PR.

## 1. Why we are building this

Mini Cut is a browser-based video editor with an AI edit agent. It is the hiring evidence for Cardboard's
Fullstack Engineer role: browser performance, large media on the client, offline-first state, and an LLM that
makes real edits. You are learning these topics as you go, so every step has a "learn first" list, a small
exercise, and a "you know it when" test.

**Where the repo is today** (https://github.com/vvssgowtham/mini-cut):

- `main`: Vite + React 19 + strict TypeScript, Vitest, oxlint, Prettier, CI, templates, docs, issues #1 to #8.
- PR #14 (open): npm workspaces: `apps/web`, `apps/server` (Fastify with `GET /api/health`), `packages/shared`
  (zod). The web page calls `/api/health` and shows `API: ok`.

## 2. How to work (rules for every step)

1. **Learn, demo, integrate.** Read the listed docs, build the smallest throwaway demo (not committed), then
   write the real code.
2. **Predict before you run.** Write one line in `docs/LEARNINGS.md`: "I expect X because Y." Then check.
3. **Teach-back.** After each milestone, write 5 to 10 lines in your own words answering its "you know it when"
   question. These become your interview answers.
4. **One branch and PR per milestone** (`m1-command-bus`, `m2-large-files`, ...). `npm run check` must pass
   before opening the PR. The PR closes the milestone issue.
5. **Measure as you go.** Add rows to `docs/PERF.md` after M2, M3, M6, not only at the end.
6. **Claude's role:** explain concepts, review your code, unblock you. You write the milestone code.

## 3. Roadmap at a glance

| Day    | Step                              | Outcome                                             | Issue  |
| ------ | --------------------------------- | --------------------------------------------------- | ------ |
| 0      | Land setup                        | PR #14 merged, proxy verified, learning log created | n/a    |
| 1      | M1 Editor core                    | Command bus with undo/redo, tested                  | #1     |
| 2      | M2 Large files                    | 2 GB file opens and plays, memory flat              | #2     |
| 3 to 4 | M3 Canvas timeline                | 60 fps zoom, pan, drag-trim, thumbnails in a worker | #3     |
| 5      | M5 Autosave and offline           | Refresh and offline reload restore the project      | #5     |
| 6 to 7 | M6 Export                         | ffmpeg.wasm export with progress and cancel         | #6     |
| 8      | M7 AI agent                       | Natural language to validated edits, with preview   | #7     |
| 9      | M4 Waveform (optional) + start M8 | Silence removal; profiling                          | #4, #8 |
| 10     | M8 Ship and apply                 | Deployed, demo video, resume updated                | #8     |

M5 is done before M4 because offline persistence is core and the waveform is optional.

## 4. Steps

### Step 0: Land the setup (30 min)

- [ ] Check PR #14 CI is green on GitHub.
- [ ] Run `npm run dev`; confirm the page shows `API: ok` (proves the Vite proxy works end to end). Merge.
- [ ] Create `docs/LEARNINGS.md` and `docs/PERF.md` (empty table: metric, file/setup, before, after, date).
- Learn: what an npm workspace is; why `@mini-cut/shared` is imported as TypeScript source (read root `package.json`).

### M1: Editor core, data model and command bus (Day 1, issue #1)

Build, in `apps/web/src/editor/`:

- [ ] `types.ts`: `Project { version, tracks }`, `Track`, `Clip { id, sourceId, sourceIn, sourceOut, start }`.
      Pick one time unit (milliseconds or frames) and write it in `docs/ARCHITECTURE.md`.
- [ ] `commands.ts`: `trim`, `split`, `move`, `delete`. Each has `apply` and `undo`. Store the inverse data in the
      command so undo needs no full snapshot.
- [ ] `history.ts`: `CommandBus` with `execute`, `undo`, `redo`. A new `execute` clears the redo stack.
- [ ] Tests for each command and the bus (undo/redo order, redo cleared, split then undo restores exactly).

Learn first: command pattern; immutable updates; why not store full snapshots; versioned JSON (`version` field).
Exercise: write `trim` undo by hand before reading about the pattern.
Verify: `npm test`; any sequence of N commands followed by N undos equals the original project.
**You know it when:** you can explain apply vs undo, and what happens to redo after a new edit.

### M2: Open a large file and play it (Day 2, issue #2)

Build:

- [ ] `apps/web/src/storage/opfs.ts`: copy a `File` into OPFS in chunks.
- [ ] `apps/web/src/media/player.ts`: `<video>` over an object URL from the OPFS file, `requestVideoFrameCallback`
      for frame time, a seek helper.
- [ ] A minimal player UI (open, play/pause, scrub).

Learn first: File/Blob and `slice`; OPFS (`navigator.storage.getDirectory`); object URLs; seeking and `buffered`;
containers vs codecs; keyframes and GOPs; constant vs variable frame rate (run `ffprobe` on 3 of your own files).
Exercise: open a 2 GB file with `file.arrayBuffer()` and watch memory in DevTools, then do it with slices.
Verify: 2 GB file opens with flat memory. Record time-to-first-frame in `docs/PERF.md`.
**You know it when:** you can say why `arrayBuffer`/FileReader fails and why seeking snaps to keyframes.

### M3: Canvas timeline at 60 fps (Days 3 to 4, issue #3)

Build:

- [ ] `apps/web/src/timeline/viewport.ts`: pixels per second, scroll offset, time/x conversion, with unit tests.
- [ ] `draw.ts` + `Timeline.tsx`: draw only visible clips; handle `devicePixelRatio`; pointer events for drag trim
      handles, pan, zoom, snap to playhead. Edits dispatch M1 commands.
- [ ] Playhead in a ref, not React state.
- [ ] `apps/web/src/workers/thumbnails.worker.ts`: thumbnails off the main thread, cached, placeholders while loading.

Learn first: Canvas 2D basics; `requestAnimationFrame`; Web Workers, `postMessage`, Transferables; OffscreenCanvas;
what triggers React re-renders and how refs avoid them.
Exercise: draw 5,000 rectangles as DOM nodes vs on canvas and compare in the Performance panel.
Verify: Performance recording while zooming and dragging stays near 60 fps. Add numbers to `docs/PERF.md`.
**You know it when:** you can show the profile and explain transferred vs copied buffers.

### M5: Autosave and offline (Day 5, issue #5)

Build, in `apps/web/src/storage/`:

- [ ] `db.ts`: IndexedDB wrapper for project JSON.
- [ ] `autosave.ts`: debounced; subscribes to the command bus.
- [ ] Restore on load, including re-linking the OPFS media.
- [ ] Service worker caching the app shell; call `navigator.storage.persist()`.

Learn first: IndexedDB transactions; service worker lifecycle; Cache API strategies; storage quotas and eviction.
Exercise: break it on purpose (clear site data, fill quota) and see what fails.
Verify: edit, refresh, project identical. Network off, reload, still works.
**You know it when:** you can explain what survives a refresh, a tab close, and cleared site data.

### M6: Export with ffmpeg.wasm (Days 6 to 7, issue #6)

Build:

- [ ] `apps/web/src/workers/export.worker.ts` and `apps/web/src/media/export.ts`: turn the timeline into an ffmpeg
      plan; stream-copy trim and concat when cuts allow, re-encode otherwise.
- [ ] Progress events to the UI; cancel terminates the worker.

Learn first: ffmpeg.wasm virtual file system and memory limits; `-c copy` vs re-encode; the concat demuxer; why copy
cuts snap to keyframes; SharedArrayBuffer needs COOP/COEP (already set in `apps/web/vite.config.ts`; production
needs the same).
Exercise: run the equivalent `ffmpeg` commands in the terminal first, then reproduce them in wasm.
Verify: export a 3-clip edit and play it in an external player. Record export time for 1 GB in `docs/PERF.md`.
**You know it when:** you can explain where export spends time and memory, and what cancel actually stops.

### M7: AI edit agent (Day 8, issue #7)

Build:

- [ ] `packages/shared/src/operations.ts`: zod discriminated union for operations (`trim`, `split`, `delete`, `move`).
- [ ] `apps/server/src/agent.ts` and `POST /api/agent` (Fastify): receives timeline JSON plus a summary, calls the LLM
      with a strict schema, validates with the shared schema, returns operations or an error. API key from env
      (`.env`, never committed; add `.env.example`). Add a request size limit and rate limiting.
- [ ] `apps/web/src/agent/`: chat box, send context, preview of what changes, Accept runs ops through the M1 bus as
      one undoable group, Reject discards.
- [ ] `apps/server/src/agent.test.ts`: stubbed-LLM tests including malformed and hostile output.
- [ ] `evals/prompts.json` (8 to 10 prompts with expected operations) and a script to run them.

Learn first: structured output / tool use; zod discriminated unions; prompt design with metadata only; guardrails;
cost and latency.
Exercise: try to break the project with the agent (out-of-range times, negative durations, unknown ops) and fix each.
Verify: stubbed tests pass. Manual demo: "cut the first 10 seconds", "split at 0:30 and delete the second half".
**You know it when:** you can show that bad model output cannot change the project.

### M4: Waveform and silence removal (Day 9, optional, issue #4)

- [ ] `apps/web/src/workers/waveform.worker.ts`: chunked decode and peak downsampling; draw on the timeline.
- [ ] `apps/web/src/media/silence.ts`: RMS threshold plus minimum duration, with unit tests; feed silence ranges
      into the M7 summary.
      Learn first: Web Audio `decodeAudioData`; peak downsampling; dB and RMS.
      **You know it when:** you can explain how "silence" is defined and its false-positive cases.

### M8: Performance pass, deploy, write-up (Days 9 to 10, issue #8)

- [ ] Profile (Performance and Memory panels); find the single worst bottleneck; fix it; record before and after in
      `docs/PERF.md`; copy the table into the README.
- [ ] Deploy web (Vercel or Cloud Run) with COOP/COEP headers (for example `vercel.json`). Deploy `apps/server` to
      Cloud Run with a `Dockerfile`; secrets via env. Decide how `/api` is routed in production (rewrite or CORS).
- [ ] Polish: keyboard shortcuts (space, arrows, S), empty and error states, no layout shift.
- [ ] Record a 60 to 90 second demo: open a big file, drag-trim, AI command, refresh, offline, export.
- [ ] Make the repo public, add a LICENSE, finish the README (architecture diagram, failure modes handled, numbers, live link).

### Final: Apply (Day 10)

- [ ] Add Mini Cut as the first project on `VVSSGowtham_Resume_FullStack.pdf`, using real measured numbers.
- [ ] Application note (4 lines): why Cardboard, what you built, one thing you would do next, willing to relocate to Bengaluru.
- [ ] Rehearse the 7 interview questions from the Mini Cut plan PDF using your `docs/LEARNINGS.md`.

## 5. Where to learn (search these exact titles)

- MDN: Origin Private File System; File and Blob; HTMLVideoElement.requestVideoFrameCallback; Canvas API tutorial;
  Web Workers API; OffscreenCanvas; IndexedDB API; Service Worker API; Web Audio API (`decodeAudioData`).
- ffmpeg.org documentation: `ffmpeg`, `ffprobe`, formats (concat demuxer). ffmpeg.wasm project docs.
- web.dev: "Making your website cross-origin isolated using COOP and COEP".
- Chrome DevTools docs: "Analyze runtime performance" and the Memory panel guides.
- zod documentation (discriminated unions); Anthropic docs on tool use and structured outputs.

## 6. Cut lines if time slips

Drop in this order: M4 and the silence demo, WebCodecs stretch, re-encode export path (keep stream-copy),
service worker polish. **Never drop:** M1, M2, M3, M5 basics, M6 basic export, M7 with validation, measured
numbers, the demo video.

## 7. Definition of done for the whole project

- A fresh clone runs with `npm install && npm run dev`.
- A 2 GB file opens, edits, AI command works, refresh and offline reload restore the project, export plays externally.
- The production URL does the same. `docs/PERF.md` has real numbers. README has the demo video.
- `docs/LEARNINGS.md` has a teach-back for every milestone.

## 8. Risks

- **ffmpeg.wasm memory limits on very large files:** keep export to stream-copy where possible; test early (Day 6).
- **COOP/COEP breaks third-party embeds or fonts:** self-host assets.
- **Variable-frame-rate phone video:** test early in M2 so M3 and M6 do not surprise you.
- **LLM cost and latency:** send metadata only, cap tokens, stub it in tests.
