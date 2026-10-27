// --- Feature editor ---
// A panel sliding in from the right for changing many things at once:
// pick a kind of feature (handholes, cables, splitters...), sort and
// filter its table, change values right in the cells, or tick several
// rows and set one value on all of them. Every change goes through
// withUndo, so it can be taken back from the note at the bottom.
//
// Each kind of feature is registered with addFeatureType:
//   { key, label, rows() -> [item], locOf(item) -> location id to show,
//     cols: [{ key, label, get(item) -> value, text?(item) -> shown text,
//              edit?: "text" | "number" | "select", options?(item) -> [{ value, label }],
//              check?(item, value) -> problem text or "", set?(item, value),
//              when?() -> false to leave the column out }] }
// A column with no edit is read-only. get() of an editable column gives
// the value in the cell; a number cell left empty sets null.

const FEATURE_TYPES = [];

function addFeatureType(t) {
  FEATURE_TYPES.push(t);
}

const fe = { open: false, type: null, sort: null, filter: "", picked: new Set() };
const fePanel = el("aside", "feature-panel");
fePanel.setAttribute("aria-label", "Feature editor");
fePanel.hidden = true;
document.body.append(fePanel);

function feType() {
  return FEATURE_TYPES.find((t) => t.key === fe.type) || FEATURE_TYPES[0];
}

function feCols(t) {
  return t.cols.filter((c) => !c.when || c.when());
}

function feText(col, item) {
  if (col.text) return col.text(item);
  const v = col.get(item);
  if (col.edit === "select") {
    const o = col.options(item).find((x) => String(x.value) === String(v ?? ""));
    return o ? o.label : "";
  }
  return v === null || v === undefined ? "" : String(v);
}

function openFeatures(typeKey) {
  if (isGuest()) return;
  closeMenu();
  fe.open = true;
  if (typeKey) fe.type = typeKey;
  else if (!fe.type) fe.type = (FEATURE_TYPES.find((t) => t.rows().length) || FEATURE_TYPES[0]).key;
  fePanel.hidden = false;
  void fePanel.offsetWidth; // lay it out off-screen first, so it slides in
  fePanel.classList.add("open");
  renderFeatures();
}

function closeFeatures() {
  fe.open = false;
  fe.picked.clear();
  fePanel.classList.remove("open");
  setTimeout(() => {
    if (!fe.open) fePanel.hidden = true;
  }, 200);
}

// After the plan changes elsewhere (or an Undo swaps it), the table
// catches up; not while a cell here is being typed in.
function refreshFeatures() {
  if (fe.open && !fePanel.contains(document.activeElement)) renderFeatures();
}

function feRows(t) {
  const cols = feCols(t);
  let rows = t.rows();
  const q = fe.filter.trim().toLowerCase();
  if (q) rows = rows.filter((r) => cols.some((c) => feText(c, r).toLowerCase().includes(q)));
  if (fe.sort && fe.sort.type === t.key) {
    const col = cols.find((c) => c.key === fe.sort.key);
    if (col) {
      const val = (r) => (col.edit === "number" ? col.get(r) ?? -Infinity : feText(col, r));
      rows = [...rows].sort((a, b) => {
        const x = val(a);
        const y = val(b);
        const d = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true });
        return d * fe.sort.dir;
      });
    }
  }
  return rows;
}

