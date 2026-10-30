# B9 index lookups report

Date: 2026-10-30.

Branch: `claude/b9-big-plan-speed-eb543a`, HEAD `eb7f044f800aa802a2e84db8f88706f1dbb1df49`. Pulled with `git pull --ff-only`: already up to date. Main: `5e24cd0da35976b64ff853c838bc75554355622f` (also origin/main). No commit or push.

## Changes

Ten expression substitutions in seven JavaScript files; first-match order, guards, missing-result handling, and object identity are preserved. No indexed helpers or other protected files changed.

| Location | Old | New |
| --- | --- | --- |
| connect.js:107 | `plan.cables.find((x) => x.id === id)` | `cableById(id)` |
| connect.js:282 | `plan.cables.find((c) => c.id === id)` | `cableById(id)` |
| connect.js:415 | `plan.cables.find((x) => x.id === id)` | `cableById(id)` |
| connect.js:486 | `plan.cables.find((x) => x.id === id)` | `cableById(id)` |
| counts.js:602 | `plan.paths.filter((x) => x.from === id)` | `childPaths(id)` |
| equipment.js:33 | `plan.cables.find((x) => x.id === eq.tail)` | `cableById(eq.tail)` |
| import.js:656 | `plan.points.find((p) => p.id === fromId)` | `point(fromId)` |
| paths.js:522 | `plan.cables.find((x) => x.id === m.split(":")[1])` | `cableById(m.split(":")[1])` |
| print.js:452 | `plan.paths.find((x) => x.to === id)` | `incomingPath(id)` |
| splices.js:159 | `plan.cables.find((c) => c.id === id)` | `cableById(id)` |

`counts.js:602` iterates the filtered paths without changing the returned array or the plan lists. The helper returns the same paths in the same order. `import.js:656` reads the source name before the Undo callback adds homes/paths/cables. `paths.js:522` reads the arriving cable before the possible cable push at line 535; it is not a search after a list mutation. The other replacements only read objects. No candidate required leaving an otherwise equivalent lookup after a push/splice.

## Searches left unchanged

All root JavaScript files were scanned for plan.points / plan.cables / plan.paths and find/filter/some/every, including multiline chains and manual loops. The 56 remaining direct search lines are listed below. No remaining exact pattern from the task table is eligible outside the protected fallbacks.

