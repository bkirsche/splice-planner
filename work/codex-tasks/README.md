# Codex tasks

Claude writes the spec, Codex does the work and writes `<task>-REPORT.md`, Claude reviews and commits.

| Task | What | Status | Commit |
|------|------|--------|--------|
| T1 | Path form: several cables per path | Done, reviewed | c4b5055 |
| T2 | One line per cable on a path | Done, reviewed | b77456d |
| T3 | Feature editor: splice cases, splitters, terminals, gear, homes | Done, reviewed (3 fixes + bulk count fix) | 58411a0, then this table's commit |
| T4 | Right-click menus: Feature editor, home counts, fiber grid, Table layout, fan rows | Done, reviewed (1 fix: empty port menu closes) | this table's commit |
| A1 | Code audit, read-only: A1a core/data, A1b routes/splicing, A1c views/output | Done, reviewed: 11 findings (5 High, 6 Medium), spot-checked in code; fixes go in batches B1/B2 (both done) | 1490b68 |
| B1 | Data integrity fixes: A1a-01, A1a-02, A1b-01..03 (shared purgeRemoved, resizeStuck by Claude; wiring and browser checks by Codex) | Done, reviewed: wiring matched spec; Codex wrote no report, so Claude ran all checks in the browser and wrote it | 159af8c, then this table's commit |
| B2 | Views and output fixes: A1c-01..04, A1a-03, A1a-04 (shared spliceSlots slot map, phaseVisible phase rule, shownUsedPorts by Claude; wiring and browser checks by Codex) | Done, reviewed: diff matched spec; Codex browser run passed every acceptance check (34 assertions, no console errors); Claude re-checked CSV delimiter and crew Save | b70d8d7, then this table's commit |
