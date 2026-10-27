# T4: Right-click menus in the remaining views

Daily note 14 (2026-10-27): right-click opens the app's own menu everywhere, with actions for what was clicked, acting on the whole selection when several items are selected. Claude built the menu itself and wired the canvas (cards, lines, + buttons, empty canvas) and the splice case editor in be233bd. This task wires the remaining views. It is mechanical: follow the patterns already in the code.

## How the menu works (read these first)

- `app.js` `openPopup(title, items, e, caption)`: the one app menu. Items are `{ icon, label, run, danger, sep }`. `sep: true` draws a divider above the item. It focuses the first item, handles arrows/Home/End/Esc, keeps itself on screen, and places itself under the focused element when opened from the keyboard (`e.clientX/Y` are 0).
- `app.js`, the document `contextmenu` listener: if nothing handled the event (`e.defaultPrevented` false), it suppresses the browser menu and offers Copy for selected text. Text boxes (`typingIn(e.target)`, ui.js) keep the browser's menu. Your handlers must call `e.preventDefault()` (and `e.stopPropagation()` when a parent also has a handler).
- Icons: `<symbol id="i-...">` in `index.html`. Use existing ones: edit, remove, select, fold, unfold, plus, copy, move, pin, info, sheet, counts, homes, xconnect, splitter, terminal, closure.
- Selection, classic way: `ui.js` `selectClick(set, order, key, e, at)`. Right-click on an item that is not selected selects just that item first (as `connect.js` does for fibers); right-click on one of several selected items shows a menu for all of them.
- Examples to copy: `grid.js` `openPickedMenu` and the routeView `contextmenu` listener; `connect.js` `wrap.addEventListener("contextmenu", ...)`; `paths.js` `openLineMenu`.

## Views to wire

1. **Feature editor rows** (`features.js` `renderFeatures`). Right-click a row (not inside a text box or select): if the row is not selected, select only it (`fe.picked`), then show a menu titled with the row's first column text. Items: Show on the route (`revealPoint(t.locOf(r))`), Select every row shown, Clear the selection (when any), and, when 1+ rows are selected and the type has editable columns, "Set a value on N selected…" which focuses the bulk bar's field select (`.fe-bulk select`). With several selected and the click on one of them, title "N selected".
2. **Home counts rows** (`counts.js` `openHomeCounts`). Right-click a home row: select it if not selected (`ticked`), then items: "Put on a port…" (same as tapping the home: sets `picked` and the "Tap a port for …" message), Counts back to automatic for the selected homes (reuse the existing tool button's code: move it into a named function and call it from both), Clear DS count for the selected homes (same), Select all homes, Clear the selection. Right-click a port tile: if a home is picked, "Put <home> here"; if the port has a home, "Take <home> off this port" (reuse what the tile click does).
3. **Fiber grid in the cable form** (`paths.js` `fiberGrid`). Right-click a left fiber: select it if not selected, then: "Put on the next free fibers" (`place(null)`), Select this tube's free fibers, Clear the selection. Right-click a right fiber that holds a pair: "Take #n off" (what a click does there). Right-click a left tube header: Select / clear that tube.
4. **Table layout** (`table.js`): right-click a location name button or a home button opens the same menu as a click (`openMenu(id, e)`), like `stopEl` in app.js.
5. **Tree layout fan rows** (`app.js` `fanEl`): make sure right-click on a fan row's card or drop label opens the card menu / line menu (cards already do via `stopEl`; check the drop label area, `cableRows` already handles its rows).

## Acceptance checks

- Serve with `python -m http.server 8600` (or the preview config in `.claude/launch.json`; ports 8600-8649 only). Load a plan with a splice case and homes.
- In each view above, right-click shows the app menu (never the browser menu), with the items listed; each item works.
- Right-click inside any text box or number box still shows the browser's own menu.
- With 3 rows selected (Ctrl-click), right-click on one of them: the menu says 3 and acts on all 3. Right-click on an unselected row selects only that row.
- Esc closes only the menu (the dialog under it stays open). Arrow keys move through the items.
- No console errors. `git diff --stat` touches only features.js, counts.js, paths.js, table.js, app.js, styles.css (if needed).

## Do not touch

- `connect.js`, `grid.js`, `ui.js` `selectClick` / `confirmBox`, and `openPopup` itself (if you need a change there, describe it in the report instead).
- `handoff/` (local notes), `D:\Projects\assembly-workshop\work\gene-success\gene.png`.
- No confirm pop-ups (only splice connections ask first). No new libraries.
- Do not commit or push. Write `T4-context-menus-secondary-views-REPORT.md` next to this file: what changed per file, how you checked each acceptance item, anything you weren't sure about.