| Location | Existing search | Reason |
| --- | --- | --- |
| app.js:289 | `return ix ? ix.point.get(id) : plan.points.find((p) => p.id === id);` | Protected helper fallback; left unchanged as instructed. |
| app.js:294 | `return ix ? (ix.pathsFrom.get(id) &#124;&#124; []).slice() : plan.paths.filter((x) => x.from === id);` | Protected helper fallback; left unchanged as instructed. |
| app.js:299 | `return ix ? ix.pathTo.get(id) : plan.paths.find((x) => x.to === id);` | Protected helper fallback; left unchanged as instructed. |
| app.js:304 | `return ix ? ix.cable.get(id) : plan.cables.find((x) => x.id === id);` | Protected helper fallback; left unchanged as instructed. |
| app.js:323 | `return plan.cables.filter((c) => c.to === path.to ? !againstPath(c) : c.from === path.to && c.to === path.from);` | pathCables tests direction, endpoints and againstPath; none of the six helpers returns this set. |
| app.js:353 | `return ix ? (ix.cablesFrom.get(id) &#124;&#124; []).slice() : plan.cables.filter((c) => c.from === id);` | Protected helper fallback; left unchanged as instructed. |
| app.js:361 | `return c.prev ? plan.cables.find((x) => x.id === c.prev) : plan.cables.find((x) => x.to === c.from);` | Protected helper fallback; left unchanged as instructed. |
| app.js:367 | `if (!ix) return plan.cables.find((x) => x.through && x.from === c.to && prevSpan(x) === c);` | Protected helper fallback; left unchanged as instructed. |
| app.js:499 | `const n = plan.points.filter((p) => p.type === type).length + 1;` | Counts locations by type, not by id. |
| areas.js:39 | `return plan.points.filter((p) => isAreaStart(p) && phaseShown(p));` | Area, closure, home/street and/or phase predicate; not an id/from/to lookup. |
| areas.js:64 | `return plan.points.filter((p) => p.type !== "nid" && phaseShown(p) && (p.equipment &#124;&#124; []).some((e) => e.type === "closure")).length;` | Area, closure, home/street and/or phase predicate; not an id/from/to lookup. |
| areas.js:138 | `return byStreet(plan.points.filter((p) => p.type === "nid" && phaseShown(p)));` | Area, closure, home/street and/or phase predicate; not an id/from/to lookup. |
| areas.js:511 | `const homes = plan.points.filter((h) => h.type === "nid" && phaseShown(h) && homeStreet(h).street === street);` | Area, closure, home/street and/or phase predicate; not an id/from/to lookup. |
| check.js:86 | `const ends = plan.cables.filter((c) => c.to === p.id && !nextSpan(c));` | Matches cable destination and absence of next span; incomingCable has different selection rules. |
| check.js:246 | `const homes = plan.points.filter((h) => h.type === "nid" && homeSplitter(h) === s);` | Type, DS, splitter, port and/or through predicate; not an exact id/from/to lookup. |
| check.js:320 | `const sharing = plan.points.filter((h) => h.type === "nid" && h.ds && h.ds.splitterId === s.id && h.ds.port === p.ds.port);` | Type, DS, splitter, port and/or through predicate; not an exact id/from/to lookup. |
| check.js:334 | `for (const h of plan.points.filter((x) => x.type === "nid")) {` | Type, DS, splitter, port and/or through predicate; not an exact id/from/to lookup. |
| check.js:342 | `for (const start of plan.cables.filter((x) => !x.through)) {` | Type, DS, splitter, port and/or through predicate; not an exact id/from/to lookup. |
| check.js:361 | `for (const c of plan.cables.filter((x) => !x.through)) {` | Type, DS, splitter, port and/or through predicate; not an exact id/from/to lookup. |
| connect.js:80 | `plan.points = plan.points.filter((p) => !points.has(p.id));` | Removal filter by a set of ids; mutates the list. |
| connect.js:81 | `plan.paths = plan.paths.filter((x) => !points.has(x.from) && !points.has(x.to));` | Removal filter by both endpoints; follows point-list replacement. |
| connect.js:82 | `plan.cables = plan.cables.filter((c) => !cables.has(c.id));` | Removal filter by a set of cable ids; follows point/path-list replacement. |
| counts.js:29 | `return ix ? ix.eqAt.get(eqId) : plan.points.find((p) => (p.equipment &#124;&#124; []).some((e) => e.id === eqId));` | Protected helper fallback; left unchanged as instructed. |
| counts.js:214 | `return onward && !plan.points.some((h) => h.type === "nid" && h.ds && h.ds.splitterId === eq.id);` | Tests whether any home uses this splitter, including type and DS fields. |
| counts.js:221 | `plan.cables.some((c) => Object.values(c.pins &#124;&#124; {}).some((it) => it.startsWith(`port:${eq.id}:`)));` | Tests pin values across all cables; no id/from/to lookup. |
| counts.js:451 | `const other = plan.points.find((h) => h !== home && h.tport && h.tport.eqId === eq.id && h.tport.portId === portId);` | Terminal port occupancy search using tport equipment/port fields and additional predicates; no equivalent helper; terminal logic left unchanged. |
| counts.js:526 | `const other = plan.points.find((h) => h !== home && h.tport && h.tport.eqId === eq.id && h.tport.portId === port.id);` | Terminal port occupancy search using tport equipment/port fields and additional predicates; no equivalent helper; terminal logic left unchanged. |
| counts.js:764 | `const h = plan.points.find((x) => x.tport && x.tport.eqId === device.id && x.tport.portId === port.id);` | Terminal port occupancy search using tport equipment/port fields and additional predicates; no equivalent helper; terminal logic left unchanged. |
| equipment.js:54 | `for (const c of plan.cables.filter((x) => x.to === loc.id && x.name === oldName && !nextSpan(x))) {` | Tests destination, name and absence of next span. |
| equipment.js:64 | `if (!owner &#124;&#124; !plan.cables.some((x) => x !== start && x.name === start.name && !x.through)) return start.name;` | Tests another cable with the same name and no through span. |
| equipment.js:104 | `const others = plan.points.filter((p) => p.type !== "nid" && !out.includes(p.id) && !below.has(p.id))` | Tests type and membership in two exclusion sets. |
| equipment.js:342 | `const onIt = plan.points.filter((h) => h.ds && h.ds.splitterId === eq.id);` | Matches DS splitterId, not a point id. |
| features-equipment.js:147 | `rows: () => plan.points.filter((p) => p.type === "nid"),` | Type and/or phase filter, not an exact id/from/to lookup. |
| features.js:397 | `rows: () => plan.points.filter((p) => types.includes(p.type)),` | Type and/or phase filter, not an exact id/from/to lookup. |
| features.js:446 | `rows: () => plan.cables.filter((c) => !c.through),` | Type and/or phase filter, not an exact id/from/to lookup. |
| fold.js:40 | `return plan ? plan.points.filter((p) => p.type === "nid" && phaseShown(p)).length : 0;` | Type and/or phase filter, not an exact id/from/to lookup. |
| grid.js:85 | `if (!plan.points.some(hasCell)) return tidyCells();` | Existence test for any cell, not an id lookup. |
| grid.js:124 | `const shown = plan.points.filter((p) => phaseShown(p));` | Visibility filter, not an id lookup. |
| grid.js:873 | `const taken = new Set(plan.points.filter((x) => !ids.has(x.id) && hasCell(x)).map((x) => cellKey(x.cell.c, x.cell.r)));` | Tests exclusion-set membership and cell presence. |
| grid.js:913 | `return plan ? plan.points.filter((p) => gridPicked.has(p.id) && p.id !== plan.points[0].id) : [];` | Tests picked membership and excludes the start. |
| grid.js:1071 | `const feeders = plan.points.filter((p) => p.type !== "nid");` | Type and/or phase filter, not an exact id/from/to lookup. |
| grid.js:1080 | `: terminalPorts(d).filter((x) => !plan.points.some((h) => !homes.includes(h) && h.tport && h.tport.eqId === d.id && h.tport.portId === x.id)).length;` | Terminal port occupancy search using tport equipment/port fields and additional predicates; no equivalent helper; terminal logic left unchanged. |
| grid.js:1124 | `const taken = new Set(plan.points.filter((x) => x.tport && x.tport.eqId === d.id).map((x) => x.tport.portId));` | Terminal port occupancy search using tport equipment/port fields and additional predicates; no equivalent helper; terminal logic left unchanged. |
| import.js:297 | `const existing = new Set([...plan.points.filter((p) => p.type === "nid"), ...plan.unassigned]` | Type and/or phase filter, not an exact id/from/to lookup. |
| import.js:449 | `const drops = new Set(plan.cables.filter((c) => ids.has(c.to) &#124;&#124; ids.has(c.from)).map((c) => c.id));` | Tests membership of both cable endpoints in a set. |
| import.js:506 | `const feeders = plan.points.filter((p) => p.type !== "nid").sort((a, b) => naturally(a.name, b.name));` | Type and/or phase filter, not an exact id/from/to lookup. |
| paths.js:257 | `const arriving = plan.cables.filter((x) => x.to === from.id && x.from !== to.id && (!nextSpan(x) &#124;&#124; nextSpan(x) === c));` | Tests destination, different source, and next-span relationship. |
| print.js:617 | `const starts = plan.cables.filter((c) => !c.through && !isDrop(c) && shownSpans(c).length);` | Tests through, drop classification and shown spans. |
| print.js:675 | `const rows = plan.paths.filter((x) => conduitLabel(x.conduit) && phaseVisible(x, point(x.from), point(x.to)));` | Tests conduit label and phase visibility. |
| print.js:700 | `const rows = plan.points.filter((p) => phaseVisible(p) && detailLines(p).length);` | Tests phase visibility and detail-line presence. |
| print.js:720 | `const homes = plan.points.filter((p) => p.type === "nid" && phaseVisible(p));` | Tests home type and phase visibility. |
| splices.js:162 | `const home = plan.points.find((h) => h.type === "nid" && homeItem(h) === item);` | Tests home type and homeItem identity, not point id. |
| splices.js:255 | `return plan.points.filter((p) => {` | Tests type, visibility, splice rows, through spans and patches. |
| table.js:501 | `const homesAll = plan.points.filter((p) => p.type === "nid");` | Type and/or phase filter, not an exact id/from/to lookup. |
| trace.js:14 | `const drop = plan.cables.find((c) => c.to === home.id);` | Finds first cable by to. No equivalent allowed helper: incomingCable also examines direction and through spans, and can choose another cable. |
| trace.js:62 | `const homes = sortHomes(plan.points.filter((p) => p.type === "nid"));` | Type and/or phase filter, not an exact id/from/to lookup. |

