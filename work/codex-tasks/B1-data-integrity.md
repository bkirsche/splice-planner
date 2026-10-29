# B1: Data integrity fixes from audit A1

Fixes the five B1 findings of the A1 audit: A1a-01 and A1a-02 (`A1a-REPORT.md`), A1b-01, A1b-02 and A1b-03 (`A1b-REPORT.md`). Read both reports first: each finding has steps to reproduce and an expected result.

Claude already wrote the shared pieces (read them before you start, don't change them unless the report explains why):

- `connect.js` `purgeRemoved(pointIds, cableIds)`: removes locations and/or cable spans with everything that points at them (spans from or to a removed location, the rest of a removed span's run, patches, pins, tails, tray keys, homes' splitter/terminal ports). It does not snapshot or save: callers run it inside their own `withUndo`.
- `paths.js` `resizeStuck(spans, fibers)`: replaces `f2Stuck`. Returns a message naming what still uses a fiber above the new size (hand-set F2, picks from the cable, its own picks and joins, patches), or "".
- `splices.js` `fiberLabel`: a fiber the cable doesn't have shows as a broken connection (`missing: true`) instead of throwing.
- `ui.js` `clearUndo()`: empties the undo history and hides the undo bar.

## Wiring to do

1. **A1a-01, undo across plans.** Call `clearUndo()` at every plan boundary:
   - `app.js` New plan handler (`[data-start="new"]`, ~line 114), after `plan = newPlan()`.
   - `app.js` Start over handler (`backBtn`, ~line 252), when the plan is cleared.
   - `app.js` `resumeBtn` click handler.
   - `files.js` open-file code (~line 143): call `clearUndo()` before `offerUndo(...Opened...)`, so the open itself can still be undone (back to the plan that was on screen) but nothing older is reachable. Keep that offerUndo.
   - Any other place that assigns a whole new `plan` (grep `plan = ` in all .js files; `undoStep` in ui.js is the exception and must stay as is).
2. **A1a-02, removing locations.** In `app.js` `removeStop` and `grid.js` `removePicked`, replace the four `plan.* = plan.*.filter(...)` lines inside the `withUndo` callback with `purgeRemoved([...doomed])`.
3. **A1b-03, removing cables.** `paths.js` `removeCableFrom(c)` becomes `purgeRemoved([], cableRunFrom(c).map((x) => x.id))`. Keep its callers as they are (they already run inside `withUndo`, or `offerUndo` with a snapshot taken before).
4. **A1b-01, resizing below used fibers.** Claude already switched every `f2Stuck(` call to `resizeStuck(` (paths.js `saveCable` twice, `openBackRun`, `features.js` cable Size column). Check nothing else calls `f2Stuck`; only verify in the browser.
5. **A1b-02, pass/storage branch of `saveCable`** (`paths.js` ~line 500): use `cableRunFrom(c)` instead of `cableSpans(c)` for `spans`, so the guard and the rename/resize touch only the selected span and the spans after it. Upstream spans keep their own name and size. Also `delete span.pins` and `delete span.handOnly` next to the existing `delete span.picks`, since a through span splices nothing.
6. Bump `APP_VERSION` in `index.html` from "70" to "71" so the service worker serves the new files.

## Acceptance checks (browser)

Serve with `python -m http.server 8600` from this folder (or `.claude/launch.json` config `splice-planner`; ports 8600-8649 only). Use a throwaway plan. Clear localStorage first if an old plan is in the way. Watch the console the whole time.

1. **A1a-01:** follow the report's steps. After New plan, Ctrl+Z says "Nothing to undo." and the plan stays empty. Repeat with the Resume button and with opening a saved plan file (save one first with Save): Ctrl+Z after opening restores the plan that was on screen, and a second Ctrl+Z says "Nothing to undo."
2. **A1a-02:** build Handhole A -> B -> C, lay a tail from C back to A (equipment at C with a tail started at A, or a back cable from C), patch something at A to that tail if you can. Remove B (its menu, Remove). In the console, `plan.cables.filter(c => !plan.points.some(p => p.id === c.from) || !plan.points.some(p => p.id === c.to))` is `[]`, and no `plan.xconnects` endpoint names a removed cable or equipment. Undo puts every point, cable and patch back (compare `JSON.stringify(plan)` before and after). Repeat with the grid layout: pick B, Remove.
3. **A1b-01:** follow the report's steps. Saving the feeder at 1F is refused with a message naming the drop and #12 at Vault 1; the cable stays 12F. Same in the feature editor's Cables Size column. Then force the bad state in the console (set the feeder's `fibers` to 1 on every span, `savePlan()`), open Vault 1's splice sheet: it opens, and the row shows a broken connection (problem row), no error. Print / PDF of that location also opens without an error.
4. **A1b-02:** lay cable X from A through B to C (so B -> C continues A -> B), and cable Y arriving at B (a different route into B, or a second cable on A -> B). Edit B -> C, choose "Y passes through B", Save. X's A -> B span keeps its name and size; B -> C takes Y's name and size. Try it with Y smaller than a fiber used on B -> C onward: refused with the message.
5. **A1b-03:** patch an equipment port to a cable fiber in Connections, remove that cable (line menu, Remove cable). `plan.xconnects` has no endpoint on the removed spans, no `eq.tail` names a removed span, no `trays` key names one. Undo restores the cable and the patch.
6. No console errors at any point. Nothing else in the app changes behaviour.
7. `git diff --stat` touches only app.js, grid.js, paths.js, features.js, files.js, index.html (and connect.js / splices.js / ui.js only if the report explains a needed fix to Claude's code).

## Do not touch

- B2 findings (A1a-03 CSV import, A1a-04 field crew Save, A1c-*): later batch.
- `handoff/` (local notes), `D:\Projects\assembly-workshop\work\gene-success\gene.png`.
- No confirm pop-ups (Undo notes instead; only removing splice connections asks first). No new libraries.
- Do not commit or push. Write `B1-data-integrity-REPORT.md` next to this file: what changed per file, how you checked each acceptance item (with what you saw), anything you weren't sure about or any problem found in Claude's shared code.
