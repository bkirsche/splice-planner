# B1: Data integrity fixes, report

Codex did the wiring in the spec but wrote no report. Claude reviewed the diff and ran every acceptance check in the browser (http://localhost:8600, worktree served, APP_VERSION 71). Checks were scripted in the page console against the real handlers (the Remove buttons, the cable form's Save, Ctrl+Z, the Start over, New plan and Resume buttons, and loadPlanText).

## Changes

- Claude (159af8c): `purgeRemoved` (connect.js), `resizeStuck`, which replaces `f2Stuck` at all four callers (paths.js, features.js), a `fiberLabel` that can't throw (splices.js), and `clearUndo` (ui.js).
- Codex (wiring):
  - `clearUndo()` in New plan, Start over and Resume (app.js) and before the Opened step (files.js).
  - `purgeRemoved([...doomed])` in `removeStop` (app.js) and `removePicked` (grid.js).
  - `removeCableFrom` now calls `purgeRemoved`.
  - The pass/storage branch of `saveCable` uses `cableRunFrom(c)` and also drops the span's pins and handOnly.
  - APP_VERSION 70 to 71.

  The diff matches the spec line for line. The other two `plan =` assignments (check.js:807, table.js:213) restore in-plan snapshots and are correctly left alone.

## Acceptance checks

1. **A1a-01:** removed a location (1 undo step). Pressed Start over twice, then New plan: 0 steps left. Ctrl+Z showed "Nothing to undo." and the new plan stayed empty. After Resume: 0 steps. After opening a file (with an older step on the stack), the only step left was the Opened step.
2. **A1a-02:** A -> B -> C, with cable X from A to C and tail T from C back to A (C's splitter `tail` = T). Patches at A on T's last span and on X, and a tray key at A on T. Removing B through its Remove button:
   - Points left: A only. Cables left: none (T's B -> A span went with its run). Dangling cables: 0.
   - Patches, tray keys: none.
   - Undo restored points, cables, paths and patches exactly (JSON identical).

   The same through the grid's `removePicked` gave 0 dangling and the same exact restore.
3. **A1b-01:** report setup (12F feeder, drop picking incoming 12).
   - Cable form, Size 1F, Save: refused with "The cable can't be 1F: Drop at Vault 1 picks #12. Free those fibers first." The feeder stays 12F.
   - Feature editor Size check: same message.
   - Forced the feeder to 1F in the console: the splice sheet opens and shows a problem row "Feeder #12, not on this 1F cable". printLocation, buildSheet and openConnections ran without errors.
4. **A1b-02:** X (24F) from A through B to C, Y (12F) on A -> B, a drop at C picking #20. Choosing "Y passes through B" on B -> C was refused ("Drop at C picks #20"). With the pick removed it saved: A -> B is still X/24F, and B -> C is Y/12F through, continuing Y.
5. **A1b-03:** removing T (withUndo + removeCableFrom): its patch, the splitter's `tail` and the tray key went with it. X's patch stayed. Undo restored everything exactly.
6. No console errors throughout (window error listener and console both empty).

## Notes

- Picks on surviving cables aren't rewritten when their feeding cable is removed. They don't store a cable ID, and the splice sheet already shows "No cable reaches …" for them.
- Surviving spans of a cable that ran into a removed location are kept, now ending earlier. A run going back up the route from inside the removed subtree goes completely.
