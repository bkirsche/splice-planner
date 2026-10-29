# A1: Code audit (find bugs, change nothing)

A lot has landed lately (T1-T4, area pages, area print, layout menu, phase names). This task is a read-only bug hunt. Codex reads and runs the app and writes findings; Claude reviews them with Brian and turns the confirmed ones into fix batches. **Do not edit any source file.**

## What to look for

Real defects only, not style:
- Crashes and console errors (null/undefined access, missing elements, bad event targets).
- Data bugs: plan state that gets corrupted, lost or left stale after an edit, undo, delete, rename, import, area/phase change or reload. Saved files that don't load back the same.
- Stale references after something is removed or renamed (cables, paths, splice cases, ports, homes, areas, phases).
- Undo that doesn't fully undo, or leaves listeners/state behind.
- Event listeners added on every render without removal (leaks, double-firing actions).
- Selection, menu and dialog bugs: Esc/x not closing, focus lost, right-click showing the browser menu outside text boxes.
- Print/export output that is wrong or missing data; 11x17 overview spilling past one page is already known, skip it.
- Service worker (`sw.js`) caching a file list that no longer matches the repo.
- Dead code and duplicate logic only when it causes or hides a bug.

## Split into three parts (one report each)

1. **A1a: core and data**: `app.js`, `ui.js`, `files.js`, `edits.js`, `fold.js`, `pan.js`, `users.js`, `sw.js`, `import.js`, `xlsx.js`, `catalog.js`, `index.html`.
2. **A1b: routes and splicing**: `paths.js`, `grid.js`, `connect.js`, `splices.js`, `trace.js`, `equipment.js`, `features.js`, `features-equipment.js`.
3. **A1c: views and output**: `counts.js`, `check.js`, `table.js`, `areas.js`, `phases.js`, `field.js`, `print.js`, `styles.css`.

Read across files where a call leads you; each part reports only findings whose root cause is in its own files.

## How to check

- Serve with `python -m http.server 8600` (ports 8600-8649 only). Use plans from the app's own samples/import or build a small one: two areas, a few paths with several cables, a splice case with connections, a splitter, a terminal, homes with counts, two phases.
- Reproduce every finding you can in the browser and give the steps. Mark ones you only found by reading as "from code, not reproduced".

## Report format

Write `A1a-REPORT.md`, `A1b-REPORT.md`, `A1c-REPORT.md` next to this file. One entry per finding:

```
### <ID e.g. A1b-03>: <one-line title>
Severity: High (data loss/crash) | Medium (wrong result, workaround exists) | Low (cosmetic/edge)
Where: file.js:line (function)
Steps: 1. ... 2. ...  (or "from code, not reproduced")
Expected / Actual:
Suggested fix: 1-3 sentences, no patch
```

Sort by severity. End each report with a short list of areas you did not get to.

## Do not touch

- Any `.js`, `.html`, `.css`, `.json` file: no edits, no formatting, no "quick fixes".
- `handoff/` (local notes), `D:\Projects\assembly-workshop\work\gene-success\gene.png`.
- Do not commit or push. Only the three report files are new.
