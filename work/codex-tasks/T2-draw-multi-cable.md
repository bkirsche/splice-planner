# T2: Draw one line per cable, and the read-only sweep

Run after T1 is merged (it uses `openPath(toId, cableId)` and `pathCables`).

## Goal
A path with several cables draws one line per cable, side by side, each in its own color.
The label stacks one row per cable. Lists and print show every cable on a path.

## Model (do not change)
`pathCables(path)`, `pathCable(path)` (the feeder), `wireColor(c)`, `cableKind(c)`, `cableSpans(c)`,
`prev` links on through spans, `incomingCable(id)` = the cable ending at id.

## Files and behaviour
1. `grid.js` around lines 195-222 (the route lines, layout grid):
   - For each cable in `pathCables(path)`, draw its own line and arrowhead with `stroke = wireColor(c)`. Offset
     the lines perpendicular to the path, 6px apart and centred on the path line (one cable = no offset).
     With no cable, keep the dashed grey line exactly as now.
   - Label: one row per cable, with the same text as now (name, then `cable-size` text). Each row is its own
     button that calls `openPath(path.to, c.id)`, or `openLineMenu` for guests as now. Keep the "No cable"
     label.
2. `app.js` route tree view (`renderRoute` path labels, around the line with `cable-size`): same as 1 —
   one stacked row per cable. The tree line itself can stay one line, colored by `pathCable(path)`.
3. `fold.js:133` `--wire`: keep `pathCable(path)`.
4. `print.js` about line 538 (path/conduit table): the cable cell lists every cable on the path,
   `Name (nF)`, joined with `, `.
5. `check.js`: add one warning. A location where 2+ cables end (arrive and aren't continued by `nextSpan`),
   and more than one of them isn't some equipment's tail (`eq.tail` pointing at its `cableStart`):
   "<n> cables end at <loc>; only <incomingCable name> feeds its splices." Use the existing `problem(...)`
   helper and style.
6. `styles.css`: whatever the stacked label rows need (small gap, same font sizes).

## Do not touch
counts.js, splices.js, connect.js, paths.js, equipment.js, the HANDOFF file.
Keep the code style: plain functions, `el`/`btnEl` helpers, short plain-English comments.

## Acceptance checks
Serve with `python -m http.server 8600`. In the console, after picking a user:
```js
plan = newPlan(); show('route');
const cab = placeStart('cabinet','CAB'); const hh = addLocation(cab.id,'handhole','HH');
plan.cables.push({ id: makeId(), name: 'F1', from: cab.id, to: hh.id, fibers: 144 });
const mk = () => fromTemplate(templateById('mst-8'), 'MST 8');
const t2 = mk(); const a = addLocation(hh.id,'pedestal','A',{equipment:[t2]}); setTail(a, t2, 150);
const t1 = mk(); const b = addLocation(a.id,'pedestal','B',{equipment:[t1]}); setTail(b, t1, 400, hh.id);
renderRoute();
```
- HH->A shows two green lines side by side and two label rows ("Terminal tail 1", "Terminal tail 2").
  Clicking each row opens that cable's form.
- A->B shows one green line ("Terminal tail 2 · continued").
- `checkPlan()` gives no "cables end at" warning here (both cables are tails).
- Push a plain cable ending at A as well (`{ name:'X', from: hh.id, to: a.id, fibers: 12 }`): the warning
  appears.
- The print sheet path table lists both cables on HH->A.
- No console errors. `git diff --stat` shows only grid.js, app.js, print.js, check.js, styles.css (and fold.js only if touched).

Write `T2-draw-multi-cable-REPORT.md` next to this file: what changed, the check results, anything unsure.
