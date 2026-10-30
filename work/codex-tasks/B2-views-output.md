# B2: Views and output fixes from audit A1

Fixes the six B2 findings of the A1 audit: A1c-01..04 (`A1c-REPORT.md`) and A1a-03, A1a-04 (`A1a-REPORT.md`). Read both reports first: each finding has steps to reproduce and an expected result. B1 (`B1-data-integrity.md`) is merged; follow the same style.

Claude already wrote the shared pieces. Read them before you start, and don't change them unless your report explains why:

- `connect.js` `spliceSlots(model, L)`: the ONE tray/slot map for a location. Slots go to the location's real splices (`connectionsAt`, patches left out), all phases, before any display filtering. Returns a `Map` from splice key to `{ tray, slot }`, or `null` when the location has no splice case and no slots set by hand. An unspliced row's key isn't in the map, so it has no slot.
- `phases.js` `phaseVisible(obj, ...locs)`: the phase rule for every print summary and export. Something shows when it and every location it sits at or runs between are in a phase on screen. `existingNote(obj)` gives "Existing · Phase 1" for work from a phase before the one on screen, or "". `shownSpans(c)` gives a cable's spans from its start up to the first span in a later phase (empty if the start span is in a later phase).
- `counts.js` `shownUsedPorts(eq)`: works like `usedPorts(eq)`, but counts only homes in a phase on screen.

## Wiring to do

1. **A1c-03, one slot map.** Replace every `traySlots(...)` call outside `connect.js`'s own `traySlots`/`spliceSlots` with `spliceSlots(model, L)`:
   - `connect.js` splice editor (~line 600 in `renderBody` or similar: `const slots = traySlots(L, conns...)`): use `spliceSlots(model, L) || new Map()`, because the editor calls `slots.get` without a check.
   - `splices.js` `spliceTable` (~line 289): `const trays = spliceSlots(model, L);`.
   - `check.js` (~line 190-194): use `spliceSlots(model, p)` for `slots`. Keep the `closure || trays` guard (or use the null return value instead).
   - `print.js` `checklist(L, rows)` becomes `checklist(model, L, rows)` with `const trays = spliceSlots(model, L);`. Update both callers: `print.js` `locationPage` (~line 826, `model` is in scope) and `splices.js` `renderSpliceBody` drawing view (~line 384, `model` is in scope).
   - Then grep `traySlots(`: only the definition and `spliceSlots` itself may call it.
2. **A1c-02, phase rule in print summaries** (`print.js`). Use `phaseVisible`, `existingNote`, `shownSpans`, `shownUsedPorts`:
   - `homesTable`: homes = `phaseVisible(h)`. The count in the heading follows the filtered list. A home from an earlier phase gets the row class `existing`, and its Address cell gets the `existingNote(h)` text after the address (for example "12 Elm St · Existing · Phase 1").
   - `cableTable`: leave out cables whose `shownSpans(c)` is empty. From, To and Via come from the shown spans only (To = the end of the last shown span). The Fibers used cell (`cableNote`) stays as is. Mark earlier-phase cables `existing` in the same way (class plus note after the name).
   - `splitterTable`: only `phaseVisible(s, p)`. "DS ports used" uses `shownUsedPorts(s).size`. Mark earlier-phase splitters `existing`.
   - `pathTable`: only paths with `phaseVisible(x, point(x.from), point(x.to))` (paths have no phase of their own, so the locations decide). The Cable cell lists only cables with `phaseVisible(c, point(c.from), point(c.to))`.
   - `detailsTable`: only `phaseVisible(p)`.
   - The `existing` row class probably already has print styling (`tr.existing` from the checklist). Check `styles.css`, and add a matching rule for `.sheet-table tr.existing` only if none applies.
   - With "All phases" (or no phases) on screen, every table must come out exactly as before.
3. **A1c-02, Excel export** (`table.js` `saveAssignmentXlsx`). The Homes sheet already follows the phase via `assignmentGroups(true)`. The Splitters sheet loops `allSplitters()` unfiltered: keep only `phaseVisible(s, loc)`, and use `shownUsedPorts(s).size` for Ports used and Ports free. Don't change `allSplitters()` itself (the table's own controls use it).
4. **A1c-01, Home counts with no splitter** (`counts.js` `homeCountEditor`, ~line 420). `homeSplitter(home)` can return null (the cascade case in the report). With `s` null:
   - The view text reads "No splitter · no DS" (no `f2Label(null)` call).
   - The splitter select gets a first option `{ value: "", label: "Pick a splitter" }`, selected. No option is disabled by `s.id`.
   - The DS port select shows only "No DS" and is disabled until a splitter is picked.
   - Picking a splitter puts the home on that splitter's next free port, as the change handler does now.
   - Check the other places that call `f2Label(homeSplitter(...))` or `usedPorts(homeSplitter(...))` the same way (grep `homeSplitter(` in counts.js, table.js, print.js): none may throw on null. `print.js` home rows already show "—" for a missing F2/DS. Keep that.
