# B9: Remaining plan scans onto the indexed lookups

Daily note 8 (2026-10-30): the app is very slow on big plans (Saratoga: 534 locations, 451 homes, 552 cables). Claude profiled it and added a plan index on branch `claude/b9-big-plan-speed-eb543a`:

- `planindex.js`: `buildPlanIndex()`, `planIndex()`, `withPlanIndex(fn)` and the list `INDEXED_READERS` (renderRoute, autoCounts, checkPlan, buildSpliceModel, the badge, the Feature editor, print, Excel, the Fed from list). While one of those runs, lookups use maps built once. Outside them, every lookup searches the plan exactly as before.
- Indexed helpers you may call: `point(id)`, `incomingPath(id)`, `childPaths(id)`, `childCables(id)`, `cableById(id)` (new), `prevSpan`, `nextSpan`, `incomingCable`, `equipmentLocation(eqId)`, `usedPorts`, `isCascade`, `homeSplitter`, `nextFreePort`, `routeOrder`, `colorCode`.

This task is mechanical: the code still has a few dozen places that search `plan.points`, `plan.cables` or `plan.paths` by hand for something one of those helpers already returns. Switch them to the helper, so they're fast inside the indexed readers too. Behaviour must not change at all.

## What to change

Replace only patterns that are **exactly** equivalent, including which item wins when two match (the helpers return the first match in plan order, like `find`):

| Hand search | Becomes |
| --- | --- |
| `plan.points.find((p) => p.id === X)` (any parameter name) | `point(X)` |
| `plan.cables.find((c) => c.id === X)` | `cableById(X)` |
| `plan.paths.find((x) => x.to === X)` | `incomingPath(X)` |
| `plan.paths.filter((x) => x.from === X)` | `childPaths(X)` |
| `plan.cables.filter((c) => c.from === X)` | `childCables(X)` |
| `plan.points.find((p) => (p.equipment \|\| []).some((e) => e.id === X))` | `equipmentLocation(X)` |

Known places (check every file, there may be more): `connect.js` lines ~107, 282, 415, 486; `equipment.js` ~33; `import.js` ~656; `paths.js` ~522; `print.js` ~452; `splices.js` ~159; plus `plan.points.find` / `plan.cables.find` / `plan.paths.find|filter` uses in `app.js`, `areas.js`, `check.js`, `counts.js`, `features.js`, `features-equipment.js`, `fold.js`, `grid.js`, `table.js`, `trace.js`. Run `grep -n "plan\.\(points\|cables\|paths\)\.\(find\|filter\|some\)" *.js` for the full list.

Leave a search alone when:
- it tests something other than the id/from/to above (a type, a name, two fields, `some`/`every` over all items, a count);
- the result is mutated afterwards (`childPaths`/`childCables` return a copy, so pushing to it would no longer change anything: check);
- it runs while the plan is being changed in the same function (between a `push`/`splice` on the list and the lookup). The helpers are still correct there (outside the readers they search as before, and the index rebuilds itself when a list grows or shrinks), but say in the report where you found such a case;
- it's inside the fallback branches of the helpers themselves (`app.js` ~l.285-375, `counts.js` lookups, `planindex.js`).

## Acceptance checks

1. Serve this branch: `python -m http.server 8600` from the repo root (ports 8600-8649 only). Serve `main` next to it on 8601: `git worktree add ../sp-main main` (or `git archive main | tar -x -C <folder>`), copy `tools/perfcheck.js` and the two plans into it, and `python -m http.server 8601 -d <folder>`.
2. The two plans are local only (never commit them): `D:\Projects\splice-planner\handoff\samples\Saratoga_Brian_2026-10-30.ffhspl` and `Vault_Brian_2026-10-28.ffhspl`. Copy them to `handoff/samples/` in each served folder (it's git-ignored).
3. In each copy, in the browser console (same browser, same window size, one copy after the other in the same tab):
   ```js
   (0, eval)(await fetch("tools/perfcheck.js?" + Date.now()).then((r) => r.text()));
   const S = await fetch("handoff/samples/Saratoga_Brian_2026-10-30.ffhspl").then((r) => r.text());
   const V = await fetch("handoff/samples/Vault_Brian_2026-10-28.ffhspl").then((r) => r.text());
   const R = { vault: await perfCheck(V), saratoga: await perfCheck(S) };
   copy(JSON.stringify(R));
   ```
   Save both results (`work/b9-main.json`, `work/b9-branch.json`, not committed).
4. **Zero differences:** every value under `out` is identical between main and the branch, for both plans (saved plan, Check plan findings, counts, tray slots, every view, print, Excel, after each edit and after Undo).
5. **No slower:** no step under `ms` is more than 10% slower on the branch than the numbers in the PR's "after" table (open plan, area page, edits and Check plan must stay under 150 ms on Saratoga).
6. No console errors while it runs. `git diff --stat` touches only the `.js` files listed above.

## Do not touch

- `planindex.js`, the helper functions themselves, `tools/perfcheck.js`, `index.html`, `sw.js` (Claude owns the index design; if a helper is missing for a common pattern, describe it in the report instead of adding one).
- Port and terminal code beyond swapping a lookup: a separate note will rework terminals.
- `handoff/` (local notes and plans), `D:\Projects\assembly-workshop\work\gene-success\gene.png`.
- No new libraries, no behaviour or UI changes, no confirm pop-ups.
- Do not commit or push. Write `B9-index-lookups-REPORT.md` next to this file: every place changed (file:line, old → new), every place you left and why, the comparison result (paste both `out` objects' keys with "same"/"different"), and the timing table main vs branch.
