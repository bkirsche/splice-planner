// Import homes: read an address list (usually CSV) for the whole job,
// walk the user through cleaning it up, and put the homes on the
// unassigned list. From there they're assigned to the location that
// feeds them, each getting a Customer NID and (optionally) a drop.

const importPanel = document.getElementById("import-panel");
const importSteps = {
  file: document.getElementById("import-step-file"),
  columns: document.getElementById("import-step-columns"),
  fix: document.getElementById("import-step-fix"),
};

// State for the import in progress.
let imp = null;

function importHomes() {
  closePanels();
  closeMenu();
  imp = { rows: [], hasHeader: false, columns: [], include: {} };
  document.getElementById("import-file").value = "";
  document.getElementById("import-paste").value = "";
  document.getElementById("import-file-error").hidden = true;
  importPanel.hidden = false;
  showImportStep("file");
}

function closeImport() {
  importPanel.hidden = true;
  imp = null;
}

registerPanel(importPanel, closeImport);
document.getElementById("import-homes").addEventListener("click", (e) => {
  e.stopPropagation();
  if (emptyBlocked()) return;
  importHomes();
});

function showImportStep(name) {
  const order = ["file", "columns", "fix"];
  for (const [key, el] of Object.entries(importSteps)) el.hidden = key !== name;
  document.getElementById("import-step-count").textContent = `Step ${order.indexOf(name) + 1} of 3`;
}

document.getElementById("import-cancel").addEventListener("click", () => {
  closeImport();
  selectedId = null;
  renderRoute();
});
document.getElementById("import-back-1").addEventListener("click", () => showImportStep("file"));
document.getElementById("import-back-2").addEventListener("click", () => showImportStep("columns"));

// --- Step 1: get the text ---

document.getElementById("import-file").addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => loadText(String(reader.result));
  reader.onerror = () => fileError("That file could not be read. Try saving it again as CSV.");
  reader.readAsText(file);
});

document.getElementById("import-paste-go").addEventListener("click", () => {
  loadText(document.getElementById("import-paste").value);
});

function fileError(msg) {
  const el = document.getElementById("import-file-error");
  el.textContent = msg;
  el.hidden = false;
}

function loadText(text) {
  const rows = parseCSV(text).filter((r) => r.some((cell) => cell.trim() !== ""));
  if (!rows.length) return fileError("No addresses found. Check that the file has one home per row.");
  imp.rows = rows;
  imp.hasHeader = looksLikeHeader(rows);
  imp.columns = guessColumns(rows, imp.hasHeader);
  imp.lotCol = columnNames(rows, imp.hasHeader).findIndex((n) => /\blot\b/i.test(n));
  imp.columns = imp.columns.filter((c) => c !== imp.lotCol);
  renderColumns();
  showImportStep("columns");
}

// --- CSV reading ---

