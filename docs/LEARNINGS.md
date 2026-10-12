# Learnings

Two kinds of entry, both written in your own words:

- **Predictions.** Before running something new, write what you expect and why. Then check. The gap
  between the two is the part worth remembering.
- **Teach-backs.** After each milestone, answer its "you know it when" question in five to ten
  lines. These become interview answers, and writing them is how you find out whether you actually
  understood it.

A note is more useful when it records what surprised you than when it summarises what worked.

## Template

```
### <topic> — <date>
Expected: ...
Happened: ...
Why: ...
```

## Milestones

### M1 — command bus

_Why does a command need both apply and undo, and what happens to the redo stack after a new edit?_

### M2 — large files

_Why does `arrayBuffer()`/FileReader fail on a 2 GB file, and why does seeking snap to keyframes?_

### M3 — canvas timeline

_Why canvas rather than DOM nodes, and what is the difference between a transferred and a copied
buffer?_

### M5 — autosave and offline

_What survives a refresh, a tab close, and cleared site data?_

### M6 — export

_Where does an export spend its time and memory, and what does cancel actually stop?_

### M7 — agent

_How do you show that bad model output cannot change the project?_

## Things that were already surprising

Two from the work so far, worth keeping because both were invisible in a passing test suite:

- **The timeline drew nothing at all** while every test was green. jsdom returns `null` from
  `getContext`, so the draw path was never entered; the bug only appeared in a real browser. Green
  CI is evidence about the code that is covered, not about the feature.
- **The first regression test written for that bug was itself useless.** Its
  `cancelAnimationFrame` stub did nothing, so the frame queued before unmount still ran and hid the
  failure. A test only counts once you have watched it fail.