Additional scans: `edits.js:19-21` filters type and downstream exclusion across a multiline chain. `connect.js:20` returns an equipment item, `counts.js:78` returns a splitter, and `splices.js:146` returns a splitter/location pair; equipmentLocation returns only a location and does not replace their predicates/return shape. `equipment.js:41` searches by eq.tail, not equipment id. No helper was added for these patterns. The remaining full-list loops collect, mutate, count, render, or build indexes; they are not any of the six lookup patterns. `planindex.js` was read only and remains unchanged. Searches in `tools/perfcheck.js` were left unchanged as required.

## Comparison setup

Branch served from the existing worktree on `http://127.0.0.1:8600`; main archived into `C:/Users/brian/Documents/ChatGPT/Offloading/b9-main` and served on `http://127.0.0.1:8601`. Both Python servers bind to loopback. The two specified sample plans were copied into handoff/samples in both folders. Main received an unchanged copy of tools/perfcheck.js from the branch. No sample is staged or committed.

Browser: Playwright-controlled Edge, headless, fixed 1440 × 1000 viewport. One browser context and the same single tab throughout: main Vault, main Saratoga, then branch Vault, branch Saratoga. The unmodified harness was fetched and evaluated in the page, with each plan fetched locally. No CPU/network throttling. Results: `work/b9-main.json` and `work/b9-branch.json` (local only). Console/page errors are recorded in `work/b9-console.json`.