// Handles quoted cells, commas inside quotes, Windows line endings and
// lists saved with semicolons, tabs or pipes instead of commas.
function parseCSV(text) {
  text = text.replace(/^﻿/, "");
  const delim = guessDelimiter(text);
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        cell += ch;
      }
    } else if (ch === '"' && cell.trim() === "") {
      quoted = true;
      cell = "";
    } else if (ch === delim) {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += ch;
    }
  }
  if (cell !== "" || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

function guessDelimiter(text) {
  const lines = text.split(/\r?\n/).filter((line) => line.trim()).slice(0, 20);
  let best = ",";
  let bestLines = 0;
  let bestCount = 0;
  for (const d of [",", ";", "\t", "|"]) {
    const counts = new Map();
    for (const line of lines) {
      let quoted = false;
      let count = 0;
      for (let i = 0; i < line.length; i++) {
        if (line[i] === '"') {
          if (quoted && line[i + 1] === '"') i++;
          else quoted = !quoted;
        } else if (!quoted && line[i] === d) count++;
      }
      if (count) counts.set(count, (counts.get(count) || 0) + 1);
    }
    for (const [count, sameLines] of counts) {
      if (sameLines > bestLines || (sameLines === bestLines && count > bestCount)) {
        best = d;
        bestLines = sameLines;
        bestCount = count;
      }
    }
  }
  return best;
}

// A header row has no house numbers, while the rows under it do.
function looksLikeHeader(rows) {
  if (rows.length < 2) return false;
  const hasDigits = (r) => r.some((c) => /\d/.test(c));
  const knownWords = /address|street|addr|house|number|city|zip|unit|apt|name|state/i;
  return rows[0].some((c) => knownWords.test(c)) || (!hasDigits(rows[0]) && hasDigits(rows[1]));
}

function columnNames(rows, hasHeader) {
  const width = Math.max(...rows.map((r) => r.length));
  return Array.from({ length: width }, (_, i) =>
    hasHeader && rows[0][i] && rows[0][i].trim() ? rows[0][i].trim() : `Column ${i + 1}`);
}

// Pick the address column, or house number + street when they are split.
// City, state and zip are left out: the field sheet only needs the street.
function guessColumns(rows, hasHeader) {
  const names = columnNames(rows, hasHeader).map((n) => n.toLowerCase());
  const find = (re) => names.findIndex((n) => re.test(n));
  const address = find(/address|addr|location/);
  if (address >= 0 && hasHeader) return [address];
  const number = find(/house|number|^no\.?$|^num/);
  const street = find(/street|road|^st$/);
  const unit = find(/unit|apt|suite/);
  if (number >= 0 && street >= 0) return [number, street, unit].filter((i) => i >= 0);

  // No useful names: choose the column that most often starts with a number.
  const data = hasHeader ? rows.slice(1) : rows;
  let best = 0;
  let bestScore = -1;
  names.forEach((_, i) => {
    const score = data.filter((r) => /^\s*\d+\s+\S/.test(r[i] || "")).length;
    if (score > bestScore) {
      best = i;
      bestScore = score;
    }
  });
  return [best];
}

// --- Step 2: pick columns ---

const headerBox = document.getElementById("import-has-header");
headerBox.addEventListener("change", () => {
  imp.hasHeader = headerBox.checked;
  renderColumns();
});

function renderColumns() {
  headerBox.checked = imp.hasHeader;
  const names = columnNames(imp.rows, imp.hasHeader);
  const sample = (imp.hasHeader ? imp.rows.slice(1) : imp.rows).find((r) => r.some((c) => c.trim())) || [];
  const list = document.getElementById("import-columns");
  list.innerHTML = "";
  names.forEach((name, i) => {
    const on = imp.columns.includes(i);
    const opt = document.createElement("label");
    opt.className = "column-option" + (on ? " on" : "");
    const box = document.createElement("input");
    box.type = "checkbox";
    box.checked = on;
    box.addEventListener("change", () => {
      imp.columns = box.checked ? [...imp.columns, i].sort((a, b) => a - b) : imp.columns.filter((c) => c !== i);
      renderColumns();
    });
    const text = document.createElement("div");
    const n = document.createElement("div");
    n.className = "col-name";
    n.textContent = name;
    const s = document.createElement("div");
    s.className = "col-sample";
    s.textContent = sample[i] ? `e.g. ${sample[i].trim()}` : "(empty)";
    text.append(n, s);
    opt.append(box, text);
    list.append(opt);
  });
  const lotSelect = document.getElementById("import-lot");
  lotSelect.replaceChildren(...selectEl([{ value: -1, label: "None" }, ...names.map((label, i) => ({ value: i, label }))]).childNodes);
  lotSelect.value = String(imp.lotCol);
  document.getElementById("import-columns-go").disabled = imp.columns.length === 0 && imp.lotCol < 0;
}

document.getElementById("import-lot").addEventListener("change", (e) => {
  imp.lotCol = Number(e.target.value);
  imp.columns = imp.columns.filter((c) => c !== imp.lotCol);
  renderColumns();
});

document.getElementById("import-columns-go").addEventListener("click", () => {
  imp.include = {};
  importSearch.value = "";
  renderPreview();
  showImportStep("fix");
});

// --- Step 3: fix and preview ---

const STREET_TYPES = {
  street: "St", avenue: "Ave", road: "Rd", drive: "Dr", lane: "Ln", court: "Ct",
  boulevard: "Blvd", circle: "Cir", place: "Pl", highway: "Hwy", parkway: "Pkwy",
  terrace: "Ter", trail: "Trl", way: "Way", square: "Sq", crossing: "Xing",
};
const UPPER_WORDS = new Set(["N", "S", "E", "W", "NE", "NW", "SE", "SW", "PO", "US", "FM", "CR", "SR"]);

function fixOn(name) {
  return document.querySelector(`[data-fix="${name}"]`).checked;
}

document.querySelectorAll("[data-fix]").forEach((box) => box.addEventListener("change", renderPreview));

function cleanAddress(raw) {
  let a = raw;
  if (fixOn("spaces")) a = a.replace(/\s+/g, " ").replace(/\s+,/g, ",").trim();
  if (fixOn("caps")) {
    a = a.toLowerCase().replace(/[a-z0-9']+/g, (w) => {
      const up = w.toUpperCase();
      if (UPPER_WORDS.has(up)) return up;
      if (/^\d+(st|nd|rd|th)$/.test(w)) return w; // 1st, 22nd
      if (/\d/.test(w)) return up; // unit numbers like 4B
      return w[0].toUpperCase() + w.slice(1);
    });
  }
  if (fixOn("street")) {
    a = a.replace(/\b([A-Za-z]+)\b\.?/g, (m, w) => {
      const short = STREET_TYPES[w.toLowerCase()];
      if (short) return short;
      // Already short, just drop the period: "Dr." -> "Dr".
      const known = Object.values(STREET_TYPES).find((s) => s.toLowerCase() === w.toLowerCase());
      return known || m;
    });
  }
  return a;
}

// Every row with its cleaned address and any problems found.
function previewRows() {
  const data = imp.hasHeader ? imp.rows.slice(1) : imp.rows;
  const existing = new Set([...plan.points.filter((p) => p.type === "nid"), ...plan.unassigned]
    .map((p) => p.name.toLowerCase()));
  const seen = new Set();
  return data.map((r, i) => {
    const raw = imp.columns.map((c) => r[c] || "").filter((x) => x.trim()).join(" ");
    const address = cleanAddress(raw);
    const lot = imp.lotCol >= 0 ? cleanLot(r[imp.lotCol] || "") : "";
    // No address yet: the home goes by its lot number.
    const name = address || (lot ? lotName(lot) : "");
    const key = name.toLowerCase().replace(/[^a-z0-9]/g, "");
    const problems = [];
    let skip = false;
    if (!name) {
      problems.push("blank");
      skip = true;
    } else {
      if (seen.has(key) || existing.has(name.toLowerCase())) {
        problems.push(existing.has(name.toLowerCase()) ? "already in the plan" : "duplicate");
        if (fixOn("dupes")) skip = true;
      }
      if (address && !/^\d/.test(address)) problems.push("no house number");
      seen.add(key);
    }
    // The user's own tick wins over the automatic choice.
    const include = i in imp.include ? imp.include[i] : !skip;
    return { index: i, raw, address, lot, name, problems, include };
  });
}

// --- Order and search ---
// Homes on lots come first, Lot 2 before Lot 10; homes with only an
// address follow, by street and then house number.
const naturally = (a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });

