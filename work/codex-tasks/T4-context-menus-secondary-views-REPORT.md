# T4: Secondary-view context menus

Completed 2026-10-27. No commit or push.

## Changes by file

- `features.js`: feature rows now open `openPopup` with Show on the route, Select every row shown, Clear the selection, and Set a value on N selected. The last action focuses the existing bulk field selector. Right-click preserves an existing selection or selects only the clicked row using the existing selection path. Inputs, number fields, selects, and editable text retain native context-menu handling through `typingIn`.
- `counts.js`: home rows now offer port picking, automatic counts, clearing DS, selecting all homes, and clearing the selection. Extracted `backToAutomatic`, `clearDs`, and `pickHome` so menu actions share the toolbar and click behavior. Port menus reuse `dropOn` for placement; removal from a splitter reuses `clearDs([home])`, while terminal removal clears that home's terminal assignment with Undo. Home dragging now starts only on the left button, preventing right-click from accidentally changing the pending home.
- `paths.js`: added menus for available incoming fibers, assigned outgoing fibers, and incoming tube headings. Incoming fiber menus preserve multi-selection or replace it with the clicked fiber; tube selection excludes fibers already in use. Extracted `clearSelection` and `takeOff` for shared toolbar/click/menu behavior; placement continues to use `place(null)`. Fiber dragging now starts only on the left button.
- `table.js`: location-name and home buttons now invoke their existing `openMenu(id, e)` from right-click as well as click.
- `app.js`: the outer tree fan drop label now opens `openLineMenu`, covering label padding as well as the cable rows. Existing card and cable-row menu behavior remains in place. The wrapper ignores an already-handled event.

No changes to `connect.js`, `grid.js`, `ui.js`, `openPopup`, styles, dependencies, `handoff/`, or any `gene.png`.

## Browser acceptance checks

Served the project using `python -m http.server 8600`. Tests used installed Google Chrome through Playwright in a fresh isolated browser context at `http://localhost:8600`, with service workers blocked to ensure the current source was loaded. No libraries were installed or added to the project.

Loaded a disposable plan using the app's `loadPlanText`: a head end, four handholes, a splice case, a splitter, a terminal with four ports, four homes, a 48-fiber feeder, a 12-fiber branch, and four drops. The splitter occupied feeder fiber 48 so the tube tests also exercised unavailable fibers.

| Acceptance item | Check and result |
| --- | --- |
| Load a plan containing a splice case and homes | Passed with the fixture above. The route rendered correctly in Chrome. |
| Feature row menu and actions | Checked all four menu entries. Select all selected four rows; Clear emptied selection; Show selected the clicked location on the route. Set a value focused the bulk field selector, and applying an address updated exactly the three selected rows, leaving the fourth unchanged. |
| Home counts row menu and actions | Checked all five entries. Clear DS removed counts and set manual mode on exactly three selected homes; Back to automatic restored their counts. Select all and Clear selection updated all four rows as expected. Put on a port displayed the expected home-specific prompt. Toolbar actions also continued to work. |
| Home port tile menus and actions | Put Home 1 here assigned splitter port 8; Take Home 1 off this port cleared its DS while keeping it manual. Repeated placement/removal against terminal port 1 and verified `tport` was created/cleared. |
| Cable form fiber grid | Ctrl-selected fibers 1, 2, 3 and placed all three on the next free output fibers. Removed output #2 through its menu while an incoming fiber was selected, verifying removal rather than accidental placement. Saved the cable form and verified its picks persisted. Toolbar placement and clearing also worked. |
| Fiber tube menus | Select this tube selected its available fibers; Clear this tube cleared them. The fourth tube selected 11 fibers, excluding occupied fiber 48. The incoming fiber action Select this tube's free fibers selected all 12 available fibers in tube 1; Clear the selection emptied them. |
| Table layout | Compared full popup contents from click and right-click for both a location and a home; they matched. Invoked Rename from the location's right-click menu and verified the dialog opened. |
| Tree fan rows | Right-clicked a home card and got its location menu; right-clicked the drop's cable row and got the line menu. Dispatched a contextmenu directly on the outer drop label to test wrapper padding independently of text geometry; it opened the same line menu. Edit cable opened the cable form. |
| Three selected rows and right-click selection rules | Used actual Ctrl-clicks in the feature editor, home counts, and fiber grid. Right-clicking a selected item displayed `3 selected` and bulk actions affected all three. Right-clicking an unselected item replaced the selection with only that item. |
| Text and number boxes retain browser handling | Dispatched cancellable contextmenu events on feature text inputs and selects, the home counts number input and device select, and a cable form number input. Every event remained unprevented, so the browser retains its native menu path. These were headless browser checks; native operating-system menu pixels were not visually inspected. |
| Esc and arrow keys | ArrowDown moved focus to the next item in feature, home counts, and fiber menus. Also checked ArrowUp wrapping and Home/End in the feature menu. Esc hid the menu while preserving the feature editor and its selection, and left the home counts/cable dialogs open. |
| No console errors | Collected Chrome console errors, uncaught page errors, and JavaScript dialog events across the full run: zero of each. |
| Scope and static checks | `node --check` passed for all five changed scripts; `git diff --check` passed. `git diff --stat` contains only `app.js`, `counts.js`, `features.js`, `paths.js`, and `table.js`. This required report is a separate untracked Markdown file. |

The final browser run passed 12 groups of assertions. Test harness and results were kept outside the repository:

- `C:\Users\brian\Documents\ChatGPT\Offloading\test_t4.cjs`
- `C:\Users\brian\Documents\ChatGPT\Offloading\T4-browser-results.txt`
- `C:\Users\brian\Documents\ChatGPT\Offloading\T4-browser.png`

## Interpretation and limitations

The spec describes port removal as reusing what a tile click does, but the existing occupied-tile click starts moving that home rather than removing its assignment. Implemented the explicitly requested Take off action: splitter removal shares the existing DS-clear action; terminal removal clears its terminal assignment with Undo. Ordinary tile click still starts a move.

Put on a port operates on the clicked home, matching the singular existing pending-home interaction and the spec's description. The automatic/clear DS actions operate on the full selected set.

Native textbox menus were verified through unprevented browser events, as described above. No changes to the shared popup or selection helpers were needed.