PR baseline: https://github.com/bkirsche/splice-planner/pull/41. PR table values are the after/branch columns; its Undo range uses the upper bound (160 ms). The PR has no feature-editor-open row.

## Output equality

| out key | Vault main | Vault branch | Result | Saratoga main | Saratoga branch | Result |
| --- | --- | --- | --- | --- | --- | --- |
| open plan | `d9eafe86:118815 3d516824:6712` | `d9eafe86:118815 3d516824:6712` | same | `6fd06025:286261 96628c49:809878` | `6fd06025:286261 96628c49:809878` | same |
| findings | `718861ad:52277` | `718861ad:52277` | same | `02cd2456:73245` | `02cd2456:73245` | same |
| counts | `98b63f89:20340` | `98b63f89:20340` | same | `d7f1d612:42640` | `d7f1d612:42640` | same |
| slots | `e9668801:76557` | `e9668801:76557` | same | `e6d7d5d6:211336` | `e6d7d5d6:211336` | same |
| open area page | `acbe2872:17235` | `acbe2872:17235` | same | `336a47fd:816456` | `336a47fd:816456` | same |
| full route | `3671114c:254081` | `3671114c:254081` | same | `b0008e29:1366470` | `b0008e29:1366470` | same |
| compact route | `9665ac07:72797` | `9665ac07:72797` | same | `217ed9bd:926295` | `217ed9bd:926295` | same |
| grid layout | `54f7741f:262550` | `54f7741f:262550` | same | `8f1048c0:1449266` | `8f1048c0:1449266` | same |
| table layout | `11009b21:798666` | `11009b21:798666` | same | `4e82661f:2857354` | `4e82661f:2857354` | same |
| unassign 6 homes | `532b82b5:116551` | `532b82b5:116551` | same | `15c92469:283913` | `15c92469:283913` | same |
| assign 6 homes | `9780064a:118910 d98794ed:52277 956a6d9d:20340` | `9780064a:118910 d98794ed:52277 956a6d9d:20340` | same | `5dafd6dd:286578 9c5e05b4:74587 39be8ba6:42640` | `5dafd6dd:286578 9c5e05b4:74587 39be8ba6:42640` | same |
| rename location | `2361b432:118912 8780d60f:878014` | `2361b432:118912 8780d60f:878014` | same | `7b9df675:286580 71c13383:2991878` | `7b9df675:286580 71c13383:2991878` | same |
| splice in editor | `1b6066e8:118951 31b1c7a5:76754` | `1b6066e8:118951 31b1c7a5:76754` | same | `097d45b3:286619 fae596e3:210087` | `097d45b3:286619 fae596e3:210087` | same |
| feature editor edit | `5f4830b6:118951` | `5f4830b6:118951` | same | `f1778cd9:286619` | `f1778cd9:286619` | same |
| feature editor bulk set | `1ff5784e:119012` | `1ff5784e:119012` | same | `be9511c9:286680` | `be9511c9:286680` | same |
| check plan | `e26d7b75:52413` | `e26d7b75:52413` | same | `9c5e05b4:74587` | `9c5e05b4:74587` | same |
| fix all | `07c2d1c5:127632 857d13dc:7897` | `07c2d1c5:127632 857d13dc:7897` | same | `fe274b1d:286821 7f9238e7:74065` | `fe274b1d:286821 7f9238e7:74065` | same |
| excel export | `1edf8ba3:23411` | `1edf8ba3:23411` | same | `0981c7af:52540` | `0981c7af:52540` | same |
| print preview | `ae1fd200:1088378` | `ae1fd200:1088378` | same | `6248edb4:1731063` | `6248edb4:1731063` | same |
| undo | `1ff5784e:119012 e26d7b75:52413` | `1ff5784e:119012 e26d7b75:52413` | same | `be9511c9:286680 9c5e05b4:74587` | `be9511c9:286680 9c5e05b4:74587` | same |
| findingsEnd | `e26d7b75:52413` | `e26d7b75:52413` | same | `9c5e05b4:74587` | `9c5e05b4:74587` | same |
| countsEnd | `956a6d9d:20340` | `956a6d9d:20340` | same | `39be8ba6:42640` | `39be8ba6:42640` | same |
| slotsEnd | `da5d85e4:76790` | `da5d85e4:76790` | same | `13761f52:210127` | `13761f52:210127` | same |