function addressParts(name) {
  const m = /^\s*(\d+)\s*([a-z]?)\b[\s,]*(.*)$/i.exec(name || "");
  return m ? { street: m[3], number: Number(m[1]), suffix: m[2] } : { street: name || "", number: Infinity, suffix: "" };
}

function homeOrder(a, b) {
  if (!!a.lot !== !!b.lot) return a.lot ? -1 : 1;
  if (a.lot) return naturally(a.lot, b.lot) || naturally(a.name, b.name);
  const x = addressParts(a.name);
  const y = addressParts(b.name);
  return naturally(x.street, y.street) || x.number - y.number || naturally(x.suffix, y.suffix) || naturally(a.name, b.name);
}

function sortHomes(list) {
  return list.sort(homeOrder);
}

// Search: every word typed must appear in the address or lot.
function homeMatches(h, query) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const text = `${h.name} ${h.lot ? lotName(h.lot) : ""}`.toLowerCase();
  return words.every((w) => text.includes(w));
}

const importSearch = document.getElementById("import-search");
importSearch.addEventListener("input", () => renderPreview());

function renderPreview() {
  const rows = sortHomes(previewRows());
  const query = importSearch.value.trim();
  const table = document.getElementById("import-preview");
  table.innerHTML = "";
  for (const r of rows) {
    if (query && !homeMatches(r, query)) continue;
    const tr = document.createElement("tr");
    if (!r.include) tr.className = "skip";
    const tdBox = document.createElement("td");
    const box = document.createElement("input");
    box.type = "checkbox";
    box.checked = r.include;
    box.disabled = !r.name;
    box.title = "Include this home";
    box.addEventListener("change", () => {
      imp.include[r.index] = box.checked;
      renderPreview();
    });
    tdBox.append(box);
    const tdAddr = document.createElement("td");
    tdAddr.textContent = r.address ? (r.lot ? `${r.address} (${lotName(r.lot)})` : r.address)
      : r.lot ? `${lotName(r.lot)} (no address yet)` : "(blank row)";
    if (r.address && r.address !== r.raw.trim()) tdAddr.title = `Was: ${r.raw}`;
    const tdFlag = document.createElement("td");
    tdFlag.className = "flag";
    tdFlag.textContent = r.problems.join(", ");
    tr.append(tdBox, tdAddr, tdFlag);
    table.append(tr);
  }
  const count = rows.filter((r) => r.include).length;
  const flagged = rows.filter((r) => r.problems.length).length;
  const fixed = rows.filter((r) => r.address && r.address !== r.raw.trim()).length;
  document.getElementById("import-summary").textContent =
    `${rows.length} rows read. ${fixed} cleaned up. ${flagged} need a look (marked in red). ` +
    `Untick any home you don't want.`;
  if (query) {
    const shown = table.rows.length;
    document.getElementById("import-summary").textContent += ` Showing ${shown} of ${rows.length}.`;
    if (!shown) {
      const tr = el("tr");
      tr.append(el("td"), el("td", "muted", `Nothing matches "${query}".`), el("td"));
      table.append(tr);
    }
  }
  const go = document.getElementById("import-go");
  go.textContent = `Add ${count} home${count === 1 ? "" : "s"} to the unassigned list`;
  imp.ready = rows.filter((r) => r.include);
  go.disabled = count === 0;
}