function renderFeatures() {
  if (!fe.open || !plan) return;
  // Keep the cell being worked in, and the scroll, across the redraw.
  const active = document.activeElement && fePanel.contains(document.activeElement) ? document.activeElement.dataset.cell : null;
  const oldWrap = fePanel.querySelector(".fe-table-wrap");
  const scroll = oldWrap ? [oldWrap.scrollTop, oldWrap.scrollLeft] : [0, 0];
  const t = feType();
  const cols = feCols(t);
  const all = t.rows();
  const rows = feRows(t);
  for (const id of [...fe.picked]) if (!all.some((r) => r.id === id)) fe.picked.delete(id);

  // Header: what's listed, the filter, close.
  const head = el("div", "fe-head");
  const title = el("h3", "", "Feature editor");
  const pick = selectEl(FEATURE_TYPES.map((x) => ({ value: x.key, label: `${x.label} (${x.rows().length})` })), t.key);
  pick.setAttribute("aria-label", "Kind of feature");
  pick.addEventListener("change", () => {
    fe.type = pick.value;
    fe.picked.clear();
    renderFeatures();
  });
  const filter = inputEl("search", fe.filter, { placeholder: "Filter: name, size, status..." });
  filter.setAttribute("aria-label", "Filter the rows");
  filter.dataset.cell = "filter";
  filter.addEventListener("input", () => {
    fe.filter = filter.value;
    renderFeatures();
  });
  const close = btnEl("×", closeFeatures, "fe-close");
  close.setAttribute("aria-label", "Close the feature editor");
  close.title = "Close";
  head.append(title, pick, filter, close);

  // Bulk bar: one value on every ticked row.
  const bulk = el("div", "fe-bulk");
  const editable = cols.filter((c) => c.edit);
  if (fe.picked.size && editable.length) {
    const picked = all.filter((r) => fe.picked.has(r.id));
    const colSel = selectEl(editable.map((c) => ({ value: c.key, label: c.label })), fe.bulkCol && editable.some((c) => c.key === fe.bulkCol) ? fe.bulkCol
      : (editable.find((c) => c.key !== "name") || editable[0]).key);
    colSel.setAttribute("aria-label", "Field to set");
    const valBox = el("span", "fe-bulk-val");
    let editor = null;
    const renderEditor = () => {
      fe.bulkCol = colSel.value;
      const col = editable.find((c) => c.key === colSel.value);
      editor = cellEditor(col, picked[0], null);
      editor.setAttribute("aria-label", `New ${col.label}`);
      valBox.replaceChildren(editor);
    };
    colSel.addEventListener("change", renderEditor);
    renderEditor();
    const apply = btnEl(`Set on ${picked.length}`, () => {
      const col = editable.find((c) => c.key === colSel.value);
      feApply(t, col, picked, editorValue(col, editor));
    }, "btn small");
    bulk.append(el("span", "fe-bulk-n", `${picked.length} ticked`), el("span", "", "Set"), colSel, el("span", "", "to"), valBox, apply,
      btnEl("Untick all", () => {
        fe.picked.clear();
        renderFeatures();
      }, "btn ghost small"));
  } else {
    bulk.append(el("span", "hint", rows.length
      ? "Change a value right in its cell. Tick several rows to set one value on all of them. Click a column name to sort."
      : all.length ? "Nothing matches the filter." : `No ${t.label.toLowerCase()} in this plan yet.`));
  }

  // The table.
  const wrap = el("div", "fe-table-wrap");
  const table = el("table", "fe-table");
  const hr = el("tr");
  const allBox = inputEl("checkbox", "");
  allBox.setAttribute("aria-label", "Tick every row shown");
  allBox.checked = rows.length > 0 && rows.every((r) => fe.picked.has(r.id));
  allBox.indeterminate = !allBox.checked && rows.some((r) => fe.picked.has(r.id));
  allBox.addEventListener("change", () => {
    for (const r of rows) allBox.checked ? fe.picked.add(r.id) : fe.picked.delete(r.id);
    renderFeatures();
  });
  const th0 = el("th", "fe-tick");
  th0.append(allBox);
  hr.append(th0);
  for (const c of cols) {
    const sorted = fe.sort && fe.sort.type === t.key && fe.sort.key === c.key ? fe.sort.dir : 0;
    const b = btnEl(c.label + (sorted > 0 ? " ▲" : sorted < 0 ? " ▼" : ""), () => {
      fe.sort = { type: t.key, key: c.key, dir: sorted > 0 ? -1 : 1 };
      renderFeatures();
    }, "fe-sort");
    b.title = `Sort by ${c.label}`;
    const th = el("th", c.edit === "number" ? "num" : "");
    th.setAttribute("aria-sort", sorted > 0 ? "ascending" : sorted < 0 ? "descending" : "none");
    th.append(b);
    hr.append(th);
  }
  hr.append(el("th", "fe-show-h"));
  const thead = el("thead");
  thead.append(hr);
  const tbody = el("tbody");
  for (const r of rows) {
    const tr = el("tr", (fe.picked.has(r.id) ? "picked" : "") + (t.locOf(r) === selectedId ? " shown" : ""));
    const box = inputEl("checkbox", "");
    box.checked = fe.picked.has(r.id);
    box.setAttribute("aria-label", `Tick ${feText(cols[0], r)}`);
    box.addEventListener("change", () => {
      box.checked ? fe.picked.add(r.id) : fe.picked.delete(r.id);
      renderFeatures();
    });
    const td0 = el("td", "fe-tick");
    td0.append(box);
    tr.append(td0);
    for (const c of cols) {
      const td = el("td", c.edit === "number" ? "num" : "");
      if (c.edit && (!c.editable || c.editable(r))) {
        const ed = cellEditor(c, r, `${r.id}|${c.key}`);
        ed.setAttribute("aria-label", `${c.label} of ${feText(cols[0], r)}`);
        ed.addEventListener("change", () => feApply(t, c, [r], editorValue(c, ed)));
        ed.addEventListener("keydown", (e) => {
          if (e.key === "Escape") {
            e.stopPropagation();
            ed.value = c.get(r) ?? "";
            ed.blur();
          }
        });
        td.append(ed);
      } else {
        td.textContent = feText(c, r) || "—";
        td.title = feText(c, r);
        td.className += " fe-ro";
      }
      tr.append(td);
    }
    const show = btnEl("Show", () => revealPoint(t.locOf(r)), "btn ghost small fe-show");
    show.title = "Show it on the route";
    const tdS = el("td", "fe-show-c");
    tdS.append(show);
    tr.append(tdS);
    tbody.append(tr);
  }
  table.append(thead, tbody);
  wrap.append(table);
  fePanel.replaceChildren(head, bulk, wrap);
  wrap.scrollTop = scroll[0];
  wrap.scrollLeft = scroll[1];
  if (active) {
    const again = fePanel.querySelector(`[data-cell="${CSS.escape(active)}"]`);
    if (again) {
      again.focus();
      if (active === "filter") again.setSelectionRange(again.value.length, again.value.length);
    }
  }
}

