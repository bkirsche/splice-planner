# A1a: Core and data audit

Audited 2026-10-29. App served with `python -m http.server 8600` at http://localhost:8600/. Browser checks used a disposable plan and the Brian name. Source files were not edited. Findings are ordered by severity.

### A1a-01: Undo history survives Start over and replaces the next plan
Severity: High (data loss/crash)
Where: ui.js:329 (undoStep); app.js:114 (new-plan click handler), app.js:252 (Start over handler)
Steps: 1. Start a plan with a Handhole and add Vault 1 after it. 2. Remove Vault 1 using its menu and confirm Remove. 3. Press Start over twice, then New plan. 4. With focus outside a text box, press Ctrl+Z. Reproduced in the browser.
Expected / Actual: A new plan should have its own undo history. Instead, the old Handhole and Vault 1 replace the new empty plan, and the message says "Undone: Removed Vault 1." The global undoStack is never reset at plan boundaries; undoStep assigns an entire historical plan and saves it. The same mechanism can overwrite work added to the new plan before Ctrl+Z, and older history remains reachable after opening another file and undoing its open step.
Suggested fix: Scope undo entries to a plan/session and clear the undo bar and stack when starting or clearing a plan. If opening another plan remains undoable, preserve that deliberate transition without allowing unrelated older entries into a new session.

### A1a-02: Removing a location leaves cables running from the deleted subtree
Severity: High (data loss/crash)
Where: app.js:1337 (removeStop)
Steps: from code, not reproduced. Construct a route A -> B -> C and lay a tail from C back to A; remove B and its downstream C using Remove.
Expected / Actual: Removing B and C must remove or consistently sever every cable that touches them. The cable filter only checks c.to, so the reverse span B -> A survives with a missing from endpoint while C -> B is removed. Cross-connects at surviving A that reference the removed tail/equipment also survive because cleanup only tests x.at. The dangling cable is saved into the plan and remains visible to model/connection consumers; this is persistent structural corruption, even where a renderer tolerates the missing endpoint.
Suggested fix: Remove spans whose from or to endpoint is deleted, then clean links, picks, continuation IDs and equipment-tail references against the remaining objects. Keep this cleanup inside the same undo snapshot.

### A1a-03: CSV delimiter detection counts separators inside quoted addresses
Severity: Medium (wrong result, workaround exists)
Where: import.js:131 (guessDelimiter)
Steps: 1. Open Import homes in a nonempty plan. 2. Paste the following comma-separated text and click Use pasted list:

```csv
Address,Lot
"123 Main St; Unit A; Building B",1
"125 Main St; Unit A; Building B",2
```

3. Inspect step 2. Reproduced in the browser.
Expected / Actual: Two columns, Address and Lot, with lot numbers 1 and 2. Instead there is one column named "Address,Lot" whose example ends in ",1"; that entire column is automatically selected as the lot column and no address column is selected. guessDelimiter chooses semicolon because it counts four semicolons inside quotes against three real commas. Continuing can import the whole address-plus-comma-plus-number as a lot. A workaround is to remove the quoted punctuation or use a different separator consistently.
Suggested fix: Score candidate delimiters only outside quoted fields, handling doubled quotes, and prefer consistent row widths rather than raw character frequency.

### A1a-04: Field crew mode hides the Save action needed to return field notes
Severity: Medium (wrong result, workaround exists)
Where: index.html:111 (share-plan button)
Steps: 1. In a test plan, open a location's sheet and save a field note. 2. Switch Who is working to Field crew (view, notes, as-builts). 3. Inspect the header: Open plan and Print / PDF remain, but Save is absent. Reproduced in the browser; #share-plan has class "btn ghost edit-only" and computed display "none" in crew mode.
Expected / Actual: Field crews should be able to save their annotated plan file for return to the planner, as documented by files.js's Save handler and field.js's "Saved. Use Save at the top to send the plan file back to the office." message. The Save button is tagged edit-only, so styles.css:1342 hides it from exactly those users. Files.js permits the save, but there is no visible action to reach it. Choosing a planner name is a workaround, but defeats the intended field workflow.
Suggested fix: Keep the plan-file Save action available to field crews while retaining restrictions on plan editing. Give export/save actions a separate visibility classification from editing actions.

Areas not reached / limits:
- Real filesystem picker/autosave permission, overlapping asynchronous writes, device share sheets and launchQueue were inspected in code but not exercised against real files.
- No exhaustive legacy/malformed-plan or large-import matrix, mobile gesture testing, or exported XLSX application round-trip.
- sw.js cached asset names were checked against files on disk; no missing listed local asset was found. Offline upgrade behavior was not exercised.



