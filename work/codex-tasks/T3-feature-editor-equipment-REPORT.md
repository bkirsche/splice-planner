# T3 feature editor: equipment and homes report

Implemented on 2026-10-27. No commit was made.

## Changes

- Added `features-equipment.js`, registering Splice cases, Splitters, Terminals, Shelves, panels and other, and Homes through `addFeatureType` and the existing column interface.
- Equipment rows walk locations and their equipment in route order. Location is read-only immediately after Name. Home rows use the specified Name/Lot/Fed from/Splitter/F2/Field status/Phase columns.
- Added the specified model, tray, ratio, F2, tail, status and phase editing, required-name checks, splice maximum warning, used-port counts, conditional editing, and home relationship labels. Existing helpers perform tail and F2 operations; the existing feature editor handles Undo, bulk edits, sorting, filtering and Show.
- Splitter ratio options resolve a template by ID, or by style for splitters created by the current UI (which stores style without a template ID). A bulk ratio change also checks each item's style-specific options.
- Added the script immediately after `features.js` in `index.html`.
- Added the filename immediately after `"features.js"` in `sw.js` and incremented CACHE from v40 to v41.
- Did not edit `features.js`, `styles.css`, any other JavaScript file beyond the explicitly allowed `sw.js`, or anything in `handoff/`.

## Browser setup

Ran Python's HTTP server on port 8601 with `--bind 127.0.0.1`. Automatic approval review rejected the default all-interfaces bind because it could expose private project files beyond localhost; the localhost-only alternative was approved. The first `http://localhost:8601` attempt before the approved server was available timed out; testing then succeeded at `http://127.0.0.1:8601/`.

Selected Brian, chose New plan, and built the fixture entirely through the UI: HH-T3 handhole with a 2 x 12 splice case, 1x8 clamshell splitter with a 100 ft Inside tail, and a 4-port terminal with a 100 ft Inside tail; PED-T3 pedestal fed from HH-T3 with an 8-port terminal and a 150 ft routed tail; and homes 101 Test Lane (Lot 20) and 102 Test Lane (Lot 10) under PED-T3.

Extended the fixture through the UI with two Bare splitters at PED-T3 for the same-cable F2 conflict check, and an Other item named Test rack for gear Show/read-only checks. Later added a third home to exercise ratio-capacity rejection. Reloaded the final JavaScript and resumed the saved test plan before the last validation pass.

## Acceptance checks

1. **PASS: dropdown and counts.** Initially showed Splice cases (1), Splitters (1), Terminals (2), Shelves, panels and other (0), Homes (2). After adding test equipment it correctly showed Splitters (3) and Shelves, panels and other (1). After the extra capacity-test home, Homes (3).
2. **PASS for edit and Undo; existing chip wording differs from the literal spec.** Changed Trays from 2 to 3. Splices became 36 and the route chip became `HH-T3 · 36sp`. One Undo restored 2 trays, 24 splices and `HH-T3 · 24sp`. The existing `equipmentChip` helper in protected `equipment.js` formats closures as total splices, not `3 x slots`. Left that protected code unchanged; no override or replacement model/rendering code was added.
3. **PASS: F2 rejection and splitter tail editing.** Two Bare splitters at PED-T3 were fed by the same 8F terminal-tail cable with F2 1 and 2. Attempting to change 2 to 1 displayed the existing helper's text, `PED-T3 #1 already feeds PED-T3 at PED-T3.`, and the inputs stayed 2 and 1. Changing the clamshell Tail ft to 150 produced `150ft tail inside` on the route chip and `150 ft tail inside HH-T3` in the table. Clearing it removed the splitter tail; the chip became `1x8 · F2 1` and Tail became an em dash.
4. **PASS: bulk terminals and one Undo.** Ticked both terminals, selected Tail ft, entered 75, and chose Set on 2. Both table rows showed 75 ft, retaining the handhole terminal's Inside start and the pedestal terminal's routed tail. A single Undo restored 100 ft Inside and 150 ft respectively.
5. **PASS: home Lot edit, sort and filter.** Changed 101 Test Lane's Lot from 20 to 30. Sorting by Lot placed 102 Test Lane (10) before 101 Test Lane (30). Filtering by 30 left only 101 Test Lane. Clearing the filter restored both rows.
6. **PASS: Show for every new type.** Splice cases and Splitters selected HH-T3; the pedestal Terminal and Test rack gear row selected PED-T3; 101 Test Lane selected its home card. Verified the destination route card gained the `selected` class after each Show action.
7. **PASS: no console errors.** Inspected the browser's captured console warning/error logs during testing and after reloading the final code; all returned empty lists.
8. **PASS for intended code scope; Git display caveat.** Before writing this report, `git status --short` showed only modified `index.html`, modified `sw.js`, and untracked `features-equipment.js`. `git diff --stat` showed index.html (+1) and sw.js (+2/-2). Git does not include untracked files in ordinary diff statistics, so the new JavaScript file appears in status instead. Nothing was staged just to alter that display. This explicitly requested report is an additional untracked documentation file after this check.

## Additional validation

- `node --check features-equipment.js`: passed.
- `git diff --check`: passed (Git only emitted line-ending conversion notices).
- Empty home name rejected with exactly `Give it a name.`
- Zero trays rejected with `Enter at least 1 tray.`; rechecked after the final reload.
- Terminal tail of 5001 rejected with `Tail length is 1 to 5000 ft.`
- Clamshell Size offered only 1x4, 1x8, 1x12. Bare Size offered the standard ratios. Bare splitter Tail ft was read-only.
- With three homes on one Bare 1x8 splitter, choosing 1x2 rejected it with `PED-T3 1x8 splitter 1 has 3 homes on it; a 1x2 only has 2 ports.` Both Bare splitters remained 1x8.
- Other equipment showed Model and Ports as read-only em dashes.
- Home Field status accepted Built as planned, stored with the existing `built` option value.

## Deviations and limitations

- Used a localhost-only bind and the equivalent loopback IP URL for browser testing, as explained above.
- The literal splice-case chip wording in check 2 cannot match without changing or overriding the protected existing chip renderer. The underlying edit, splice count, refresh and Undo all worked.
- Ordinary Git diff statistics omit the untracked new file; status verifies it without staging. The report itself is included because the task expressly requests it despite the three-code-file scope rule.
- No other implementation deviations. No new model code, dependencies, build step, or commits.