5. **A1c-04, failed Number in order** (`table.js` `tableSplitterTools` `number`, ~line 198). Validate before changing the plan. Simulate the run first without writing anything: for each ticked splitter in order, find `got` from `f2Choices(loc, s)` as now, keep the result in a local list, and pass the counts the earlier ones took so they don't block each other. If `f2Choices` reads `s.f2` from the plan, set and restore the fields in place in a `try/finally` instead of replacing `plan`. Write `s.f2` / `s.f2Manual` only after every splitter has passed. On failure: show the same message, and leave `plan` the same object, unchanged (`JSON.stringify(plan)` equal to before). Remove the `plan = migratePlan(JSON.parse(before))` line. If the in-place approach isn't possible, keep the snapshot but call `renderTable()` right after, and say why in the report.
6. **A1a-03, CSV delimiter** (`import.js` `guessDelimiter`, ~line 131). Count each candidate separator outside quoted fields only. A `"` opens and closes a quoted field, and `""` inside quotes is a literal quote. Score per line over the first ~20 nonblank lines. Prefer the candidate whose count is the same (and > 0) on the most lines, then the higher count. Keep the current candidates and the current fallback. Check that the parser that splits the rows already respects quotes. If it doesn't, fix it the same way.
7. **A1a-04, crew Save** (`index.html` ~line 111, `styles.css` ~line 1342). Field crews (`body.guest`) must see and use Save (`#share-plan`). Remove `edit-only` from `#share-plan` and give it a new class `file-action`, meaning "saving or exporting: shown to everyone". Don't add `file-action` to the hide rule. Check that files.js's Save handler doesn't call `guestBlocked()`. The report says it doesn't. Leave Autosave (`#autosave`) edit-only. Look for other save or export buttons hidden by `edit-only` (Excel export in Table layout, Save in Print): a crew may use them if they don't change the plan. Give those `file-action` too, and list them in the report.
8. Bump `APP_VERSION` in `index.html` from "71" to "72".

## Acceptance checks (browser)

Serve with `python -m http.server 8602` from this folder (8600 is often taken by another checkout; any free port in 8600-8649 is fine, never outside it). Use a throwaway plan. Clear localStorage first if an old plan is in the way. Watch the console the whole time.

1. **A1c-01:** follow the report's steps. Home counts opens. The home reads "No splitter · no DS", has "Pick a splitter" selected and the DS select disabled. Picking the splitter puts the home on a port and saves. No error.
2. **A1c-02:** follow the report's steps (Phase 1 home, Phase 2 home, Phase 1 on screen, Print / PDF with Summary tables). `#print-sheet .summary-page` says "Homes (1)", has no 999 Future Ave or its drop, and no Phase 2 cable, splitter, path or location details. Then put Phase 2 on screen: both homes show, and the Phase 1 one is marked Existing · Phase 1. Then pick All phases: same as before the change. For Excel, run the Splitters-sheet row builder in the console (or put a breakpoint), or say in the report how you checked it: with Phase 1 on screen, a Phase 2 splitter isn't listed.
3. **A1c-03:** follow the report's steps. The connected drop is tray-slot 1-1 in the editor, the list view, the Drawing checklist and the printed location page. The unspliced splitter input row has an empty Tray-slot cell. Add a Phase 2 splice at the same location and print with Phase 1 on screen: Phase 1 splices keep the same slots as with All phases.
4. **A1c-04:** follow the report's steps. After the failed Number in order, choosing F2 1 in the splitter's dropdown sticks: the dropdown shows F2 1 after the redraw, and `plan` has it. A successful Number in order still works and still offers Undo.
5. **A1a-03:** paste the report's CSV. Step 2 shows two columns, Address and Lot. The lots are 1 and 2, and the address column has the full quoted address with its semicolons. A plain semicolon file and a tab file still detect correctly.
6. **A1a-04:** switch Who is working to Field crew. Save is visible and saves the plan file (or opens the save window). Import homes, Start over and Autosave stay hidden.
7. No console errors at any point. Nothing else in the app changes behaviour.
8. `git diff --stat` touches only print.js, splices.js, connect.js (the editor call site), check.js, counts.js (`homeCountEditor`), table.js, import.js, index.html, styles.css, plus the shared files only if the report explains a needed fix.

## Do not touch

- `handoff/` (local notes), `D:\Projects\assembly-workshop\work\gene-success\gene.png`.
- The known 11x17 overview spill.
- No confirm pop-ups (Undo notes instead; only removing splice connections asks first). No new libraries.
- Do not commit or push. Write `B2-views-output-REPORT.md` next to this file: what changed per file, how you checked each acceptance item (with what you saw), and anything you weren't sure about or any problem you found in Claude's shared code.
