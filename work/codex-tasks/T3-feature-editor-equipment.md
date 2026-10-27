# T3: Feature editor, equipment and home types

The Feature editor panel is built (commit b59e816, `features.js`): read the header comment there first. It has
location types and "Cables and tails". Add the rest as new feature types, in a NEW file `features-equipment.js`,
using only `addFeatureType` and the column shape described in `features.js`.

## Files
- Create `features-equipment.js`.
- `index.html`: add `<script src="features-equipment.js"></script>` right after `features.js`.
- `sw.js`: add `"features-equipment.js"` to `FILES` right after `"features.js"`, bump `CACHE` by one.
- Nothing else. Do NOT touch `features.js`, `styles.css`, counts/splices/print/paths/equipment.js, or anything in `handoff/`.

## Helpers to use (already exist; global functions)
- `equipmentLocation(eqId)` -> the location holding an item. Rows are equipment objects; `locOf(eq)` returns
  `equipmentLocation(eq.id).id`. Give every row type a `Location` read-only column (`equipmentLocation(eq.id).name`) right after Name.
- `eqLabel(eq)` for any equipment name shown in a read-only cell.
- `templateById(id)`, `TEMPLATES`, `SPLITTER_RATIOS`, `fillRatios`-style ratio lists: a template may have `t.ratios`; otherwise use `SPLITTER_RATIOS`.
- `tailKind(loc, eq)`, `tailFeet(eq)`, `tailText(eq, loc)`, `setTail(loc, eq, feet, startId)`, `tailCable(eq)`, `removeCableFrom(c)`.
- `f2Problem(loc, eq, n)` -> problem text or "" for a splitter F2 number; `f2Label(eq)`; `splitterPorts(eq)`; `usedPorts(eq)`.
- `cardPorts(eq)`, `hasCards(eq)`.
- `homeF2(h)`, `homeDs(h)`, `f2Label(...)`, `homeSplitter(h)`, `lotName(lot)`, `FIELD_STATUS`.
- Phase column: copy the `phaseCol()` pattern from features.js (it's a const there, callable as `phaseCol()`).

## Types to add (key, label, rows)
1. `cases`, "Splice cases": every equipment with `type === "closure"`.
   Columns: Name (text, required), Location (ro), Model (text: `eq.model`), Trays (number >= 1: `eq.trays`),
   Tray size (select 12, 24, 36, 48, 72, 96, 144: `eq.slots`), Splices (ro: trays x slots, plus " (over the N max)" when `eq.max` is passed).
2. `splitters`, "Splitters": every `type === "splitter"`.
   Columns: Name (text, required), Location (ro), Size (select of ratios valid for its style: `eq.ratio`; `check` rejects
   a ratio with fewer ports than `usedPorts(eq).size` -> "<name> has <n> homes on it; a <ratio> only has <m> ports."),
   Style (ro), F2 (number: `eq.f2`; empty clears it; `check` uses `f2Problem(loc, eq, n)`; setting it also sets `eq.f2Manual = true`,
   clearing it sets `eq.f2Manual = false`), DS used (ro: "used of ports"), Tail ft (number, only editable when `tailKind(loc, eq)`;
   empty = no tail: remove `tailCable(eq)` and delete `eq.tail`, `eq.tailFt`, `eq.tailIn`; a number calls
   `setTail(loc, eq, n, eq.tailIn ? loc.id : tailCable(eq) ? tailCable(eq).from : undefined)`, 1 to 5000),
   Tail (ro: `tailText(eq, loc)` or "—"), Phase.
3. `terminals`, "Terminals": every `type === "terminal"`. Columns: Name, Location, Model (text), Ports (ro `cardPorts(eq)`),
   Tail ft (same rules as splitters), Tail (ro), Phase.
4. `gear`, "Shelves, panels and other": every `type` in shelf, panel, other. Columns: Name, Location, Kind (ro: `EQ_KINDS[type].label`),
   Model (text; "—" read-only for `other`, use `editable`), Ports (ro, cards only), Phase.
5. `homes`, "Homes": every point with `type === "nid"`. `locOf` = its id. Columns: Name (text, required; homes are
   renamed by setting `h.name` only), Lot (text: `h.lot`; empty deletes it), Fed from (ro: the location of `incomingPath(h.id).from`),
   Splitter (ro: `eqLabel(homeSplitter(h))` or "—"), F2 (ro: `homeF2(h) ? f2Label(homeF2(h)) : "—"`),
   Field status (select `FIELD_STATUS`, stored in `h.field.status` exactly like the location type in features.js), Phase.

Rows of equipment types should be in route order: walk `plan.points` in order, then each point's `equipment` in order.
Names: `check` returns "Give it a name." for an empty name.

## Code style
Same as features.js: plain functions and object literals, `el`/`selectEl` helpers, short plain-English comments, no
classes, no build step, 2-space indent, double quotes.

## Acceptance checks
Serve: `python -m http.server 8601` in the repo, open http://localhost:8601, pick a user, "New plan". In the console:
```js
const hh = plan.points[0]; // after placing a handhole from the Start card, or build one with the UI
```
Build by hand in the UI: a handhole with a splice case, a clamshell splitter (100 ft tail, starts Inside), a terminal,
a pedestal fed from it with a terminal, and two homes under the pedestal. Then:
1. "Edit features" -> the kind dropdown lists Splice cases, Splitters, Terminals, Shelves panels and other, Homes,
   each with the right count.
2. Splice cases: change Trays to 3 in a cell -> the card chip reads "... 3 x slots"; Undo in the bottom note restores it.
3. Splitters: set F2 to a number already used by another splitter on the same cable -> a note with the f2Problem text, nothing changes.
   Set Tail ft to 150 -> the card chip says "150ft tail inside". Clear it -> the tail is gone.
4. Tick two terminals, bulk "Set Tail ft to 75" -> both show 75 ft; one Undo restores both.
5. Homes: change a Lot; sort by Lot; filter by a lot number.
6. Each type's "Show" button selects the right card.
7. No console errors (`read_console_messages`-equivalent: open devtools).
8. `git diff --stat` shows only features-equipment.js (new), index.html, sw.js.

Write `T3-feature-editor-equipment-REPORT.md` next to this spec: what you did, any deviation and why, and the result of
each check above. Commit nothing; Claude reviews and commits.
