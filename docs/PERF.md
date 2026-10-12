# Performance

Numbers measured on real footage, not estimates. A row goes in when it has been observed; nothing
here is predicted.

Record the machine and the source file alongside each figure — a frame rate without a file size and
a laptop means nothing to a reader, including you in a month.

## Machine

_Fill in: model, CPU, RAM, browser and version._

## Sources used

| Name | Size | Codec | Resolution | Frame rate |
| ---- | ---- | ----- | ---------- | ---------- |
|      |      |       |            |            |

Run `ffprobe -v error -show_streams <file>` to fill this in. Include at least one variable-frame-rate
phone video: it is the input most likely to break seeking and export.

## Measurements

| Metric | Source | Before | After | Date | Notes |
| ------ | ------ | ------ | ----- | ---- | ----- |
|        |        |        |       |      |       |

Metrics worth having, and where each is claimed:

- **Time to first frame** after choosing a file (M2).
- **Memory while importing**, peak, from the DevTools Memory panel (M2). The claim being tested is
  that a 2 GB file never becomes 2 GB of heap.
- **Frames per second while scrubbing and zooming** a long timeline (M3). This one is still an
  unproven claim in issue #3.
- **Export time** for a one-minute cut, stream-copy and re-encode separately (M6).
- **Agent round trip**, instruction to proposal (M7).

## What got slower, and why it was worth it

_A fix that trades one cost for another belongs here, so the trade is on record rather than
rediscovered later._