Output comparison: PASS — all values identical.

## Timings (ms)

| Step | Vault main | Vault branch | PR after | ≤110% | Saratoga main | Saratoga branch | PR after | ≤110% |
| --- | ---: | ---: | ---: | --- | ---: | ---: | ---: | --- |
| open plan | 340 | 68 | 58 | **FAIL** | 2236 | 75 | 79 | PASS |
| open area page | 219 | 38 | 85 | PASS | 1988 | 56 | 68 | PASS |
| full route | 548 | 150 | 163 | PASS | 4725 | 217 | 318 | PASS |
| compact route | 310 | 55 | 43 | **FAIL** | 2038 | 63 | 103 | PASS |
| grid layout | 2599 | 342 | 534 | PASS | 9353 | 1171 | 2040 | PASS |
| table layout | 814 | 334 | 446 | PASS | 6278 | 1205 | 2017 | PASS |
| unassign 6 homes | 263 | 68 | 119 | PASS | 2104 | 133 | 240 | PASS |
| assign 6 homes | 547 | 122 | 197 | PASS | 4051 | 228 | 420 | PASS |
| rename location | 241 | 53 | 94 | PASS | 2007 | 129 | 159 | PASS |
| splice in editor | 459 | 252 | 133 | **FAIL** | 2874 | 856 | 325 | **FAIL** |
| feature editor open | 117 | 110 | — | not provided | 372 | 325 | — | not provided |
| feature editor edit | 360 | 152 | 243 | PASS | 2264 | 368 | 639 | PASS |
| feature editor bulk set | 389 | 144 | 274 | PASS | 2286 | 373 | 747 | PASS |
| check plan | 168 | 33 | 44 | PASS | 1723 | 52 | 144 | PASS |
| fix all | 707 | 136 | 227 | PASS | 7338 | 241 | 298 | PASS |
| excel export | 15 | 12 | 12 | PASS | 45 | 28 | 23 | **FAIL** |
| print preview | 4590 | 2623 | 4990 | PASS | 12055 | 5006 | 9974 | PASS |
| undo | 426 | 78 | 94 | PASS | 4550 | 122 | 160 | PASS |

