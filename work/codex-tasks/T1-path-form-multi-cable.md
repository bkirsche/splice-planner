# T1: Path form for several cables per path

## Goal
A path can now carry several cables (commit 771a493). The path form still
edits one. Make it list, add and edit each cable on the path, and let a new
cable start further back up the route and pass through to here.

## Model you build on (already in app.js / equipment.js, do not change)
- `pathCables(path)`: every span on a path. `pathCable(path)`: the one feeding `path.to`.
- A span with `through` ("pass" | "storage") continues the span named by `prev` (an id).
  `prevSpan(c)`, `nextSpan(c)`, `cableStart(c)`, `cableSpans(c)` walk runs by `prev`.
- `incomingCable(id)`: the cable ending at id (else first arriving).
- `tailStarts(fromId)` (equipment.js): [fromId, its feeder, ...] up the route.
- `setTail(loc, eq, feet, startId)` (equipment.js) lays a run from startId to loc:
  first span starts the cable, later spans `{ through: "pass", prev }`.

## Files
- `app.js`: add `layRun(startId, toId, fields)` next to `cableSpans`. It lays a run
  from startId down to toId along the paths: first span `{ id, from, to, ...fields }`, the rest
  `{ id, from, to, name, fibers, through: "pass", prev }`. If startId isn't up the route from
  toId, use the last path only. Push the spans to plan.cables and return the first span.
- `equipment.js`: make `setTail` use `layRun` (same behaviour).
- `paths.js`: `openPath(toId, cableId)`, `openPathView(toId)`, `openLineMenu(toId, e)`, the cable
  cell at about line 137 (the `cable` button), `insertStopForm` (only if needed).

## Behaviour
1. `openPath(toId, cableId)`:
   - `cableId` is the span to edit. If it's missing: edit `pathCable(path)` if there is one, else a new cable.
     `"new"` always means a new cable.
   - When the path has 2+ cables, show a row of buttons under the "Cable" heading, one per cable
     (`name · nF`), and "+ Another cable". Clicking reopens the form for that cable. The current one
     looks selected.
   - Footer: "Remove cable" removes only this cable's run from here on (`removeCableFrom`).
2. New cable (mode "new"), add a **"Starts at"** select: `tailStarts(from.id)` with the same labels as
   `tailStartField` ("A14413, through A14412"). Hide it when there's only one option. The fiber picker uses
   the cable arriving at the chosen start (`incomingCable(startId)`) instead of at `from`. Saving with a
   start further back calls `layRun` (kind, phase and picks go on the first span). Saving with
   start = from works like it does today.
3. Modes "pass" / "storage": offer one pair of options for **each** cable arriving at `from` that isn't
   continued yet (`!nextSpan(x)`), or that is continued by the span being edited. Labels as now
   ("X passes through A", "X, slack stored at A"). Option values become `pass:<id>` / `storage:<id>`.
   Saving sets `through` and `prev` to that id. Drop the old `continuesElsewhere` / single `arriving` logic.
4. Editing an existing span that is part of a run started further back: show
   "Part of <name>, from <start location>, passes through here" plus a button "Edit <name>" that opens
   `openPath(cableStart(c).to, cableStart(c).id)`. No mode select for that span.
5. `openPathView` (guest): list every cable on the path, each with its annotation, fiber use and color code.
6. `openLineMenu`: one item per cable on the path ("Cable <name>", opens it), then "Add a cable"
   (`openPath(toId, "new")`), then the existing "Insert a pass-through handhole".
7. Cable cell around paths.js:137: show every cable on the path, one line each.

## Do not touch
counts.js, splices.js, connect.js, check.js, grid.js, fold.js, print.js, the HANDOFF file, sw.js.
Keep the code style: plain functions, `el`/`selectEl`/`fieldEl` helpers, short plain-English comments.

## Acceptance checks
Serve with `python -m http.server 8600`. In the browser console, after picking a user and a new plan:
```js
plan = newPlan(); show('route');
const cab = placeStart('cabinet','CAB'); const hh = addLocation(cab.id,'handhole','HH');
plan.cables.push({ id: makeId(), name: 'F1', from: cab.id, to: hh.id, fibers: 144 });
const a = addLocation(hh.id,'pedestal','A'); const b = addLocation(a.id,'pedestal','B');
const first = layRun(hh.id, b.id, { name: 'Cable 9', fibers: 12 });
// expect 2 spans: HH->A (no through), A->B (through "pass", prev = first.id)
plan.cables.filter(c => c.name === 'Cable 9').map(c => [point(c.from).name, point(c.to).name, c.through || '', c.prev === first.id]);
cableSpans(first).length === 2;
```
- `openPath(a.id)` with two cables on HH->A shows the cable buttons. "+ Another cable" opens a new one.
- New cable on A->B with "Starts at" = HH adds two spans and fiber picks come from F1.
- Pass-through options list every arriving cable not yet continued.
- No console errors. `git diff --stat` shows only app.js, equipment.js, paths.js.

Write `T1-path-form-multi-cable-REPORT.md` next to this file: what changed, the check results, anything unsure.
