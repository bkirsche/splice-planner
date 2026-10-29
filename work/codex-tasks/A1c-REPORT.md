# A1c: Views and output audit

Audited after A1a and A1b on 2026-10-29 at http://localhost:8600/, served with `python -m http.server 8600`. Browser testing used a disposable plan with Handhole -> Vault 1, a closure at each location (two areas), a 12F feeder and separate 4F terminal tail sharing a path, a bare 1x8 splitter, a terminal, two homes in two phases, a manual connection and a field note. Findings are ordered by severity.

### A1c-01: Home counts crashes when the nearest splitter is a cascade and a home has no splitter
Severity: High (data loss/crash)
Where: counts.js:414 (homeCountEditor)
Steps: 1. At a location with a splice case and an unspliced (handOnly) splitter, add a home and its drop. 2. In the splice editor, connect splitter output 1 to drop fiber 1; leave the splitter input unspliced. 3. In Table layout, set that home's Splitter dropdown to No splitter. With no homes left assigned to its outputs, isCascade now classifies the splitter as a cascade because of the cable pin. 4. Open the location's menu -> Home counts (F2 / DS). Reproduced at Vault 1 in the browser.
Expected / Actual: The dialog should open with an unassigned home and allow choosing a splitter or terminal port. Instead it does not open: `TypeError: Cannot read properties of null (reading 'f2')` at counts.js:136 (f2Label), called by homeCountEditor at line 414 and the Home counts render at line 677. The function checks whether the nearest location has splitters, but assumes that homeSplitter(home) returns one; it can legitimately return null for the cascade case. Later uses of s.id and usedPorts(s) make the same assumption.
Suggested fix: Handle a null homeSplitter result throughout homeCountEditor and render an explicit unassigned state with available choices. Do not infer that every home has a selected splitter merely because an upstream location contains one.

### A1c-02: Phase-specific print summaries include future homes and hardware
Severity: Medium (wrong result, workaround exists)
Where: print.js:691 (homesTable); print.js:588 (cableTable), print.js:619 (splitterTable), print.js:646 (pathTable), print.js:671 (detailsTable)
Steps: 1. Create 123 Audit St in Phase 1. 2. Add Phase 2 and create 999 Future Ave there. 3. Select Phase 1; confirm the future home disappears from the route. 4. Open Print / PDF with Summary tables enabled. 5. Inspect the generated browser DOM at #print-sheet .summary-page. Reproduced without writing a PDF.
Expected / Actual: A Phase 1 print should list Phase 1 work, consistent with the overview and location pages. The generated overview subtitle says "Phase 1 (earlier phases marked existing)", but the summary says "Homes (2)" and includes 999 Future Ave and its Drop 2. homesTable iterates all NIDs without phaseShown; the cable, splitter, conduit and details summary builders likewise omit phase filtering, so later-phase work leaks into the same packet. Disabling Summary tables is a workaround.
Suggested fix: Apply consistent visibility rules to every summary section and its counts, including both equipment and cable phases, and mark earlier work as existing where applicable.

### A1c-03: Drawing and printed checklists assign different tray slots from the splice editor
Severity: Medium (wrong result, workaround exists)
Where: print.js:1234 (checklist)
Steps: 1. Use a splice location with a 4-tray, 24-slot case, a splitter whose input is not spliced, and a 1F home drop. 2. Connect splitter output 1 to drop fiber 1. 3. Observe the splice editor: "Tray 1 slot 1: Drop 1 #1 Blue", with the connected row's Tray=1 and Slot=1. 4. Click Splice sheet and inspect Drawing's checklist. Reproduced at Vault 1, in Phase 1.
Expected / Actual: The connected drop should have the same tray and slot everywhere. Drawing lists the unspliced splitter input as tray-slot 1-1 and the connected drop as 1-2. The editor and list view allocate slots from actual non-patch connections; checklist allocates them from every displayed demand row, including unspliced rows. Phase filtering can also change the key set and renumber automatic slots. The printed location page calls this same checklist function, so the inconsistency reaches crew output. Manually pinning the connected splice's slot is a workaround.
Suggested fix: Compute one canonical slot map from the location's actual connections before filtering rows for display, and share it between the editor, list, drawing and printed checklist. Leave unspliced rows without an occupied slot.

### A1c-04: A failed F2 numbering action leaves table controls editing detached objects
Severity: Medium (wrong result, workaround exists)
Where: table.js:213 (tableSplitterTools/number)
Steps: 1. In Table layout, tick a splitter fed by a 12F cable and currently showing No F2. 2. Enter First F2 fiber=999 and press Number in order. 3. After "No free fiber from F2 999...", use that splitter's F2 dropdown and choose F2 1. Reproduced in the browser.
Expected / Actual: The valid individual edit should persist after the failed bulk attempt. Instead the note says "Vault 1 1x8 splitter at Vault 1 is now F2 1, set by hand", but the rebuilt dropdown still says No F2. On bulk failure, plan is replaced with a parsed snapshot without rebuilding the table. Its callbacks still capture the old splitter/home objects; the next edit mutates the detached object while savePlan saves the restored plan. Re-rendering the table before retrying is a workaround; repeating Number in order also retains stale captured ticked objects until a redraw.
Suggested fix: Validate the entire numbering operation before mutating plan, or restore changed fields in place. If a snapshot replacement is necessary, immediately rebuild the table and resolve callback targets by ID against the current plan.

Areas not reached / limits:
- Confirmed summary/checklist content using browser DOM and the on-screen drawing preview; native PDF printer output, physical page dimensions and printer-specific pagination were not verified. The already-known 11x17 overview spill was excluded.
- Area construction/navigation helpers, phase naming/tagging, count assignment, table sorting/filtering/export, checks/fix flows, field notes/photos and print CSS were inspected. Large crowded area maps, all Fix all conflict combinations, photo upload races and mobile layouts/gestures were not exhaustively exercised.
- Real Excel export/download and workbook opening were not exercised. Code inspection shows the Splitters sheet uses allSplitters() without the phase/filter constraints used for Homes; this is related output-filter coverage to review, not counted as an additional reproduced finding.
- The crew Save visibility issue discovered while following field notes into index.html is recorded in A1a-04 because its root cause is in A1a's files.