function cellEditor(col, item, cell) {
  const v = item ? col.get(item) : null;
  const ed = col.edit === "select"
    ? selectEl(col.options(item).map((o) => ({ value: String(o.value), label: o.label })), String(v ?? ""))
    : inputEl(col.edit === "number" ? "number" : "text", v ?? "", col.edit === "number" ? { min: 0 } : {});
  ed.classList.add("fe-cell");
  if (cell) ed.dataset.cell = cell;
  return ed;
}

function editorValue(col, ed) {
  if (col.edit === "number") return ed.value === "" ? null : Number(ed.value);
  if (col.edit === "select") {
    // Back to the option's own type (numbers stay numbers).
    const o = col.options(null).find((x) => String(x.value) === ed.value);
    return o ? o.value : ed.value;
  }
  return ed.value.trim();
}

// One value on some rows: checked first, then all set in one Undo step.
function feApply(t, col, items, value) {
  for (const r of items) {
    const problem = col.check ? col.check(r, value) : "";
    if (problem) {
      showNote(problem);
      renderFeatures();
      return;
    }
  }
  const changing = items.filter((r) => String(col.get(r) ?? "") !== String(value ?? ""));
  if (!changing.length) return;
  const what = changing.length === 1 ? `${col.label} of ${feText(feCols(t)[0], changing[0])}` : `${col.label} on ${changing.length} ${t.label.toLowerCase()}`;
  withUndo(`Changed ${what}.`, () => {
    for (const r of changing) col.set(r, value);
  });
  renderFeatures();
}

// --- Locations ---

const phaseCol = () => ({ key: "phase", label: "Phase", edit: "select", when: hasPhases,
  get: (x) => (hasPhases() ? plan.phases[phaseIdx(x)].id : ""),
  options: () => plan.phases.map((p) => ({ value: p.id, label: p.name })),
  set: (x, v) => (x.phase = v) });