document.getElementById("import-go").addEventListener("click", () => {
  for (const r of imp.ready) {
    const home = { id: makeId(), name: r.name };
    if (r.lot) home.lot = r.lot;
    plan.unassigned.push(home);
  }
  sortHomes(plan.unassigned);
  closeImport();
  savePlan();
  openAssign(null);
});

// --- Unassigned homes ---

function updateUnassignedButton() {
  const b = document.getElementById("unassigned-homes");
  const n = plan.unassigned.length;
  b.hidden = !n;
  b.textContent = `Unassigned homes (${n})`;
}

document.getElementById("unassigned-homes").addEventListener("click", (e) => {
  e.stopPropagation();
  openAssign(null);
});

// Tick homes on the unassigned list and pick the location that feeds them.
function openAssign(fromId) {
  const feeders = plan.points.filter((p) => p.type !== "nid");
  const picked = new Set(plan.unassigned.map((h) => h.id));
  openForm(`Unassigned homes (${plan.unassigned.length})`, (body, foot) => {
    if (!plan.unassigned.length) {
      body.append(el("p", "hint", "No homes waiting. Use Import homes in the top bar to bring in an address list."));
      foot.append(btnEl("Close", finish, "btn big"));
      return;
    }
    const all = el("label", "toggle");
    const allBox = inputEl("checkbox");
    const allText = document.createTextNode("All");
    all.append(allBox, allText);
    const search = inputEl("search", "", { placeholder: "Search addresses or lots", "aria-label": "Search the homes", class: "list-search", autocomplete: "off" });
    const listEl = el("div", "preview-wrap");
    const table = el("table", "preview");
    listEl.append(table);
    body.append(search, all, listEl);
    sortHomes(plan.unassigned);
    const shownHomes = () => plan.unassigned.filter((h) => homeMatches(h, search.value.trim()));
    search.addEventListener("input", () => render());

    const grid = el("div", "form-grid");
    const from = selectEl(feeders.map((p) => ({ value: p.id, label: `${p.name} (${typeLabel(p.type)})` })),
      fromId || feeders[feeders.length - 1].id);
    const drop = dropSelect(1);
    grid.append(fieldEl("Fed from", from), fieldEl("Drop cable", drop));
    body.append(grid);
    const dsRow = el("label", "toggle");
    const ds = inputEl("checkbox");
    const dsLabel = el("span");
    dsRow.append(ds, dsLabel);
    const autoSplice = autoSpliceBox();
    body.append(dsRow, autoSplice.row);

    let go;
    function render() {
      table.innerHTML = "";
      const shown = shownHomes();
      allText.textContent = search.value.trim() ? `All ${shown.length} shown` : "All";
      if (!shown.length) {
        const tr = el("tr");
        tr.append(el("td"), el("td", "muted", `Nothing matches "${search.value.trim()}".`), el("td"));
        table.append(tr);
      }
      for (const h of shown) {
        const tr = el("tr");
        const tdBox = el("td");
        const box = inputEl("checkbox");
        box.checked = picked.has(h.id);
        box.addEventListener("change", () => {
          if (box.checked) picked.add(h.id);
          else picked.delete(h.id);
          refresh();
        });
        tdBox.append(box);
        const tdDel = el("td");
        tdDel.append(btnEl("×", () => {
          picked.delete(h.id);
          withUndo(`Took ${h.name} off the list.`, () => {
            plan.unassigned = plan.unassigned.filter((x) => x !== h);
          });
          if (!plan.unassigned.length) return finish();
          render();
        }, "btn ghost small"));
        tr.append(tdBox, el("td", "", hasAddress(h) && h.lot ? `${h.name} (${lotName(h.lot)})` : h.name), tdDel);
        table.append(tr);
      }
      refresh();
    }

    // Distributed split: each home gets the next free DS port on the
    // splitter feeding that location. Blocked if there aren't enough.
    function splitterFor() {
      const loc = feedingLocation(from.value);
      return loc ? { loc, s: splittersAt(loc)[0] } : null;
    }

    function refresh() {
      const shown = shownHomes();
      allBox.checked = shown.length > 0 && shown.every((h) => picked.has(h.id));
      const n = picked.size;
      const hit = splitterFor();
      dsRow.hidden = !hit;
      formError.hidden = true;
      let blocked = false;
      if (hit) {
        const free = splitterPorts(hit.s) - usedPorts(hit.s).size;
        dsLabel.textContent = `Distributed split: give each home a DS port on ${hit.s.name} at ${hit.loc.name} (${free} free)`;
        if (ds.checked && n > free) {
          formError.textContent = `Only ${free} DS ports are free on ${hit.s.name}, but ${n} homes are ticked.`;
          formError.hidden = false;
          blocked = true;
        }
      }
      if (go) {
        go.textContent = `Assign ${n} home${n === 1 ? "" : "s"}`;
        go.disabled = !n || blocked;
      }
    }

    // With a search typed, All ticks or unticks only the homes shown.
    allBox.addEventListener("change", () => {
      for (const h of shownHomes()) {
        if (allBox.checked) picked.add(h.id);
        else picked.delete(h.id);
      }
      render();
    });
    from.addEventListener("change", refresh);
    ds.addEventListener("change", refresh);

    go = formButtons(foot, () => {
      const hit = ds.checked && splitterFor();
      const fibers = Number(drop.value);
      for (const h of plan.unassigned.filter((x) => picked.has(x.id))) {
        const stop = addLocation(from.value, "nid", h.name, h.lot ? { lot: h.lot } : {});
        if (hit && !countScheme().autoDs) {
          stop.ds = { splitterId: hit.s.id, port: nextFreePort(hit.s) };
          stop.dsManual = true;
        }
        if (fibers) {
          const d = { id: makeId(), name: nextCableName("cable", true), from: from.value, to: stop.id, fibers };
          plan.cables.push(autoSplice.box.checked ? d : spliceByHand(d));
        }
      }
      plan.unassigned = plan.unassigned.filter((x) => !picked.has(x.id));
      finish();
    }, "Assign");
    render();
  }, true);
}