PR timing gate: FAIL. vault: open plan (68 > 63.8 ms); vault: compact route (55 > 47.3 ms); vault: splice in editor (252 > 146.3 ms); saratoga: splice in editor (856 > 357.5 ms); saratoga: excel export (28 > 25.3 ms).

Saratoga <150 ms gate for open/area/edits/check: FAIL: assign 6 homes = 228 ms, splice in editor = 856 ms, feature editor edit = 368 ms, feature editor bulk set = 373 ms, fix all = 241 ms.

The PR itself reports several edit steps above 150 ms. Its prose gives 83–100 ms for edits on an area page, while perfcheck measures several edits on the compact full route. This report applies the requested 150 ms gate to the actual harness steps and does not substitute the area-page measurements.

## Validation and limits

`node --check` passed for all seven modified files. `git diff --check` passed. The tracked diff contains only the seven allowed JavaScript files; this requested report is a new untracked Markdown file. No UI/behavior change was made. No protected source file, terminal/port logic, or helper implementation was edited.

Console/page errors: [].

Initial benchmark attempt was interrupted after a long unreported interval; the complete results above come from the subsequent fully completed same-tab run with progress logging external to the harness. Automatic approval review rejected a broadly bound server command; both final servers bind explicitly to 127.0.0.1.

Performance limits are reported as measured. Any failed gate remains failed; no output was changed or harness step skipped to improve timings. Further tuning outside these equivalent lookup substitutions would exceed this task scope.

## Diagnostic repeat: untouched branch vs substitutions

Because the requested timing gate failed, archived untouched HEAD eb7f044 was served on loopback port 8602 and compared to the edited branch on 8600. This was a separate fresh Edge context, with the same viewport and one tab: before Vault/Saratoga, then edited Vault/Saratoga. All 46 out values also matched main and the primary run. No console/page errors: []. Primary acceptance results above have not been replaced by selected repeat timings.

| Step | Vault untouched | Vault edited repeat | Saratoga untouched | Saratoga edited repeat |
| --- | ---: | ---: | ---: | ---: |
| open plan | 79 | 62 | 80 | 74 |
| open area page | 57 | 31 | 49 | 59 |
| full route | 97 | 86 | 191 | 198 |
| compact route | 28 | 31 | 73 | 73 |
| grid layout | 325 | 321 | 1193 | 1208 |
| table layout | 357 | 336 | 1371 | 1584 |
| unassign 6 homes | 64 | 74 | 119 | 123 |
| assign 6 homes | 113 | 141 | 253 | 223 |
| rename location | 47 | 59 | 117 | 134 |
| splice in editor | 244 | 294 | 862 | 891 |
| feature editor open | 142 | 176 | 353 | 370 |
| feature editor edit | 183 | 179 | 451 | 371 |
| feature editor bulk set | 191 | 149 | 425 | 417 |
| check plan | 34 | 36 | 55 | 59 |
| fix all | 163 | 153 | 301 | 296 |
| excel export | 17 | 18 | 17 | 18 |
| print preview | 2834 | 2627 | 5316 | 4959 |
| undo | 61 | 70 | 120 | 146 |

The untouched branch already exceeds the PR splice limit: Saratoga 862 ms versus a limit of 357.5 ms, and Vault 244 ms versus 146.3 ms. The edited repeat measured 891 ms and 294 ms respectively. These observations do not meet the requested timing gate. They show that the PR splice timing could not be reproduced even before the substitutions in this browser setup; they do not establish a general performance guarantee. No broader tuning was attempted. Diagnostic files are local-only work/b9-before.json, work/b9-branch-repeat.json and work/b9-console-repeat.json.

The copied sample files in both primary served folders match the source SHA-256 hashes. Note: this checkout has no .gitignore rule for handoff/samples, despite the task note calling it ignored; its existing handoff directory was already untracked before work began. Sample and result paths were added narrowly to the local Git info/exclude file to keep them out of commits. No tracked ignore file was edited.
