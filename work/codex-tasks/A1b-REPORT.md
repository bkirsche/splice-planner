# A1b: Routes and splicing audit

Audited after A1a on 2026-10-29 at http://localhost:8600/, served with `python -m http.server 8600`. Findings are ordered by severity. Only report files were written.

### A1b-01: Shrinking a feeder leaves out-of-range splice picks and crashes its splice sheet
Severity: High (data loss/crash)
Where: paths.js:628 (f2Stuck), paths.js:544 (openPath/saveCable); features.js:401 (cable size column)
Steps: 1. Build Handhole -> Vault 1 -> home "123 Audit St". 2. Add a 12F cable from Handhole to Vault 1. 3. Open the home's 1F drop, add a manual range with incoming 12 to 12 and outgoing from 1, and Save. 4. Open the feeder, change Size from 12F to 1F, and Save. 5. Open Vault 1 -> Splice sheet (view / print). Reproduced in the browser.
Expected / Actual: The resize should be rejected while fiber 12 is connected, or the affected connections should be explicitly removed in an undoable operation. Instead the invalid range is saved; the route labels the feeder's demand as fiber 1 while the drop still picks incoming 12. Opening the sheet fails with `TypeError: Cannot read properties of undefined (reading 'fiberColor')` at splices.js:139 (fiberLabel), called by rowsAt at line 222. f2Stuck only checks manual splitter F2 values, not downstream picks or patches. The feature editor uses the same incomplete guard.
Suggested fix: Validate all picks, pins and cross-connect endpoints affected by a cable resize across its full run before saving. Also make sheet rendering tolerate an invalid fiber by displaying a broken connection rather than throwing.

### A1b-02: Reassigning a continued span rewrites the original upstream cable
Severity: High (data loss/crash)
Where: paths.js:504 (openPath/saveCable, pass/storage branch)
Steps: from code, not reproduced. Lay cable X from A through B to C, with C's span continuing A -> B. Have another cable Y arrive at B. Edit B -> C and choose "Y passes through B" (or slack stored), then Save.
Expected / Actual: B -> C and later spans should become part of Y; X's A -> B span must keep its own name and fiber count. The handler takes `cableSpans(c)` before changing c.prev, which includes X's upstream spans as well as the selected span and those after it. It then assigns Y's name and fiber count to every span in that old list. This silently changes the independent upstream cable and can change its capacity without checking uses at its upstream end. The guard also examines this overly broad span list.
Suggested fix: Use only the run starting at the selected span (cableRunFrom(c)) when changing the cable it continues. Preserve upstream spans and reconcile metadata/picks/pins that no longer apply to the reassigned run.

### A1b-03: Cable removal leaves saved patches to nonexistent fibers
Severity: Medium (wrong result, workaround exists)
Where: paths.js:693 (removeCableFrom)
Steps: from code, not reproduced. Patch an equipment port to a cable fiber in Connections, then remove that cable using its line menu or Remove cable in the path form. Reopen the location's splice list.
Expected / Actual: Removing a cable should also remove connections whose endpoints belong to it, with Undo restoring both. removeCableFrom only filters plan.cables. plan.xconnects, equipment tail IDs and tray keys are left untouched. connectionsAt still returns those patches; crossConnectTable prints them as "(removed fiber)" instead of removing them. The graphical editor no longer has an endpoint row for that fiber, which makes the stale patch harder to remove individually. Removing all connections or Undo is a workaround.
Suggested fix: Centralize cable deletion cleanup for every removed span and its physical-cable endpoint IDs, including patches, tail pointers and obsolete tray assignments. Run it within the caller's existing undo snapshot.

Areas not reached / limits:
- Browser reproduction covered manual range creation, cable resize and the resulting splice-sheet error. Continuation reassignment and patched-cable deletion above remain code-only findings.
- Grid placement, selection, group feeding/deletion and routing entry points were inspected; the geometric routing solver, crowded-grid label placement and touch/drag matrices were not exhaustively exercised.
- Connection editor lifecycle, trays, endpoint changes, equipment removal/cards/ports, feature editing and trace flow were reviewed, but not every hardware type or multi-cable/tail arrangement was tested in the browser.
- The subtree-deletion cleanup defect also appears in grid.js:1123 (removePicked); it is the same omission described in A1a-02, not an additional finding here.

