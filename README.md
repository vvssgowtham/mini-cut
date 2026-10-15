# Mini Cut

A video editor that runs entirely in the browser. Import a multi-gigabyte file, cut it on a canvas
timeline, ask an AI agent to make edits in plain language, and export — with nothing uploaded
anywhere and the whole thing still working offline.

<!-- Add after recording: a 60–90s clip of import → trim → agent edit → refresh → export. -->

```bash
npm install
npm run dev     # web on :5173, API on :3001
```

Deploying both halves: [docs/DEPLOY.md](docs/DEPLOY.md).

Export needs a cross-origin isolated page; the agent needs `ANTHROPIC_API_KEY` (see
[docs/DEPLOY.md](docs/DEPLOY.md)). Without the key everything else still works and the agent says it
is not configured.

To check the agent without opening the editor:

```bash
cp apps/server/.env.example apps/server/.env   # add any one provider key
npm run agent:try -w @mini-cut/server -- "remove the silent parts"
```

Claude, Gemini or Groq — the planner is injected, so another provider is another function rather
than another agent, and whatever any of them returns is validated identically. The safety of this
feature is the schema and the timeline checks, not the vendor.

It runs one instruction against a fixed sample timeline and prints the operations the model
returned. The test suite stubs the model, so it proves bad output is rejected but says nothing about
whether a real reply is any good — that needs a round trip.

## The interesting problems

### Keeping a 2 GB file out of memory

`file.arrayBuffer()` on a 2 GB import wants 2 GB of heap and takes the tab with it. Media is copied
into [OPFS](apps/web/src/storage/opfs.ts) in 64 MB chunks, so only one chunk is ever resident, and
it survives a refresh — a `File` handle does not.

Writes go through `createWritable()`, which buffers to a swap file and commits atomically on close.
A tab closed mid-copy therefore leaves **no** file rather than a truncated one that is byte-for-byte
indistinguishable from a complete video. Name collisions resolve to a free variant instead of
overwriting, because two phones both produce `IMG_0001.mov` and the second import must not repoint
the first clip at different footage.

### A timeline that stays at 60 fps

The timeline is one canvas, redrawn whole each frame. That sounds wasteful and isn't: drawing and
hit-testing both [cull to the viewport](apps/web/src/timeline/viewport.ts), so cost is bounded by
canvas width rather than project length — a thousand-clip project costs the same as a ten-clip one
at the same zoom.

The playhead changes every frame during playback, so it lives in a
[store outside React](apps/web/src/media/playhead.ts), not in state. When a toolbar button needed to
know the playhead position, subscribing from the top re-rendered the whole editor sixty times a
second; the fix was a subscription that returns a _boolean_, so `useSyncExternalStore` bails out
while the answer is unchanged.

Ruler intervals come from a clock-like ladder (1, 2, 5, 10, 15, 30 within each unit) rather than
dividing the visible span evenly, which would produce unreadable intervals like "every 237 ms".

### An AI agent that cannot corrupt your project

The model never touches the timeline. It returns operations in a
[shared schema](packages/shared/src/operations.ts), which are validated three times: against the
schema, against the clips that actually exist, and again in the browser before applying — because
the response crossed a network, and a client that trusts a server reply blindly is one stale server
away from a corrupt project.

Shape validation alone is not enough. A model will cheerfully invent a clip id or split at a point
outside a clip, and both parse perfectly well.

Only clip timings are sent. **Media never leaves the browser** — a 2 GB upload per instruction would
be slow, costly and a needless disclosure, and the model does not need the pictures to decide where
to cut. Silence is _measured_ from the audio and sent as ranges, so "remove the silent parts" is
arithmetic over something the user can see on the waveform rather than a guess.

Everything applies as one undoable group, so a fifteen-delete edit is one ctrl+Z, and a plan with
one bad operation applies none of it. It proposes rather than applies: undo recovers, but recovering
is not the same as consenting.

### Undo that doesn't grow

Every edit is a [command](apps/web/src/editor/commands.ts) that returns the operation reversing it,
so memory stays flat however long a session runs. The op set is closed under inversion — delete ↔
insert, split ↔ join, trim ↔ trim — which means undo is just "apply the inverse": one code path
instead of two.

### Export that cuts in the right place

Stream copy is far faster and lossless, but a copied cut can only start at a keyframe, because the
decoder needs one to begin from. Clips whose `sourceIn` lands mid-GOP are
[re-encoded](apps/web/src/media/exportPlan.ts); sources with no keyframe data are re-encoded rather
than guessed at. Overlapping clips are rejected rather than silently resolved — an overlap could
mean a crossfade, a replacement, or a mistake.

`-ss` goes _before_ `-i` when copying (fast keyframe seek) and _after_ when re-encoding
(frame-accurate). Getting that backwards is the classic ffmpeg trim bug.

## Design

The interface follows the Airbnb design language in [DESIGN.md](DESIGN.md), installed with
`npx getdesign add airbnb`: Rausch `#ff385c` as the single brand colour, `#222222` ink on a white
canvas, the 2–48px spacing scale, the 4/8/14/20px radius ladder, and the system's one shadow tier —
it either has that shadow or none, because depth is meant to come from surface separation rather
than layered elevation.

The system is applied throughout, including the viewer surround and the timeline. The editor itself
is a white card on a faintly Rausch-tinted page, which is the separation this language uses
everywhere in place of layered elevation — rather than a decorative gradient, which the system
explicitly avoids.

One trade worth naming: a light surround makes footage read darker than it is, which is why editing
tools are usually dark, so judge exposure in a player rather than here.

## Architecture

```
apps/web/      React 19, canvas timeline, OPFS, IndexedDB, ffmpeg.wasm, Web Workers
apps/server/   Fastify — one endpoint, which validates whatever the model returns
packages/shared/  zod schemas both sides depend on, so they cannot drift
```

More in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

The split that made the browser work testable: anything with a decision in it is a pure function —
viewport maths, hit-testing, keyboard mapping, export planning, silence detection — and the parts
that need a browser are thin wrappers around them. 403 tests run in Node with no browser.

## What a green test suite did not catch

Worth being honest about, because it shaped how the tests are written now.

The timeline once rendered **nothing at all** while every test passed. jsdom returns `null` from
`getContext`, so the draw path was never entered; a stale animation-frame id after React's
StrictMode remount made it early-return forever. It took a screenshot to find.

The first regression test written for that bug was itself useless — its `cancelAnimationFrame` stub
did nothing, so the frame queued before unmount still ran and hid the failure. Tests like that now
get verified by reintroducing the bug and watching them fail.

Similarly, keyboard navigation passed its tests and did nothing in practice: the shortcuts were
bound to the canvas, so they needed it focused, and clicking any button killed them. The tests
called the handler directly and never asked whether a key press could reach it.

## Status

Working: import, multi-clip timeline, trim, move, split, join, delete, undo/redo, frame-accurate
keyboard navigation, playback across clips, waveforms, silence detection, autosave, offline, export,
and the agent.

Not done: thumbnails, multiple tracks, snapping to clip edges, and ripple edit. Playback across two
different files will hitch, because nothing preloads the next source yet.

## Scripts

| Script          | Does                                            |
| --------------- | ----------------------------------------------- |
| `npm run dev`   | Web and API together                            |
| `npm run check` | Lint, typecheck, format, tests — the same as CI |
| `npm test`      | Tests once                                      |
| `npm run build` | Production build                                |