function locationType(key, label, types) {
  addFeatureType({
    key, label,
    rows: () => plan.points.filter((p) => types.includes(p.type)),
    locOf: (p) => p.id,
    cols: [
      { key: "name", label: "Name", edit: "text", get: (p) => p.name,
        check: (p, v) => (v ? "" : "A location needs a name."),
        set: (p, v) => {
          const was = p.name;
          p.name = v;
          renameWithLocation(p, was);
        } },
      { key: "type", label: "Type", edit: "select", get: (p) => p.type,
        options: () => Object.entries(STOP_TYPES).filter(([k]) => k !== "nid" && k !== "splice").map(([value, label]) => ({ value, label })),
        set: (p, v) => {
          p.type = v;
          p.label = typeLabel(v);
        } },
      { key: "from", label: "Fed from", get: (p) => {
        const into = incomingPath(p.id);
        return into ? point(into.from).name : "Start";
      } },
      { key: "equipment", label: "Equipment", get: (p) => (p.equipment || []).map((e) => eqLabel(e)).join(", ") },
      ...DETAIL_FIELDS.map((f) => ({ key: f.key, label: f.label, edit: "text", get: (p) => (p.details && p.details[f.key]) || "",
        set: (p, v) => {
          p.details = { ...(p.details || {}) };
          if (v) p.details[f.key] = v;
          else delete p.details[f.key];
        } })),
      { key: "status", label: "Field status", edit: "select", get: (p) => (p.field && p.field.status) || "",
        options: () => Object.entries(FIELD_STATUS).map(([value, label]) => ({ value, label })),
        set: (p, v) => {
          p.field = { ...(p.field || {}) };
          if (v) p.field.status = v;
          else delete p.field.status;
        } },
      phaseCol(),
    ],
  });
}

locationType("handholes", "Handholes", ["handhole"]);
locationType("pedestals", "Pedestals", ["pedestal"]);
locationType("vaults", "Vaults and manholes", ["vault", "manhole"]);
locationType("cabinets", "Head ends, FDHs and cabinets", ["headend", "fdh", "cabinet"]);
locationType("other-locs", "Other locations", ["other", "splice"]);

// --- Cables and tails: one row per physical cable ---

addFeatureType({
  key: "cables", label: "Cables and tails",
  rows: () => plan.cables.filter((c) => !c.through),
  locOf: (c) => cableSpans(c).at(-1).to,
  cols: [
    { key: "name", label: "Name", edit: "text", get: (c) => c.name,
      check: (c, v) => (v ? "" : "A cable needs a name."),
      set: (c, v) => {
        for (const s of cableSpans(c)) s.name = v;
      } },
    { key: "kind", label: "Kind", get: (c) => CABLE_KINDS[cableKind(c)] },
    { key: "fibers", label: "Size", edit: "select", get: (c) => c.fibers,
      options: (c) => {
        const sizes = c && !CABLE_SIZES.includes(c.fibers) ? [...CABLE_SIZES, c.fibers].sort((a, b) => a - b) : CABLE_SIZES;
        return sizes.map((n) => ({ value: n, label: `${n}F` }));
      },
      check: (c, v) => f2Stuck(cableSpans(c), v) || "",
      set: (c, v) => {
        for (const s of cableSpans(c)) s.fibers = v;
      } },
    { key: "from", label: "From", get: (c) => point(c.from).name },
    { key: "to", label: "To", get: (c) => point(cableSpans(c).at(-1).to).name },
    { key: "via", label: "Through", get: (c) => cableSpans(c).slice(1).map((s) => point(s.from).name).join(", ") },
    { key: "tailFt", label: "Tail ft", edit: "number", get: (c) => c.tailFt ?? null,
      text: (c) => (cableKind(c) === "cable" ? "" : c.tailFt ? String(c.tailFt) : ""),
      editable: (c) => cableKind(c) !== "cable",
      check: (c, v) => (v !== null && !(v > 0 && v <= 5000) ? "Tail length is 1 to 5000 ft." : ""),
      set: (c, v) => {
        if (cableKind(c) === "cable") return;
        if (v) c.tailFt = v;
        else delete c.tailFt;
      } },
    phaseCol(),
  ],
});

document.getElementById("features-open").addEventListener("click", (e) => {
  e.stopPropagation();
  if (emptyBlocked()) return;
  fe.open ? closeFeatures() : openFeatures();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && fe.open && !document.querySelector(".wizard:not([hidden])")) closeFeatures();
});
