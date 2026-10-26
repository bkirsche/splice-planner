# T1: Path form for several cables per path — report

Date: 2026-10-26

## Base and scope

- Built on `main`, HEAD `2630a8baab312d6b5b3c993d88e15717d1e6dc50`.
- The initial working tree was clean.
- Source changes are limited to `app.js`, `equipment.js`, and `paths.js`.
- This report is the separately requested output. No commit or push was performed.

## Changes

- Added `layRun(startId, toId, fields)` beside `cableSpans`. It walks upstream paths, creates the first span with the supplied fields, links later spans using `through: "pass"` and `prev`, and returns the first span. An unrelated start uses only the final path. A missing incoming path returns no span; route walking also stops on repeated paths.
- Replaced `setTail`'s duplicate span-building loop with `layRun`, retaining tail IDs, naming, length updates, relocation, and the no-incoming-path behavior.
- Added explicit cable selection to `openPath(toId, cableId)`, with the default feeding cable, a forced new-cable mode, selected cable buttons, and "+ Another cable". Removal uses the selected span's run from here onward.
- Added the new cable's "Starts at" field using `tailStartField`'s route options and labels. The picker rebuilds from the cable arriving at the chosen start, clears obsolete ranges when the start changes, and hides when no cable arrives there. New runs save kind, phase selection, tail length and picks on the first span.
- Added separate pass/storage options for each eligible arriving cable and saved the chosen span ID in `prev`. Continued spans show the run's start and an "Edit <name>" link, with no mode selector.
- Guest details list every cable's annotation, fiber use, and color code, including drops. Line menus list each cable, "Add a cable", and the existing insert-handhole action. Route cells show one label line per cable when several share a path, retaining the existing single-cable detail layout.
- Preserved the existing F2 size validation. `insertStopForm` already handles every cable on a path and required no changes.

## Browser acceptance checks

Served the repository using `python -m http.server 8600`. Picked Brian and New plan in a fresh browser context before running the checks. Executed the supplied fixture and form checks in a real headless Chromium browser through its console protocol (`Runtime.evaluate`, with `includeCommandLineAPI: true`), rather than a simulated DOM or Node-only model.

| Spec check | Result and evidence |
| --- | --- |
| Supplied `layRun` span map | PASS: `[["HH","A","",false],["A","B","pass",true]]`. |
| `cableSpans(first).length === 2` | PASS: returned `true`. |
| Two cables on HH→A show buttons; Another opens new | PASS: Cable 9 · 12F and Other · 24F both appeared; the default feeding cable was selected, selecting the other updated selection, and Another opened new mode with no Remove cable button. |
| New A→B cable starting at HH creates two spans and picks from F1 | PASS: heading was `Fibers spliced from F1 at HH`; unlocked picks were F1 fibers 1–12; save created HH→A plus A→B with correct `prev`. |
| Pass-through options list every eligible arriving cable | PASS: both pass and storage options appeared for Other and Terminal tail 1; Cable 9, already continued to B, was excluded from the new-cable choices. Saving each mode used the selected predecessor. |
| No console errors | PASS: zero page exceptions and zero console-error messages across the final suite. |
| Diff scope | PASS: `git diff --stat` lists only app.js, equipment.js, paths.js. The requested report is a new untracked file. |

## Complete browser check results

1. PASS — Spec layRun span map.
2. PASS — Spec cableSpans length.
3. PASS — Spec two-cable selector.
4. PASS — Default selects pathCable.
5. PASS — Select explicit cable.
6. PASS — Spec Another cable opens new.
7. PASS — Starts at route labels.
8. PASS — Spec picker uses F1 at HH.
9. PASS — Spec upstream save adds two spans.
10. PASS — Kind phase picks on first span.
11. PASS — Picked fibers reference F1.
12. PASS — Continuation has edit-start link and no mode.
13. PASS — Edit-start link target.
14. PASS — Remove only suffix of selected run.
15. PASS — Spec all eligible arriving pass/storage options.
16. PASS — Storage saves selected prev.
17. PASS — Pass saves selected prev.
18. PASS — No starts field when editing existing start.
19. PASS — Spec route cell lists every cable.
20. PASS — Route has one label line per cable.
21. PASS — Line menu all cables add and insert.
22. PASS — Guest lists all cable annotations/use/colors.
23. PASS — Unrelated start falls back to last path.
24. PASS — Single start option hidden.
25. PASS — Local start adds one span.
26. PASS — setTail upstream run.
27. PASS — setTail length update preserves run.
28. PASS — setTail relocation removes old run.
29. PASS — Editing first span updates own run only.
30. PASS — Start with no incoming cable hides picker.
31. PASS — Changing start while unlocked refreshes ranges.
32. PASS — New cable keeps F2 size validation.
33. PASS — Guest drop includes annotation use and colors.

## Other verification

- `node --check app.js`: PASS.
- `node --check equipment.js`: PASS.
- `node --check paths.js`: PASS.
- `git diff --check`: PASS.
- Visually reviewed the rendered multi-cable form and selected-button appearance in a browser screenshot.

## Uncertainties and testing notes

- No unresolved implementation uncertainty found in the requested scope.
- "No mode select" was applied to every continued (`through`) span; editing the cable itself follows the link to its first span.
- The existing `tagPhases()` still tags all untagged plan objects when saving, including continuation spans. The form's chosen phase is assigned to the first span; kind and fiber picks remain only on that span. The existing phase model was not changed.
- Native Firefox computer automation was unavailable because its tool stopped browser interaction over unsupported URL-policy enforcement. The acceptance suite completed through Chromium's browser console protocol instead.
- An initial extra phase test used only one phase, which intentionally disables the app's phase picker. Corrected that test fixture to two phases; the final full suite passed.
- Browser scripts, JSON results, and screenshot were kept outside this repository so the requested source-file scope is preserved.
